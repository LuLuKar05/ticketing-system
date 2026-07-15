# Seat Map — design & implementation plan

> Adds a **seat catalog** (the venue layout) so seat validity, per-tier capacity, the tier↔seat
> binding, and an availability read model all become **DB-enforced** instead of trusted from the
> client. Closes review items §3.1 (tier-swap exploit), §3.4 (capacity/validity), §4 (no
> availability read model), and the WebSocket "no baseline" gap — in one design.

---

## 0. Core principle: catalog, not state

The `Seat` table stores the **definition** of what seats exist (the layout). It **never** stores
availability. A seat's live status is still *derived*:

- `SOLD`  → a `Ticket` exists for `(concert, seatNumber)`
- `HELD`  → a non-expired `PENDING Reserve` exists for `(concert, seatNumber)`
- else `AVAILABLE`

This is what lets us add a seat map **without abandoning create-on-pay**: the catalog is immutable
reference data; `Reserve`/`Ticket` remain the state.

## 1. Storage decision — JSON in, normalized rows stored

- **Import format = JSON.** An admin uploads one document describing the whole map (see §4).
- **Storage = normalized `Seat` rows**, *not* a JSON blob. Rationale: a blob can't enforce seat
  validity, can't FK a seat to its tier, can't be `JOIN`ed for availability, and would force
  app-level JSON parsing on every hold — the exact check-then-act anti-pattern the project avoids.
  The import endpoint validates the JSON and writes rows in one transaction.

## 2. Data model

```ts
// Seat = catalog / layout. Immutable once seats have been reserved/sold. NO status column.
@Entity()
@Unique(['concert', 'seatNumber'])           // one physical seat per label per concert
@Index(['concert', 'ticketTier'])            // capacity/availability queries
export class Seat extends AbstractEntity {
    @Column({ type: 'text' })  seatNumber!: string;               // 'A1'
    @Column({ type: 'text', nullable: true }) section!: string | null;   // 'A'
    @Column({ type: 'text', nullable: true }) rowLabel!: string | null;  // '1'  (avoid the SQL word "row")
    // Visual coordinates are DEFERRED — see §11. Kept out of the first cut.
    @ManyToOne(() => Concert)    concert!: Concert;
    @ManyToOne(() => TicketTier) ticketTier!: TicketTier;         // ← authoritative tier for this seat
}
```

Companion changes:
- **`Concert.hasAssignedSeating: boolean`** (default `true`) — means **buyer picks a specific seat**
  (assigned) vs **server auto-assigns a fungible seat** (GA). **Both modes have real `Seat` rows.**
- **`TicketTier.quantity` is dropped entirely.** Capacity in *both* modes = `COUNT(Seat WHERE tier)`
  — always derived from the layout the admin provides. **No `quantity`/`capacity` column anywhere.**

## 3. Availability read model — `GET /api/v1/concerts/:id/seats`

The missing baseline a client (or a freshly-connected WS listener) applies deltas to.

```jsonc
{
  "concertId": "…",
  "seats": [
    { "seatNumber": "A1", "section": "A", "row": "1", "tier": { "id": "…", "name": "VIP", "price": 15000 }, "status": "available" },
    { "seatNumber": "A2", "section": "A", "row": "1", "tier": { … }, "status": "held" },
    { "seatNumber": "B5", "section": "B", "row": "5", "tier": { … }, "status": "sold" }
  ]
}
```
Computed by loading the catalog + the set of SOLD seatNumbers (tickets) + the set of currently-HELD
seatNumbers (`PENDING` reserves with `expiresAt > now`) and merging. Then the client renders it and
applies `seat:held/sold/released` events on top.

## 4. Import format + admin endpoint

### JSON upload shape (per concert)
```jsonc
{
  "seats": [
    { "seatNumber": "A1", "section": "A", "row": "1", "tierName": "VIP" },
    { "seatNumber": "A2", "section": "A", "row": "1", "tierName": "VIP" },
    { "seatNumber": "B1", "section": "B", "row": "1", "tierName": "General" }
  ]
}
```
- `tierName` references a tier that must already exist on the concert (or accept `tierId`). Validated
  against the concert's tiers during import.
- zod: `seatImportSchema` — non-empty `seats`, unique `seatNumber`s (`.refine`), each referencing a
  known tier.

### `POST /api/v1/concerts/:id/seats` (admin)
- **Auth:** admin-only (depends on Phase 6a auth + a `role`; until then, gated behind whatever admin
  guard exists / documented as admin-only).
