/**
 * Process lifecycle state, shared between the signal handler (server.ts) and the health endpoint
 * (app.ts).
 *
 * Once a shutdown signal arrives the process is **draining**: it finishes in-flight requests but
 * must stop attracting new traffic. `/health` reports 503 while draining so a load balancer /
 * orchestrator takes this instance out of rotation before the socket actually closes — otherwise
 * requests keep arriving during the drain window and get connection-reset instead of a clean answer.
 */
let shuttingDown = false;

export function beginShutdown(): void {
    shuttingDown = true;
}

export function isShuttingDown(): boolean {
    return shuttingDown;
}

/** Test-only: reset the flag between cases. */
export function resetLifecycleForTests(): void {
    shuttingDown = false;
}
