import type { BrowserWindow } from "electron";
import type { AppPaths } from "../appPaths";
import type { ActiveJobStore } from "../jobs/activeJob";
import type { ImageDecodeFallback } from "../regionCrop";
import type { SimplePageRuntime } from "../simplePageRuntime";
import type { TranslationWarmupManager } from "../translationWarmup";
import type { WebBrowserManager } from "../webBrowserManager";

export type IpcContext = {
  appPaths: AppPaths;
  jobs: ActiveJobStore;
  getMainWindow: () => BrowserWindow | null;
  loadSimplePageRuntime: () => SimplePageRuntime;
  decodeImage: ImageDecodeFallback;
  translationWarmup: TranslationWarmupManager;
  webBrowser: WebBrowserManager;
};
