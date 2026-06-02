import { BrowserWindow, WebContentsView, session, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import type {
  CaptureWebSegmentResult,
  OpenWebBrowseRequest,
  OpenWebBrowseResult,
  WebBrowseBounds,
  WebBrowseMode,
  WebBrowseState,
  WebCaptureMode,
  WebPageSourceMeta
} from "../shared/types";
import { appendWebCapturePage, createWebChapter } from "./library";

type WebBrowseSession = {
  sessionId: string;
  chapterId: string;
  view: WebContentsView;
  startUrl: string;
  mode: WebBrowseMode;
  autoTranslate: boolean;
  segmentCount: number;
  title?: string;
  lastBounds: WebBrowseBounds;
};

export class WebBrowserManager {
  private sessions = new Map<string, WebBrowseSession>();

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  async open(request: OpenWebBrowseRequest): Promise<OpenWebBrowseResult> {
    if (!isAllowedWebUrl(request.url)) {
      throw new Error("웹 페이지는 http 또는 https URL만 열 수 있습니다.");
    }
    const mainWindow = this.requireMainWindow();
    const sessionId = randomUUID();
    const partition = `persist:mgt-web-${sessionId}`;
    const webSession = session.fromPartition(partition);
    webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        partition
      }
    });
    this.configureWebContents(view.webContents);
    mainWindow.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    let openedChapter;
    let finalUrl = request.url;
    let pageTitle = request.title || new URL(request.url).hostname || "웹 번역";
    try {
      await view.webContents.loadURL(request.url);
      finalUrl = view.webContents.getURL() || request.url;
      pageTitle = request.title || view.webContents.getTitle() || new URL(request.url).hostname || "웹 번역";
      openedChapter = await createWebChapter({
        target: request.target,
        title: pageTitle,
        startUrl: request.url,
        finalUrl
      });
    } catch (error) {
      try {
        mainWindow.contentView.removeChildView(view);
        view.webContents.close();
      } catch {
        // Ignore cleanup failures after a partial BrowserView/WebContentsView initialization.
      }
      throw error;
    }

    this.sessions.set(sessionId, {
      sessionId,
      chapterId: openedChapter.id,
      view,
      startUrl: request.url,
      mode: request.mode || "manual",
      autoTranslate: false,
      segmentCount: 0,
      title: pageTitle,
      lastBounds: { x: 0, y: 0, width: 0, height: 0 }
    });

    return {
      sessionId,
      chapterId: openedChapter.id,
      openedChapter,
      url: finalUrl,
      title: pageTitle
    };
  }

  close(sessionId: string): void {
    const item = this.sessions.get(sessionId);
    if (!item) {
      return;
    }
    this.sessions.delete(sessionId);
    try {
      this.getMainWindow()?.contentView.removeChildView(item.view);
      item.view.webContents.close();
    } catch {
      // Closing a destroyed view should not interrupt app shutdown or UI cleanup.
    }
  }

  closeAll(): void {
    for (const sessionId of [...this.sessions.keys()]) {
      this.close(sessionId);
    }
  }

  setBounds(sessionId: string, bounds: WebBrowseBounds): WebBrowseState {
    const item = this.requireSession(sessionId);
    item.lastBounds = bounds;
    item.view.setBounds(bounds);
    return this.getState(sessionId);
  }

  async scroll(sessionId: string, deltaY: number): Promise<WebBrowseState> {
    const item = this.requireSession(sessionId);
    await item.view.webContents.executeJavaScript(`window.scrollBy({ top: ${JSON.stringify(deltaY)}, behavior: "smooth" });`, true);
    return this.getState(sessionId);
  }

  setAutoTranslate(sessionId: string, enabled: boolean): WebBrowseState {
    const item = this.requireSession(sessionId);
    item.autoTranslate = enabled;
    return this.getState(sessionId);
  }

  getState(sessionId: string): WebBrowseState {
    const item = this.requireSession(sessionId);
    return {
      sessionId,
      chapterId: item.chapterId,
      url: item.view.webContents.getURL() || item.startUrl,
      title: item.view.webContents.getTitle() || item.title,
      mode: item.mode,
      segmentCount: item.segmentCount,
      autoTranslate: item.autoTranslate
    };
  }

  async captureSegment(sessionId: string, captureMode: WebCaptureMode = "viewport"): Promise<CaptureWebSegmentResult> {
    if (captureMode !== "viewport") {
      throw new Error("현재 웹 캡처 MVP는 현재 화면(viewport) 캡처만 지원합니다.");
    }
    const item = this.requireSession(sessionId);
    const webContents = item.view.webContents;
    const image = await webContents.capturePage();
    const buffer = image.toPNG();
    if (buffer.length === 0) {
      throw new Error("웹 페이지 캡처가 비어 있습니다.");
    }

    const metrics = await readWebMetrics(webContents);
    const segmentIndex = item.segmentCount;
    const now = new Date().toISOString();
    const finalUrl = webContents.getURL() || item.startUrl;
    const webMeta: WebPageSourceMeta = {
      url: item.startUrl,
      finalUrl,
      segmentIndex,
      scrollY: metrics.scrollY,
      viewport: {
        width: metrics.viewportWidth || Math.max(1, item.lastBounds.width),
        height: metrics.viewportHeight || Math.max(1, item.lastBounds.height),
        deviceScaleFactor: metrics.deviceScaleFactor || 1
      },
      captureMode,
      capturedAt: now,
      contentHash: createHash("sha256").update(buffer).digest("hex")
    };

    const chapter = await appendWebCapturePage({
      chapterId: item.chapterId,
      imageBuffer: buffer,
      extension: ".png",
      webMeta,
      pageName: `web-${String(segmentIndex + 1).padStart(3, "0")}.png`
    });
    item.segmentCount += 1;
    return {
      sessionId,
      chapter,
      pageId: chapter.pageOrder[chapter.pageOrder.length - 1]!,
      segmentIndex,
      translated: false
    };
  }

  private configureWebContents(webContents: WebContents): void {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedWebUrl(url)) {
        event.preventDefault();
      }
    });
  }

  private requireMainWindow(): BrowserWindow {
    const mainWindow = this.getMainWindow();
    if (!mainWindow) {
      throw new Error("메인 창이 준비되지 않았습니다.");
    }
    return mainWindow;
  }

  private requireSession(sessionId: string): WebBrowseSession {
    const item = this.sessions.get(sessionId);
    if (!item) {
      throw new Error("웹 브라우저 세션을 찾지 못했습니다.");
    }
    return item;
  }
}

function isAllowedWebUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function readWebMetrics(webContents: WebContents): Promise<{
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  deviceScaleFactor: number;
}> {
  const fallback = { scrollY: 0, viewportWidth: 0, viewportHeight: 0, deviceScaleFactor: 1 };
  try {
    const raw = await webContents.executeJavaScript(
      `({
        scrollY: Math.max(0, Math.round(window.scrollY || 0)),
        viewportWidth: Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0)),
        viewportHeight: Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0)),
        deviceScaleFactor: Number(window.devicePixelRatio || 1)
      })`,
      true
    );
    return {
      scrollY: Number(raw?.scrollY) || fallback.scrollY,
      viewportWidth: Number(raw?.viewportWidth) || fallback.viewportWidth,
      viewportHeight: Number(raw?.viewportHeight) || fallback.viewportHeight,
      deviceScaleFactor: Number(raw?.deviceScaleFactor) || fallback.deviceScaleFactor
    };
  } catch {
    return fallback;
  }
}
