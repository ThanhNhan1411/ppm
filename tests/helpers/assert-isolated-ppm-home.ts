import { homedir } from "node:os";
import { resolve } from "node:path";
import { getPpmDir } from "../../src/services/ppm-dir.ts";

/**
 * Refuses to let a test fixture touch the REAL ~/.ppm. The bunfig preload
 * points PPM_HOME at a temp dir, but any earlier test file that deletes
 * PPM_HOME (instead of restoring it) silently re-points getPpmDir() at the
 * production directory for the rest of the process — which once let a
 * fixture overwrite the live ppm.db. Call this before any fixture write
 * under getPpmDir().
 */
export function assertIsolatedPpmHome(): void {
  if (resolve(getPpmDir()) === resolve(homedir(), ".ppm")) {
    throw new Error(
      "TEST ISOLATION LOST: getPpmDir() points at the real ~/.ppm — an earlier " +
        "test file deleted PPM_HOME instead of restoring it. Refusing to run.",
    );
  }
}
