import 'reflect-metadata'; // EventBus is a tsyringe @injectable — the polyfill must load first
import 'dotenv/config';
import { createServer } from 'http';
import { fork } from 'child_process';
import { io as ioClient } from 'socket.io-client';
import { EventBus } from '../services/EventBus';
import { attachSockets } from '../sockets/socketServer';
import { closeSocketAdapter } from '../sockets/redisAdapter';

/**
 * Proof that WebSocket room emits cross process boundaries (Phase: cross-instance fan-out).
 *
 * Jest can't demonstrate this: the suite forces the in-memory path and CI has no Redis. So this is a
 * real two-process test, in the style of proveHoldFlow / proveSweeper.
 *
 *   parent ──fork──▶ instance A (port 5101)  ◀── socket.io client joins concert:<id>
 *          ──fork──▶ instance B (port 5102)  ── publishes seat:sold on ITS OWN EventBus
 *
 * The client is connected ONLY to A. B's EventBus is a separate in-process emitter that A can't see.
 * So if the client receives the event, it can only have travelled A ◀── Redis pub/sub ──▶ B.
 * Without the adapter this script hangs and fails on the timeout — which is exactly the bug it pins.
 *
 * Run:  docker compose up -d redis
 *       REDIS_URL=redis://localhost:6379 npx ts-node -T src/scripts/proveCrossInstance.ts
 */

const CONCERT_ID = 'cross-instance-demo';
const SEATS = ['A1', 'A2'];
const TIMEOUT_MS = 8000;

// ---- child: one app instance ----
async function runInstance(port: number): Promise<void> {
    const httpServer = createServer();
    const bus = new EventBus();
    attachSockets(httpServer, bus, []);
    await new Promise<void>((resolve) => httpServer.listen(port, resolve));
    process.send?.({ ready: port });

    process.on('message', (msg: { publish?: boolean }) => {
        if (msg.publish) {
            bus.publishSeatEvent({ type: 'seat:sold', concertId: CONCERT_ID, seatNumbers: SEATS });
            process.send?.({ published: true });
        }
    });
}

// ---- parent: orchestrate + assert ----
async function main(): Promise<void> {
    if (!process.env.REDIS_URL) {
        console.error('REDIS_URL is not set — this proof is meaningless without it. Start Redis first.');
        process.exit(1);
    }
    const spawn = (port: number) =>
        new Promise<ReturnType<typeof fork>>((resolve, reject) => {
            // src/scripts is excluded from the build, so this normally runs under ts-node — the
            // children must be started the same way (plain node can't require a .ts entry point).
            // Negative control: PROVE_WITHOUT_ADAPTER=1 starts the instances with no REDIS_URL, so
            // each keeps socket.io's default in-memory adapter. The run MUST then fail on the
            // timeout — that failure is what shows the positive run isn't proving something trivial.
            const childEnv = { ...process.env };
            if (process.env.PROVE_WITHOUT_ADAPTER === '1') delete childEnv.REDIS_URL;
            const child = fork(__filename, ['instance', String(port)], {
                env: childEnv,
                execArgv: __filename.endsWith('.ts') ? ['-r', 'ts-node/register/transpile-only'] : [],
            });
            child.once('message', (m: { ready?: number }) =>
                m.ready ? resolve(child) : reject(new Error('bad hello')),
            );
            child.once('error', reject);
        });

    console.log('booting two instances…');
    const [a, b] = await Promise.all([spawn(5101), spawn(5102)]);
    console.log('  instance A → :5101 (the client connects here)');
    console.log('  instance B → :5102 (the event is published here)');

    const client = ioClient('http://localhost:5101', { transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
        client.once('connect', resolve);
        client.once('connect_error', reject);
    });
    client.emit('join', { concertId: CONCERT_ID });
    console.log(`client connected to A and joined room concert:${CONCERT_ID}`);

    const received = new Promise<{ concertId: string; seatNumbers: string[] }>((resolve, reject) => {
        client.once('seat:sold', resolve);
        setTimeout(
            () => reject(new Error(`no seat:sold within ${TIMEOUT_MS}ms — fan-out did NOT cross instances`)),
            TIMEOUT_MS,
        );
    });

    // Give the adapter's subscriber a beat to register the room before B publishes.
    await new Promise((r) => setTimeout(r, 300));
    console.log('publishing seat:sold on instance B…');
    b.send({ publish: true });

    let code = 0;
    try {
        const payload = await received;
        const ok = payload.concertId === CONCERT_ID && payload.seatNumbers.join(',') === SEATS.join(',');
        console.log(`client (on A) received: ${JSON.stringify(payload)}`);
        console.log(
            ok ? '\nPASS — the event crossed from instance B to a client on instance A.' : '\nFAIL — payload mismatch.',
        );
        code = ok ? 0 : 1;
    } catch (err) {
        console.error(`\nFAIL — ${(err as Error).message}`);
        code = 1;
    } finally {
        client.close();
        a.kill();
        b.kill();
        await closeSocketAdapter();
    }
    process.exit(code);
}

if (process.argv[2] === 'instance') {
    void runInstance(Number(process.argv[3]));
} else {
    void main();
}
