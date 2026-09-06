/**
 * The registry that lets a window's titlebar and its body agree on one PiP handle.
 *
 * It is keyed by WINDOW id and used by every kind, so the interesting cases are the
 * cross-window ones: one window's slot must never answer for another's, and clearing one
 * handle must leave the other alone.
 */
import { describe, it, expect, afterEach } from "bun:test";
import {
  publishWindowSlot,
  windowSlot,
  whenWindowSlot,
  setWindowPip,
  windowPip,
  markPipOnlyWindow,
  isPipOnlyWindow,
  clearPipOnlyWindow,
} from "../../../src/web/components/floating-window/window-pip-registry";
import type { PipHandle } from "../../../src/web/components/floating-window/pip/pip-host";

const fakeHandle = (): PipHandle => ({ detach: () => {}, pipWindow: {} as Window });
const fakeEl = (tag: string) => ({ tag }) as unknown as HTMLElement;

afterEach(() => {
  for (const id of ["w1", "w2"]) {
    publishWindowSlot(id, null);
    setWindowPip(id, null);
    clearPipOnlyWindow(id);
  }
});

describe("window slot publication", () => {
  it("returns null for a window that published nothing", () => {
    expect(windowSlot("w1")).toBeNull();
  });

  it("keeps each window's element separate and retracts with null", () => {
    const a = fakeEl("a");
    const b = fakeEl("b");
    publishWindowSlot("w1", a);
    publishWindowSlot("w2", b);
    expect(windowSlot("w1")).toBe(a);
    expect(windowSlot("w2")).toBe(b);

    publishWindowSlot("w1", null);
    expect(windowSlot("w1")).toBeNull();
    expect(windowSlot("w2")).toBe(b);
  });
});

describe("window PiP handles", () => {
  it("is null for an unknown, null or undefined window id", () => {
    expect(windowPip("w1")).toBeNull();
    expect(windowPip(null)).toBeNull();
    expect(windowPip(undefined)).toBeNull();
  });

  it("records and clears a handle per window", () => {
    const h1 = fakeHandle();
    const h2 = fakeHandle();
    setWindowPip("w1", h1);
    setWindowPip("w2", h2);
    expect(windowPip("w1")).toBe(h1);
    expect(windowPip("w2")).toBe(h2);

    setWindowPip("w1", null);
    expect(windowPip("w1")).toBeNull();
    expect(windowPip("w2")).toBe(h2);
  });
});

describe("waiting for a window to publish its body", () => {
  it("resolves immediately for a window that already published", async () => {
    const el = fakeEl("body");
    publishWindowSlot("w1", el);
    expect(await whenWindowSlot("w1", 50)).toBe(el);
  });

  it("resolves once the frame mounts a commit later", async () => {
    const el = fakeEl("late");
    const waiting = whenWindowSlot("w1", 500);
    // What the frame's layout effect does after the store opened the window.
    setTimeout(() => publishWindowSlot("w1", el), 5);
    expect(await waiting).toBe(el);
  });

  it("is not answered by another window publishing", async () => {
    const waiting = whenWindowSlot("w1", 60);
    publishWindowSlot("w2", fakeEl("other"));
    expect(await waiting).toBeNull();
  });

  it("gives up rather than hanging when the window never mounts", async () => {
    expect(await whenWindowSlot("w1", 30)).toBeNull();
  });
});

describe("pip-only host windows", () => {
  it("is off by default and set per window", () => {
    expect(isPipOnlyWindow("w1")).toBe(false);
    markPipOnlyWindow("w1");
    expect(isPipOnlyWindow("w1")).toBe(true);
    expect(isPipOnlyWindow("w2")).toBe(false);
  });

  it("clears so a reused id is not hidden forever", () => {
    markPipOnlyWindow("w1");
    clearPipOnlyWindow("w1");
    expect(isPipOnlyWindow("w1")).toBe(false);
  });
});
