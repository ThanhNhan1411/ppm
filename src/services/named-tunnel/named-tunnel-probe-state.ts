/**
 * Pure decision function for the named-tunnel probe's "restart once, then warn
 * and stop" state machine. Kept separate from `supervisor.ts` (which owns the
 * actual kill/respawn/status-write side effects) so the transition logic is
 * unit-testable without spawning a real cloudflared process or timers.
 *
 * The bug this exists to prevent: resetting `restartAttempted` anywhere other
 * than a confirmed-healthy observation lets a dark hostname (e.g. the CNAME
 * deleted in the dashboard) restart the connector every threshold window
 * forever, because the RESTART itself always "succeeds" (cloudflared happily
 * reconnects to Cloudflare's edge) even though the DNS route it needs is gone —
 * a spawn success is not proof the hostname is reachable, only the probe's own
 * fetch against the public URL is.
 */

export interface NamedProbeState {
  /** Consecutive unhealthy probe cycles observed since the last reset. */
  failCount: number;
  /** Whether the one allowed restart-and-hope has already been used since the
   *  last confirmed-healthy observation. */
  restartAttempted: boolean;
}

export type NamedProbeAction =
  | { type: "healthy" }
  /** Counting a failure. `warnEarly` marks the tick that should surface a
   *  soft "checking the connection" notice without touching the connector. */
  | { type: "watch"; warnEarly: boolean }
  | { type: "restart-once" }
  | { type: "warn-and-stop" };

export interface NamedProbeDecision {
  action: NamedProbeAction;
  nextState: NamedProbeState;
}

/**
 * Is the thing answering the public hostname *our* server? `publicId` is the
 * `instanceId` the hostname returned, `localId` the one our loopback server
 * returned; either may be missing.
 *
 * A deleted CNAME does not make the hostname go dark — it falls back to the
 * zone's wildcard record and some unrelated host answers 200 with a body that
 * has no `instanceId`. If we know our own identity and the public answer lacks
 * one (or differs), the hostname is not ours. Only when our own server has no
 * identity (a build that predates `instanceId`) do we accept bare reachability.
 */
export function publicHostnameIsOurs(publicId: unknown, localId: unknown): boolean {
  if (typeof localId !== "string") return true;
  return typeof publicId === "string" && publicId === localId;
}

/**
 * Decide the next action for one probe tick.
 *
 * - `healthy` → both counters reset to a clean slate (the only place
 *   `restartAttempted` ever goes back to `false`).
 * - unhealthy below `threshold` → `watch`. Acting on a dark hostname is
 *   deliberately slow (a flaky minute must not kill a working connector), but
 *   *saying nothing* for that long is a different decision: `watch` carries
 *   `warnEarly` on the tick that crosses `earlyWarnAt`, so the UI can show
 *   "checking the connection" while the restart budget is still untouched.
 * - unhealthy at/above `threshold`, first time → `restart-once` (kill +
 *   respawn the connector; arms `restartAttempted` so this never repeats
 *   until a healthy observation clears it).
 * - unhealthy at/above `threshold`, restart already attempted → `warn-and-stop`
 *   (surface the warning; never kill again — the pinned URL stays put).
 */
export function decideNamedProbeAction(
  healthy: boolean,
  state: NamedProbeState,
  threshold: number,
  earlyWarnAt = 2,
): NamedProbeDecision {
  if (healthy) {
    return { action: { type: "healthy" }, nextState: { failCount: 0, restartAttempted: false } };
  }

  const failCount = state.failCount + 1;
  if (failCount < threshold) {
    // Only on the crossing tick: re-writing the same warning every 30s would
    // rewrite status.json forever for no new information.
    const warnEarly = failCount === earlyWarnAt;
    return {
      action: { type: "watch", warnEarly },
      nextState: { failCount, restartAttempted: state.restartAttempted },
    };
  }

  if (!state.restartAttempted) {
    return { action: { type: "restart-once" }, nextState: { failCount: 0, restartAttempted: true } };
  }

  return { action: { type: "warn-and-stop" }, nextState: { failCount: 0, restartAttempted: true } };
}