- **Semantics — full replace, guarded:** replaces the concert's seat map in one transaction. **Reject
  the import if any seat is already SOLD or HELD** (you can't repave the venue mid-sale) → `409`.
  A safe re-import is only allowed before any reservation/sale exists.
- **Transaction:** validate every `tierName`/`tierId` belongs to this concert (kills a tier-mismatch
  at authoring time too) → delete existing seats for the concert → bulk-insert new `Seat` rows.

## 5. Reserve flow changes (this is where §3.1 dies)

Input changes from `seats: [{ tierId, seatNumber }]` → **`seats: [seatNumber]`** (client no longer
names a tier). In `ReserveService.reserveTickets`, inside the transaction:
1. Load each requested `Seat(concertId, seatNumber)` from the catalog. **Missing → 400 invalid seat**
   (closes §3.4's free-form `ZZZ-9999`).
2. Derive `tierId` + `price` **from the seat**, never from the request (closes §3.1 tier-swap).
3. Existing pre-check (sold/held) + insert the reserve with the derived tier.

## 6. Confirm flow changes

- `pricePaid` comes from the seat's tier (already derived onto the reserve at hold time).
- Capacity is implicit — you can't confirm a seat that isn't in the catalog, and the unique index
  still prevents double-sell. The `decrementQuantity`/`MoreThan(0)` path is **removed entirely** (no
  stock counter in either mode); "the seat exists and isn't already sold" is the whole check.

## 7. Migration

One migration: create `seat` table (+ unique/index), add `Concert.hasAssignedSeating`, **drop
`TicketTier.quantity`** (capacity is derived from the seat catalog in both modes). Because SQLite
rebuilds tables for alters, expect the usual `temporary_*` churn — the end state is what matters.

> Note: dropping `quantity` ripples into the current `TicketTierRepository` (`increment/decrement`)
> and `TicketService.confirmOrder` (the `decrementQuantity` call) — both are removed/reworked in the
> §8 build. This is a real, tracked change to the confirm path, not just an entity edit.

## 8. Build order

1. `Seat` entity + `Concert.hasAssignedSeating` + `TicketTier.capacity` → migration.
2. `SeatRepository` (manager-aware): `findSeatsForConcert`, `findSeatsByNumbers(concertId, [nums])`,
   `replaceSeats(concertId, seats[], manager)`, `countByTier`.
3. Admin import: `seatImportSchema` DTO + `SeatService.importSeatMap` + `POST /concerts/:id/seats`.
4. Read model: `GET /concerts/:id/seats` (+ `SeatService.getSeatMapWithStatus`).
5. Rewire `ReserveService` (derive tier from seat) + `TicketService` (price from reserve's tier).
6. Drop the `decrementQuantity`/`quantity` path for assigned seating.

## 9. Tests

- **Import:** valid JSON → seats created; unknown tier → 400/422; duplicate seatNumbers → 400;
  re-import after a hold/sale → 409.
- **Read model:** seats reflect available/held/sold correctly after a hold and a sale.
- **Exploit closed:** holding a seat whose tier the client *tries* to override still prices from the
  seat's real tier; holding a non-existent seat → 400.
- **Capacity:** can't hold more seats than exist in a tier (no oversell, and now no over-*hold*).

## 10. Seating modes — one catalog, "pick" vs "auto-assign"  — `Concert.hasAssignedSeating`

Both modes use the **same `Seat` catalog** and derive capacity from `COUNT(seat)`. The *only*
difference is who chooses the seat:

- **Assigned (`true`):** the buyer **picks** specific seats. Hold input = `seats: [seatNumber]`
  (§5). Seats are `A1`, `B5`, …
- **General admission (`false`):** seats are **fungible** and **auto-assigned**. The admin's layout
  provides a count per GA tier (e.g. "GA Floor: 500"), which materializes 500 rows (`GA-1`…`GA-500`,
  `section='GA'`). Hold input = `{ tierName, count }` — "I want N tickets"; the server picks *any* N
  currently-free seats of that tier and holds them (same pre-check + unique-index insert as §5). The
  buyer never sees a seat number they chose; they just get N spots.
- **Capacity is `COUNT(seat)` in both** — no stored counter. A GA tier is "sold out" when
  `sold + held == COUNT(seat WHERE tier)`.
- Routing: `reserveTickets` branches once at the top on `hasAssignedSeating` — *pick these seatNumbers*
  vs *auto-assign N of this tier*. Everything downstream (reserve rows, unique index, confirm,
  sweeper, WS events) is identical.
- *(Full GA implementation walkthrough to be written after the assigned path lands, per decision —
  but note it's now a thin branch, not a separate model.)*

---

## 11. FUTURE — per-venue seat maps (not built now)

Today the map is **per concert** (simple; one set of `Seat` rows per show). At scale you don't want
to re-author 20,000 seats for every concert at the same arena. The upgrade:

- **`Venue` entity** owns a reusable layout: `VenueSeat(venue, seatNumber, section, row, [x, y])` —
  the physical geometry, tier-agnostic.
- **`Concert` references a `Venue`** and provides a **tier assignment** (which sections/rows map to
  which of *this concert's* tiers — the same seat is VIP for one show, General for another).
- **Two storage strategies:**
  - **Materialize:** on concert publish, copy `VenueSeat` → `Seat` rows for that concert (applying
    the tier assignment). Keeps the hold/read paths identical to §2–§6; costs storage per concert.
  - **Reference:** don't copy — `Seat` becomes a *view* over `VenueSeat` + the concert's tier
    assignment. Less storage, but every availability query joins venue+assignment+sold+held. More
    complex; only worth it at large scale.
- **Recommendation when this lands:** materialize (keeps everything downstream unchanged); revisit
  referencing only if storage becomes a real cost. Import then targets the **venue** once, and each
  concert just supplies its tier assignment.

## 12. FUTURE — visual coordinates (not built now)

The logical map (`section`, `row`, `seatNumber`, `tier`) is enough for validity/capacity/
availability. A **graphical** picker needs geometry:

- **Add `posX`, `posY`** (ints, a normalized grid) to `Seat`/`VenueSeat`, plus optionally a
  `sectionShape` (polygon points) for curved/tiered arenas. All **presentation** — no backend logic
  depends on it.
- **Import extension:** the JSON gains optional `x`/`y` per seat (and section polygons); the schema
  makes them optional so logical-only maps still import.
- **Read model:** `GET /concerts/:id/seats` echoes `x`/`y` when present; the client renders an SVG/
  Canvas seat map and colors each seat by `status`.
- **Rendering approach:** Canvas/SVG grid keyed off `posX`/`posY`; the WS `seat:*` events recolor
  individual seats in place. Keep coordinates in a **normalized** space (e.g. 0–1000) so the client
  scales to any viewport.
- **Recommendation when this lands:** coordinates are additive and optional — ship the logical map
  first, layer geometry on without touching the hold/confirm logic.
