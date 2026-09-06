import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { _resetPpmDir } from "../../../../src/services/ppm-dir.ts";
import { getBackupsDir } from "../../../../src/services/db-backup/db-backup-paths.ts";
import {
  isCredentialPath,
  isDbBackupsDirPath,
  assertNotPpmDir,
  assertNotPpmSubtree,
} from "../../../../src/services/fs-credential-path-guard.ts";
import { rmRetrying } from "../../../helpers/rm-retrying.ts";

/**
 * A snapshot is a byte-for-byte copy of the config database, so it carries the
 * same provider keys, encrypted accounts, and auth token. In production the
 * snapshot directory sits outside `~/.ppm` so it survives a wipe of that
 * directory — which means the PPM-dir branch of the guard does not cover it,
 * and the generic `/api/fs/*` routes would happily serve it without this.
 */

// Restore, never delete: the bunfig preload's PPM_HOME shields later test
// files in this process from the real ~/.ppm.
const ORIGINAL_PPM_HOME = process.env.PPM_HOME;

let ppmHome: string;

beforeEach(() => {
  ppmHome = mkdtempSync(resolve(tmpdir(), "ppm-backup-guard-"));
  process.env.PPM_HOME = ppmHome;
  _resetPpmDir();
});

afterEach(async () => {
  if (ORIGINAL_PPM_HOME === undefined) delete process.env.PPM_HOME;
  else process.env.PPM_HOME = ORIGINAL_PPM_HOME;
  _resetPpmDir();
  await rmRetrying(ppmHome);
});

describe("snapshot directory is a credential path", () => {
  test("the backups directory itself is refused", () => {
    const dir = getBackupsDir();
    expect(isDbBackupsDirPath(dir)).toBe(true);
    expect(isCredentialPath(dir)).toBe(true);
    expect(() => assertNotPpmDir(dir)).toThrow("Access denied");
  });

  test("a snapshot file inside it is refused on read-style doors", () => {
    const snapshot = resolve(getBackupsDir(), "ppm-20260906T154600Z-hourly.db");
    expect(() => assertNotPpmDir(snapshot)).toThrow("Access denied");
  });

  test("a snapshot cannot be copied or moved out to a readable location", () => {
    // Without this, reading is blocked but copy-then-read hands out the same
    // credentials through the back door.
    const snapshot = resolve(getBackupsDir(), "ppm-20260906T154600Z-manual.db");
    expect(() => assertNotPpmSubtree(snapshot)).toThrow(/credential directory/);
  });

  test("matching is path-segment aware, not a substring test", () => {
    // A sibling whose name merely starts with the backups directory name is
    // not inside it. (Under an isolated PPM_HOME that sibling still sits in
    // the PPM dir, so the broader guard refuses it for a different and equally
    // correct reason — hence asserting on this predicate specifically.)
    expect(isDbBackupsDirPath(`${getBackupsDir()}-notes`)).toBe(false);
    expect(isDbBackupsDirPath(resolve(tmpdir(), "unrelated-backups"))).toBe(false);
  });

  test("an ordinary path outside every credential root stays allowed", () => {
    const ordinary = resolve(tmpdir(), "some-project", "README.md");
    expect(isCredentialPath(ordinary)).toBe(false);
    expect(() => assertNotPpmDir(ordinary)).not.toThrow();
    expect(() => assertNotPpmSubtree(ordinary)).not.toThrow();
  });
});
