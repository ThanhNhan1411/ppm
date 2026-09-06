import { rmSync } from "node:fs";

/**
 * Windows releases a file handle some time after the owning process or
 * connection closes it, so an immediate recursive `rmSync` on a temp dir that
 * just held a SQLite database (or a killed executable) races that release and
 * fails with EBUSY/EACCES. Best-effort retry rather than a fixed sleep in
 * every teardown.
 */
export async function rmRetrying(path: string, attempts = 5): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      rmSync(path, { recursive: true, force: true });
      return;
    } catch (e: any) {
      if (e?.code !== "EACCES" && e?.code !== "EBUSY" && e?.code !== "EPERM") throw e;
      await Bun.sleep(150);
    }
  }
  // Last attempt: a teardown failure here should surface as itself, not as a
  // confusing failure in whichever test happens to run next.
  rmSync(path, { recursive: true, force: true });
}
