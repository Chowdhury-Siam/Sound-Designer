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
const WINDOW_ICON = nativeImage.createFromDataURL("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAARUSURBVHhe7Zu7a1RBFIfz34ik8AGSRkUIFqYJFmoTm2ARbGIhWsQiKogWaiEKooUogiIoCMEiICgWwSJYKBaxCTaxCDaxXvktOXD2m5l7d+9zIffCV+zecx/zm/Oa2WRioju6o3/smzxwYv/koeW9gsY7IMDuid4eYrkToBOgE6AToDUBDh6e6s2dn+8dmToWnGuI9gTQ4Dc3f/d2dv71trf/9o4enw5sGqA9Aa5cXeoP3nj+4mVg0wDtCfDw0eMBAdbWvgY2DdCeACsrHwYE2Nr6E9g0QHsCrK9/GxBAtJAH2hNAM04B5i8sBHY1044AmmkOXty4eSuwrZnqBRimrp85NxcMXrRQCaoTQHX9+4+f/YHIvadPzgQ2Bkug0UIlqE4Aua8fzKvXbwIb4979B8HghRoi2tZMdQKsrn4cGMzGxq/Axnj77n0weOPUzGxgT6yFzvKyIalGAL2QZo+DSb2gXJ22xsLFxcCez5K4slWozZ4+G9iMQDUCqHxxIEKxTlsRK4HG7Tt3A3sPQ039BG1GoBoBnjx9FgxExPKAKgTtPAoPXuNhBykWL10O7IakGgHMJUksD8hlvQ1DJ29GY96jVaVCg7ZDUF4AxTlfyMM8oNny5z99/jLwOasSZD2rYBNVXgDGJGEeUIz781oV2r6AkaoEqf5B6B4F1hLlBWD542CYB/TZn1+6dj24R6oS8FqiXMRrcignQKz80SOYB+jyqiBMoqlKYJ2mwc8FdpbKCcDypxeKZXmfB+ghOicv8N8p0/NZqfvyfnlVBJQTgDNnLsi1vuUBeYz/3hIeF0cSks9SWHgbqxb0ODFCczScABqA+ndC9dWeyp7CWB5gCbSBxmaXZS11T7+5aqjT5LtqDLxnrgB+hZeHZtMewNmyPMDvlfzsWewlOItsn3114X1TqIdAjsgWIKvsEB+3sRlVvNJdfdZmh+e7u1iyZX/BsEuBBJstgNTig1NwO4svJDG14eG/880Ld4n12c4ptPw5ubx/lmBCTqF8M7QAQk0J44nE6nYsZlnvvWjsEL1H6Rmpcx69B9/Nw0kaSoCiMC4V44xz3/GlEqRgeBRse2PUJ0AsDxCflVki/XkugJggS1CfAIJ5wMMOUbDiaKD0jKzFUgHqFYB5wONLoEFXV+Jk5VArzetKUK8AzAOe2BY4K4EE5AJIyYzXlaBeAbLyQGzBw0ogL2HitG6zIuoVQKTyQKx0xuKd1+X96DIi9QuQygOpTB4btJG3XVaA+gVI5YHIwqRPymNEgQ2PPOoXIJYHYq2skfWjSSxsSlK/AIKzmvUbIPcMPVwAVUAzAjAPcJ/QkwqZWONUAc0IoJ7fJ7csV5YtB58nWgmaEUCofidWZAGxSqB9Q9pVQHMCjAJzhkiVzZKMpwCsBDX+Bdl4CsBKkNoAqYDxFIBbccPkjYKMpwDCkmZWxaiA8RWgIToBOgE6AToBOgE6AToBdo89/7/De/X4D1ggkecyAslWAAAAAElFTkSuQmCC");
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
