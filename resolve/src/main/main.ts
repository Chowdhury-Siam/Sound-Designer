import path from "node:path";
import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { app, BrowserWindow, dialog, Menu, nativeImage, protocol } from "electron";
import { PLUGIN_ID } from "../shared/types";
import { registerIpcHandlers } from "./ipc/register";
import { NativeResolveHost, ResolveHostError, type WorkflowIntegrationModule } from "./services/resolveHost";
import { LibraryService } from "./services/libraryService";
import { StorageService } from "./services/storageService";
import { isSupportedMediaPath, resolveMediaRange, resolveUiAssetPath } from "./uiProtocol";

let mainWindow: any = null;
let host: NativeResolveHost | null = null;
let library: LibraryService | null = null;
let libraryRoot = "";
let storage: StorageService | null = null;
let cleanupStarted = false;

const getPluginRoot = (): string => app.getAppPath();

const UI_SCHEME = "sounddesigner";
const UI_HOST = "app";
const MEDIA_HOST = "media";
const UI_ORIGIN = `${UI_SCHEME}://${UI_HOST}`;
const WINDOW_ICON = nativeImage.createFromDataURL("data:image/png;base64,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");
const UI_CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".aac": "audio/aac",
  ".aif": "audio/aiff",
  ".aiff": "audio/aiff",
  ".caf": "audio/x-caf",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".opus": "audio/ogg; codecs=opus",
  ".wma": "audio/x-ms-wma",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: UI_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const registerUiProtocol = (): void => {
  const uiRoot = path.resolve(getPluginRoot(), "ui");

  protocol.handle(UI_SCHEME, async (request: Request) => {
    const requestedUrl = new URL(request.url);
    if (requestedUrl.host === MEDIA_HOST) {
      try {
        const encodedPath = requestedUrl.pathname.replace(/^\/+/, "");
        const filePath = Buffer.from(encodedPath, "base64url").toString("utf8");
        const extension = path.extname(filePath).toLowerCase();
        if (!isSupportedMediaPath(filePath)) {
          return new Response("Unsupported media path.", { status: 400 });
        }
        const details = await stat(filePath);
        if (!details.isFile()) return new Response("SoundDesigner media file was not found.", { status: 404 });
        if (details.size > 512 * 1024 * 1024) return new Response("Media file is too large.", { status: 413 });
        const rangeHeader = request.headers.get("range");
        const range = resolveMediaRange(rangeHeader, details.size, 2 * 1024 * 1024);
        if (rangeHeader && !range) {
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${details.size}` } });
        }
        let body: Uint8Array;
        if (range) {
          const handle = await open(filePath, "r");
          try {
            const bytes = Buffer.alloc(range.end - range.start + 1);
            const { bytesRead } = await handle.read(bytes, 0, bytes.length, range.start);
            body = new Uint8Array(bytes.subarray(0, bytesRead));
          } finally {
            await handle.close();
          }
        } else {
          body = new Uint8Array(await readFile(filePath));
        }
        return new Response(new Uint8Array(body), {
          status: range ? 206 : 200,
          headers: {
            "content-type": UI_CONTENT_TYPES[extension] ?? `audio/${extension.slice(1)}`,
            "content-length": String(body.byteLength),
            "accept-ranges": "bytes",
            ...(range ? { "content-range": `bytes ${range.start}-${range.start + body.byteLength - 1}/${details.size}` } : {}),
            "x-content-type-options": "nosniff",
          },
        });
      } catch {
        return new Response("SoundDesigner media file was not found.", { status: 404 });
      }
    }
    const filePath = resolveUiAssetPath(request.url, uiRoot);
    if (!filePath || !existsSync(filePath)) {
      return new Response(`SoundDesigner UI asset not found: ${request.url}`, { status: 404 });
    }

    try {
      const contents = await readFile(filePath);
      return new Response(new Uint8Array(contents), {
        status: 200,
        headers: {
          "content-type": UI_CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
          "x-content-type-options": "nosniff",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return new Response(`SoundDesigner UI asset read failed: ${message}`, { status: 500 });
    }
  });
};

const loadWorkflowIntegration = (): WorkflowIntegrationModule => {
  const pluginRoot = getPluginRoot();
  const modulePath = path.join(pluginRoot, "WorkflowIntegration.node");
  if (!existsSync(modulePath)) {
    throw new ResolveHostError("NATIVE_MODULE_MISSING", "WorkflowIntegration.node is missing from the plugin package.");
  }
  const requireNative = createRequire(path.join(pluginRoot, "package.json"));
  return requireNative(modulePath) as WorkflowIntegrationModule;
};

const getHost = (): NativeResolveHost => {
  if (!host) host = new NativeResolveHost(loadWorkflowIntegration(), PLUGIN_ID);
  return host;
};

const getStorage = (): StorageService => {
  if (!storage) throw new ResolveHostError("STORAGE_NOT_READY", "SoundDesigner storage is not initialized.");
  return storage;
};

const getLibrary = (): LibraryService => {
  const currentRoot = getStorage().root;
  if (!library || libraryRoot !== currentRoot) {
    library = new LibraryService(getStorage());
    libraryRoot = currentRoot;
  }
  return library;
};

const initializeStorage = async (): Promise<boolean> => {
  const pointerDirectory = path.join(app.getPath("appData"), "SoundDesigner");
  storage = new StorageService(pointerDirectory, path.join(app.getPath("documents"), "SoundDesigner"), path.join(app.getPath("userData"), "SoundDesigner Resolve"));
  if (await storage.hasConfiguredRoot()) {
    await storage.initialize();
    return true;
  }

  const choice = await dialog.showMessageBox({
    type: "question",
    title: "Choose SoundDesigner storage",
    message: "Where should SoundDesigner save project audio?",
    detail: `DaVinci Resolve requires a central audio folder. Settings and library records are saved automatically on this computer.\n\nDefault: ${path.join(app.getPath("documents"), "SoundDesigner")}`,
    buttons: ["Use default folder", "Choose folder", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  });
  if (choice.response === 2) return false;
  let selectedRoot: string | undefined;
  if (choice.response === 1) {
    const selection = await dialog.showOpenDialog({
      title: "Choose or create a SoundDesigner storage folder",
      buttonLabel: "Use this folder",
      properties: ["openDirectory", "createDirectory"],
    });
    selectedRoot = selection.canceled ? undefined : selection.filePaths[0];
  }
  if (choice.response === 1 && !selectedRoot) return false;
  await storage.initialize(selectedRoot);
  return true;
};

const cleanup = async (): Promise<void> => {
  if (cleanupStarted) return;
  cleanupStarted = true;
  await host?.cleanup().catch((error) => console.error("SoundDesigner cleanup failed", error));
};

const createWindow = (): void => {
  const uiEntry = `${UI_ORIGIN}/index.html`;
  mainWindow = new BrowserWindow({
    title: "SoundDesigner",
    icon: WINDOW_ICON,
    width: 900,
    height: 760,
    minWidth: 340,
    minHeight: 320,
    useContentSize: true,
    backgroundColor: "#111214",
    show: false,
    webPreferences: {
      preload: path.join(getPluginRoot(), "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      devTools: false,
    },
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event: any, requestedUrl: string) => {
    if (!requestedUrl.startsWith(`${UI_ORIGIN}/`)) event.preventDefault();
  });
  mainWindow.webContents.on("did-fail-load", (_event: any, code: number, description: string, url: string) => {
    console.error(`SoundDesigner renderer failed to load (${code}): ${description} [${url}]`);
  });
  mainWindow.webContents.on("preload-error", (_event: any, preloadPath: string, error: Error) => {
    console.error(`SoundDesigner preload failed [${preloadPath}]`, error);
  });
  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(uiEntry).catch((error: Error) => {
    console.error("SoundDesigner renderer navigation failed", error);
    mainWindow?.show();
  });
};

app.setAppUserModelId(PLUGIN_ID);

app.whenReady().then(async () => {
  if (!await initializeStorage()) {
    app.quit();
    return;
  }
  // Keep existing Chromium state and legacy storage paths when branding the hosted runtime.
  const userDataPath = app.getPath("userData");
  app.setName("SoundDesigner");
  app.setPath("userData", userDataPath);
  if (process.platform === "darwin") {
    app.dock?.setIcon(WINDOW_ICON);
    // Electron's label alone cannot override the native application-menu title.
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: "SoundDesigner", submenu: [
        { role: "about", label: "About SoundDesigner" },
        { type: "separator" },
        { role: "hide", label: "Hide SoundDesigner" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit", label: "Quit SoundDesigner" },
      ] },
      { role: "editMenu" },
      { role: "windowMenu" },
    ]));
    try {
      const requireNative = createRequire(path.join(getPluginRoot(), "package.json"));
      requireNative(path.join(getPluginRoot(), "macos-menu.node"));
    } catch (error) {
      console.error("SoundDesigner native menu branding failed", error);
    }
  }
  registerUiProtocol();
  registerIpcHandlers(getHost, getLibrary, getStorage);
  createWindow();
}).catch(async (error: unknown) => {
  console.error("SoundDesigner startup failed", error);
  await dialog.showMessageBox({
    type: "error",
    title: "SoundDesigner could not start",
    message: error instanceof Error ? error.message : "The SoundDesigner storage folder could not be opened.",
  });
  app.quit();
});

app.on("before-quit", (event: any) => {
  if (cleanupStarted) return;
  event.preventDefault();
  void cleanup().finally(() => app.quit());
});

app.on("window-all-closed", () => app.quit());

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
