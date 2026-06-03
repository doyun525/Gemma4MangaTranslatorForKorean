import { app, BrowserWindow, screen } from "electron";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppPaths } from "./appPaths";
import { logError, writeLog } from "./logger";

type WindowState = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  isMaximized?: boolean;
};

const DEFAULT_WINDOW_BOUNDS = {
  width: 1600,
  height: 980,
  minWidth: 1240,
  minHeight: 760
};

export function createMainWindow(appPaths: AppPaths): BrowserWindow {
  const restoredState = readWindowState(appPaths);
  const initialBounds = resolveInitialWindowBounds(restoredState);
  const window = new BrowserWindow({
    ...initialBounds,
    minWidth: DEFAULT_WINDOW_BOUNDS.minWidth,
    minHeight: DEFAULT_WINDOW_BOUNDS.minHeight,
    backgroundColor: "#101114",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });
  if (restoredState?.isMaximized) {
    window.maximize();
  }
  registerWindowStatePersistence(window, appPaths);

  window.webContents.on("console-message", (details) => {
    const level =
      details.level === "warning" ? "warn" : details.level === "error" ? "error" : details.level === "debug" ? "debug" : "info";
    writeLog(level, "renderer console", {
      message: details.message,
      line: details.lineNumber,
      sourceId: details.sourceId
    });
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logError("Renderer failed to load", { errorCode, errorDescription, validatedURL });
  });

  window.setMenuBarVisibility(false);

  const devRendererUrl = resolveAllowedDevRendererUrl(process.env.ELECTRON_RENDERER_URL);
  if (devRendererUrl) {
    void window.loadURL(devRendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

function readWindowState(appPaths: AppPaths): WindowState | null {
  const statePath = getWindowStatePath(appPaths);
  try {
    if (!existsSync(statePath)) {
      return null;
    }
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as WindowState;
    return isUsableWindowState(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function registerWindowStatePersistence(window: BrowserWindow, appPaths: AppPaths): void {
  const save = () => saveWindowState(window, appPaths);
  window.on("close", save);
}

function saveWindowState(window: BrowserWindow, appPaths: AppPaths): void {
  try {
    const bounds = window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds();
    const state: WindowState = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
      isMaximized: window.isMaximized()
    };
    writeFileSync(getWindowStatePath(appPaths), `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // Window state is a convenience cache; startup should never depend on it.
  }
}

function getWindowStatePath(appPaths: AppPaths): string {
  return join(appPaths.dataRoot, "window-state.json");
}

function resolveInitialWindowBounds(state: WindowState | null): { x?: number; y?: number; width: number; height: number } {
  if (!state || !isUsableWindowState(state)) {
    return {
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: DEFAULT_WINDOW_BOUNDS.height
    };
  }

  const bounds = {
    x: Math.round(Number(state.x)),
    y: Math.round(Number(state.y)),
    width: Math.round(Number(state.width)),
    height: Math.round(Number(state.height))
  };
  if (!intersectsAnyDisplay(bounds)) {
    return {
      width: DEFAULT_WINDOW_BOUNDS.width,
      height: DEFAULT_WINDOW_BOUNDS.height
    };
  }
  return bounds;
}

function isUsableWindowState(value: WindowState | null | undefined): value is Required<Pick<WindowState, "x" | "y" | "width" | "height">> & WindowState {
  if (!value) {
    return false;
  }
  return (
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.width) &&
    Number.isFinite(value.height) &&
    Number(value.width) >= DEFAULT_WINDOW_BOUNDS.minWidth &&
    Number(value.height) >= DEFAULT_WINDOW_BOUNDS.minHeight
  );
}

function intersectsAnyDisplay(bounds: { x: number; y: number; width: number; height: number }): boolean {
  const windowRight = bounds.x + bounds.width;
  const windowBottom = bounds.y + bounds.height;
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    const displayRight = area.x + area.width;
    const displayBottom = area.y + area.height;
    const overlapWidth = Math.max(0, Math.min(windowRight, displayRight) - Math.max(bounds.x, area.x));
    const overlapHeight = Math.max(0, Math.min(windowBottom, displayBottom) - Math.max(bounds.y, area.y));
    return overlapWidth >= 120 && overlapHeight >= 120;
  });
}

function resolveAllowedDevRendererUrl(value: string | undefined): string | null {
  if (app.isPackaged || !value) {
    return null;
  }
  try {
    const url = new URL(value);
    const allowedHost = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
    return url.protocol === "http:" && allowedHost ? url.toString() : null;
  } catch {
    return null;
  }
}
