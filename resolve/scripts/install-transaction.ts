import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, rename, rm } from "node:fs/promises";
import { PLUGIN_ID } from "../src/shared/types";

export const installDevelopmentPlugin = async (
  source: string,
  pluginRoot: string,
  copy = cp,
  move = rename,
): Promise<string | undefined> => {
  const destination = path.join(pluginRoot, PLUGIN_ID);
  if (existsSync(path.join(pluginRoot, "com.rksound.designer.resolve"))) {
    throw new Error("Back up and move the legacy com.rksound.designer.resolve plugin out of the plugin folder before installing. It has not been deleted.");
  }
  // Stage and retain backups outside the plugin discovery directory.
  const workRoot = path.join(path.dirname(pluginRoot), "SoundDesigner Development Backups", randomUUID());
  const incoming = path.join(workRoot, "incoming");
  const backup = path.join(workRoot, PLUGIN_ID);
  await mkdir(workRoot, { recursive: true });
  let backedUp = false;
  try {
    await copy(source, incoming, { recursive: true, errorOnExist: true, force: false });
    await mkdir(pluginRoot, { recursive: true });
    if (existsSync(destination)) {
      await move(destination, backup);
      backedUp = true;
    }
    try { await move(incoming, destination); }
    catch (error) {
      if (backedUp) await move(backup, destination);
      throw error;
    }
    return backedUp ? backup : undefined;
  } finally {
    await rm(incoming, { recursive: true, force: true }).catch(() => {});
    // Never remove a recovery backup, including after a failed rollback.
  }
};
