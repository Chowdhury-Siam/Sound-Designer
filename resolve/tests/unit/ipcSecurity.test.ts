import { expect, mock, test } from "bun:test";
import { isTrustedUiSender } from "../../src/main/uiProtocol";

const handlers = new Map<string, (...args: any[]) => any>();
const events = new Map<string, (...args: any[]) => any>();
mock.module("electron", () => ({
  app: { getPath: () => "/unused-test-app-data" },
  BrowserWindow: {}, dialog: {}, shell: {},
  nativeImage: { createFromDataURL: () => ({ resize: () => ({}) }) },
  ipcMain: { handle: (name: string, handler: any) => handlers.set(name, handler), on: (name: string, handler: any) => events.set(name, handler) },
}));
const { registerIpcHandlers } = await import("../../src/main/ipc/register");

test("all privileged IPC handlers and native drag reject untrusted frames", async () => {
  let touched = false;
  const factory = () => { touched = true; throw new Error("Privileged access"); };
  registerIpcHandlers(factory, factory, factory);
  const frame = { url: "sounddesigner://app/index.html" };
  const sender = { mainFrame: frame, isDestroyed: () => true };
  expect(isTrustedUiSender({ sender, senderFrame: frame })).toBe(true);
  const untrusted = [null, { url: "https://attacker.test/" }, { url: frame.url }, { url: "about:blank" }];
  expect(handlers.size).toBeGreaterThan(30);
  for (const senderFrame of untrusted) {
    for (const handler of handlers.values()) {
      const result = await handler({ sender, senderFrame });
      expect(result).toEqual({ ok: false, error: { code: "UNTRUSTED_SENDER", message: "Only the SoundDesigner window can perform this operation." } });
    }
    await events.get("audio:start-drag")!({ sender, senderFrame });
  }
  expect(touched).toBe(false);
  const storage = { info: { root: "test-root", manifestPath: "test-manifest" } };
  registerIpcHandlers(factory, factory, () => storage as any);
  expect(await handlers.get("storage:get-info")!({ sender, senderFrame: frame })).toEqual({ ok: true, data: storage.info });
});
