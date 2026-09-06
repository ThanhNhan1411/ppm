// Regression guard: fails if any earlier test file in this process dropped the
// preload's PPM_HOME (e.g. `delete process.env.PPM_HOME` in a teardown), which
// would re-point getPpmDir() at the real ~/.ppm for every later fixture.
// Read-only — never writes anywhere.
import { describe, it, expect } from "bun:test";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getPpmDir } from "../../src/services/ppm-dir.ts";

describe("PPM_HOME isolation probe", () => {
  it("reports where getPpmDir() points", () => {
    const real = resolve(homedir(), ".ppm");
    console.log(`PPM_HOME env = ${process.env.PPM_HOME ?? "(unset)"}`);
    console.log(`getPpmDir()  = ${getPpmDir()}`);
    console.log(`real ~/.ppm  = ${real}`);
    expect(getPpmDir()).not.toBe(real);
  });
});
