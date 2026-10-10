import { expect, spyOn, test } from "bun:test";
import { isStorageLockOwnerAlive } from "../../../src/js/platform/storageLock";

test("stale locks still protect live hosts and permission-denied owners", () => {
  expect(isStorageLockOwnerAlive(JSON.stringify({ pid: process.pid }))).toBe(true);
  expect(isStorageLockOwnerAlive("broken")).toBe(false);
  expect(isStorageLockOwnerAlive(JSON.stringify({ pid: -1 }))).toBe(false);
  const kill = spyOn(process, "kill").mockImplementation(() => { throw Object.assign(new Error("No permission"), { code: "EPERM" }); });
  try {
    expect(isStorageLockOwnerAlive(JSON.stringify({ pid: 123 }))).toBe(true);
    kill.mockImplementation(() => { throw Object.assign(new Error("Exited"), { code: "ESRCH" }); });
    expect(isStorageLockOwnerAlive(JSON.stringify({ pid: 123 }))).toBe(false);
  } finally { kill.mockRestore(); }
});
