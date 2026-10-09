declare module "electron" {
  export const app: any;
  export const BrowserWindow: any;
  export const dialog: any;
  export const ipcMain: any;
  export const Menu: any;
  export const nativeImage: any;
  export const protocol: any;
  export const shell: any;
}

declare module "electron/renderer" {
  export const contextBridge: any;
  export const ipcRenderer: any;
}
