export const isStorageLockOwnerAlive = (serialized: string): boolean => {
  let pid: unknown;
  try { pid = JSON.parse(serialized)?.pid; } catch { return false; }
  if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // A permissions error is not evidence that the owning host exited.
    return !(error && typeof error === "object" && "code" in error && error.code === "ESRCH");
  }
};
