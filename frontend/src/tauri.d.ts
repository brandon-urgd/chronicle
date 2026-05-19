/** Tauri global type declarations */
interface TauriDialogSaveOptions {
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

interface TauriFs {
  writeBinaryFile(path: string, contents: Uint8Array): Promise<void>;
}

interface TauriDialog {
  save(options?: TauriDialogSaveOptions): Promise<string | null>;
}

interface TauriPath {
  documentsDir(): Promise<string>;
}

interface Window {
  __TAURI__?: {
    dialog?: TauriDialog;
    fs?: TauriFs;
    path?: TauriPath;
    [key: string]: unknown;
  };
}
