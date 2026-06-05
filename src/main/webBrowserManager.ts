import { BrowserWindow, WebContentsView, session, type WebContents } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import type {
  CaptureWebSegmentResult,
  MangaPage,
  OpenWebBrowseRequest,
  OpenWebBrowseResult,
  ReopenWebChapterRequest,
  SelectWebRegionResult,
  TranslationBlock,
  WebBrowseBounds,
  WebBrowseMode,
  WebBrowseState,
  WebCaptureMode,
  WebOverlayRenderBlock,
  WebPageSourceMeta
} from "../shared/types";
import { formatStoredTimestamp } from "../shared/storedTimestamp";
import {
  BLOCK_CORNER_RADIUS_SCALE,
  DEFAULT_BLOCK_CORNER_RADIUS_PX,
  MAX_BLOCK_CORNER_RADIUS_PX,
  MIN_BLOCK_CORNER_RADIUS_PX
} from "../shared/blockVisuals";
import { appendWebCapturePage, createWebChapter, openChapter, saveChapterSnapshot } from "./library";
import { logInfo } from "./logger";

type WebBrowseSession = {
  sessionId: string;
  chapterId: string;
  view: WebContentsView;
  startUrl: string;
  mode: WebBrowseMode;
  autoTranslate: boolean;
  overlayInteractionEnabled: boolean;
  segmentCount: number;
  title?: string;
  lastBounds: WebBrowseBounds;
};

type WebMetrics = {
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  deviceScaleFactor: number;
};

type WebCaptureTile = {
  buffer: Buffer;
  bitmap: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  cropTop: number;
  cropBottom: number;
  scrollY: number;
  width: number;
  height: number;
  index: number;
  total: number;
};

const MAX_SINGLE_WEB_CAPTURE_HEIGHT = 32_000;
const WEB_CAPTURE_TILE_OVERLAP_RATIO = 0.25;
const WEB_CAPTURE_TILE_MAX_OVERLAP_PX = 360;
const WEB_CAPTURE_TILE_MAX_EDGE_CROP_PX = 140;
const WEB_OCR_TILE_TARGET_HEIGHT_PX = 3200;
const WEB_OCR_TILE_OVERLAP_PX = 420;

export class WebBrowserManager {
  private sessions = new Map<string, WebBrowseSession>();

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  async open(request: OpenWebBrowseRequest): Promise<OpenWebBrowseResult> {
    if (!isAllowedWebUrl(request.url)) {
      throw new Error("웹 페이지는 http 또는 https URL만 열 수 있습니다.");
    }
    this.closeStaleSessionsBeforeOpen("open");
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
        partition,
        backgroundThrottling: false
      }
    });
    this.configureWebContents(view.webContents, sessionId);
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
      overlayInteractionEnabled: false,
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

  async reopenChapter(request: ReopenWebChapterRequest): Promise<OpenWebBrowseResult> {
    const openedChapter = await openChapter(request.chapterId);
    if (openedChapter.sourceKind !== "web" || !openedChapter.webOrigin?.startUrl) {
      throw new Error("웹 주소가 저장된 화가 아닙니다.");
    }
    this.closeStaleSessionsBeforeOpen("reopen");
    const startUrl = openedChapter.webOrigin.finalUrl || openedChapter.webOrigin.startUrl;
    if (!isAllowedWebUrl(startUrl)) {
      throw new Error("저장된 웹 주소가 http 또는 https URL이 아닙니다.");
    }

    const mainWindow = this.requireMainWindow();
    const sessionId = randomUUID();
    const partition = `persist:mgt-web-${openedChapter.id}`;
    const webSession = session.fromPartition(partition);
    webSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        webSecurity: true,
        partition,
        backgroundThrottling: false
      }
    });
    this.configureWebContents(view.webContents, sessionId);
    mainWindow.contentView.addChildView(view);
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

    let finalUrl = startUrl;
    let pageTitle = openedChapter.webOrigin.title || openedChapter.title;
    try {
      await view.webContents.loadURL(startUrl);
      finalUrl = view.webContents.getURL() || startUrl;
      pageTitle = view.webContents.getTitle() || pageTitle;
    } catch (error) {
      try {
        mainWindow.contentView.removeChildView(view);
        view.webContents.close();
      } catch {
        // Ignore cleanup failures after a partial WebContentsView initialization.
      }
      throw error;
    }

    this.sessions.set(sessionId, {
      sessionId,
      chapterId: openedChapter.id,
      view,
      startUrl: openedChapter.webOrigin.startUrl,
      mode: request.mode || "manual",
      autoTranslate: false,
      overlayInteractionEnabled: false,
      segmentCount: openedChapter.pages.length,
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
      setWebContentsViewVisible(item.view, false);
      item.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
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

  private closeStaleSessionsBeforeOpen(reason: "open" | "reopen"): void {
    if (this.sessions.size === 0) {
      return;
    }
    logInfo("Closing stale web browser sessions before opening a new one", {
      reason,
      sessionCount: this.sessions.size,
      sessionIds: [...this.sessions.keys()]
    });
    this.closeAll();
  }

  hasActiveSessions(): boolean {
    return this.sessions.size > 0;
  }

  getActiveSessionCount(): number {
    return this.sessions.size;
  }

  setBounds(sessionId: string, bounds: WebBrowseBounds): WebBrowseState {
    const item = this.requireSession(sessionId);
    item.lastBounds = bounds;
    item.view.setBounds(bounds);
    setWebContentsViewVisible(item.view, bounds.width > 0 && bounds.height > 0);
    return this.getState(sessionId);
  }

  async scroll(sessionId: string, deltaY: number): Promise<WebBrowseState> {
    const item = this.requireSession(sessionId);
    await item.view.webContents.executeJavaScript(`window.scrollBy({ top: ${JSON.stringify(deltaY)}, behavior: "smooth" });`, true);
    return this.getState(sessionId);
  }

  reload(sessionId: string): WebBrowseState {
    const item = this.requireSession(sessionId);
    item.view.webContents.reload();
    return this.getState(sessionId);
  }

  setAutoTranslate(sessionId: string, enabled: boolean): WebBrowseState {
    const item = this.requireSession(sessionId);
    item.autoTranslate = enabled;
    return this.getState(sessionId);
  }

  async setOverlayInteraction(sessionId: string, enabled: boolean): Promise<WebBrowseState> {
    const item = this.requireSession(sessionId);
    item.overlayInteractionEnabled = enabled;
    await item.view.webContents.executeJavaScript(`(() => {
      if (typeof window.__mgtSetTranslationOverlayInteraction === "function") {
        window.__mgtSetTranslationOverlayInteraction(${JSON.stringify(enabled)});
      }
      return true;
    })();`, true).catch(() => undefined);
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
    if (captureMode === "element") {
      throw new Error("요소 단위 웹 캡처는 아직 지원하지 않습니다.");
    }
    const item = this.requireSession(sessionId);
    const webContents = item.view.webContents;
    const overlayWasHidden = await setTranslationOverlayCaptureHidden(webContents, true);
    let fixedElementsWereHidden = false;
    let buffer: Buffer;
    let metrics = await readWebMetrics(webContents);
    try {
      if (captureMode === "full-page") {
        await primeLazyContentForFullPageCapture(webContents);
        metrics = await readWebMetrics(webContents);
        fixedElementsWereHidden = await setFixedElementsCaptureHidden(webContents, true);
      }
      logInfo("Web page capture metrics", {
        sessionId,
        captureMode,
        scrollX: metrics.scrollX,
        scrollY: metrics.scrollY,
        viewportWidth: metrics.viewportWidth,
        viewportHeight: metrics.viewportHeight,
        documentWidth: metrics.documentWidth,
        documentHeight: metrics.documentHeight,
        deviceScaleFactor: metrics.deviceScaleFactor
      });
      await waitForWebAnimationFrame(webContents);
      if (captureMode === "full-page") {
        if (metrics.documentHeight > MAX_SINGLE_WEB_CAPTURE_HEIGHT) {
          return await this.captureTiledFullPage(item, metrics);
        }
        buffer = await captureFullPageByScrollStitch(webContents, metrics);
      } else {
        const image = await webContents.capturePage();
        buffer = image.toPNG();
      }
      if (buffer.length === 0) {
        throw new Error("웹 페이지 캡처가 비어 있습니다.");
      }
    } finally {
      await setFixedElementsCaptureHidden(webContents, false, fixedElementsWereHidden);
      await setTranslationOverlayCaptureHidden(webContents, false, overlayWasHidden);
    }

    const segmentIndex = item.segmentCount;
    const now = formatStoredTimestamp();
    const finalUrl = webContents.getURL() || item.startUrl;
    const captureWidth = captureMode === "full-page" ? metrics.documentWidth || metrics.viewportWidth : metrics.viewportWidth;
    const captureHeight = captureMode === "full-page" ? metrics.documentHeight || metrics.viewportHeight : metrics.viewportHeight;
    const contentRectCss = await readWebContentRect(webContents);
    const webMeta: WebPageSourceMeta = {
      url: item.startUrl,
      finalUrl,
      segmentIndex,
      scrollX: captureMode === "full-page" ? 0 : metrics.scrollX,
      scrollY: captureMode === "full-page" ? 0 : metrics.scrollY,
      viewport: {
        width: captureMode === "full-page" ? metrics.viewportWidth || Math.max(1, item.lastBounds.width) : captureWidth || Math.max(1, item.lastBounds.width),
        height: captureMode === "full-page" ? metrics.viewportHeight || Math.max(1, item.lastBounds.height) : captureHeight || Math.max(1, item.lastBounds.height),
        deviceScaleFactor: metrics.deviceScaleFactor || 1
      },
      captureMode,
      captureRectCss: {
        x: captureMode === "full-page" ? 0 : metrics.scrollX,
        y: captureMode === "full-page" ? 0 : metrics.scrollY,
        width: captureWidth || Math.max(1, item.lastBounds.width),
        height: captureHeight || Math.max(1, item.lastBounds.height)
      },
      contentRectCss,
      capturedAt: now,
      contentHash: createHash("sha256").update(buffer).digest("hex")
    };

    const chapter = await appendWebCapturePage({
      chapterId: item.chapterId,
      imageBuffer: buffer,
      extension: ".png",
      webMeta,
      pageName: captureMode === "full-page"
        ? `web-full-${String(segmentIndex + 1).padStart(3, "0")}.png`
        : `web-${String(segmentIndex + 1).padStart(3, "0")}.png`
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

  private async captureTiledFullPage(item: WebBrowseSession, metrics: WebMetrics): Promise<CaptureWebSegmentResult> {
    const webContents = item.view.webContents;
    const segmentIndex = item.segmentCount;
    const finalUrl = webContents.getURL() || item.startUrl;
    const now = formatStoredTimestamp();
    const tiles = await captureFullPageTiles(webContents, metrics);
    if (tiles.length === 0) {
      throw new Error("전체 스크롤 캡처 타일이 비어 있습니다.");
    }
    const captureWidth = Math.max(1, ...tiles.map((tile) => tile.width), metrics.viewportWidth || 1);
    const lastTileEndY = Math.max(...tiles.map((tile) => tile.scrollY + tile.height));
    const captureHeight = Math.max(1, Math.ceil(metrics.documentHeight || 0), Math.ceil(lastTileEndY));
    const stitchedBuffer = stitchWebCaptureTilesToPng(tiles, captureWidth, captureHeight);
    const contentRectCss = await readWebContentRect(webContents);
    logInfo("Web full-page capture split into OCR tiles", {
      sessionId: item.sessionId,
      chapterId: item.chapterId,
      tileCount: tiles.length,
      documentWidth: captureWidth,
      documentHeight: captureHeight,
      viewportWidth: metrics.viewportWidth,
      viewportHeight: metrics.viewportHeight
    });

    const webMeta: WebPageSourceMeta = {
      url: item.startUrl,
      finalUrl,
      segmentIndex,
      scrollX: 0,
      scrollY: 0,
      viewport: {
        width: metrics.viewportWidth || captureWidth,
        height: metrics.viewportHeight || Math.min(captureHeight, MAX_SINGLE_WEB_CAPTURE_HEIGHT),
        deviceScaleFactor: metrics.deviceScaleFactor || 1
      },
      captureMode: "full-page",
      captureRectCss: {
        x: 0,
        y: 0,
        width: captureWidth,
        height: captureHeight
      },
      contentRectCss,
      capturedAt: now,
      contentHash: createHash("sha256").update(stitchedBuffer).digest("hex")
    };
    let chapter = await appendWebCapturePage({
      chapterId: item.chapterId,
      imageBuffer: stitchedBuffer,
      extension: ".png",
      webMeta,
      pageName: `web-full-${String(segmentIndex + 1).padStart(3, "0")}.png`,
      width: captureWidth,
      height: captureHeight
    });
    const pageId = chapter.pageOrder[chapter.pageOrder.length - 1]!;
    const page = chapter.pages.find((candidate) => candidate.id === pageId);
    if (!page) {
      throw new Error("전체 스크롤 캡처 페이지를 저장하지 못했습니다.");
    }
    const tileDir = join(dirname(page.imagePath), `${page.id}-ocr-tiles`);
    await mkdir(tileDir, { recursive: true });
    const ocrTiles: NonNullable<WebPageSourceMeta["ocrTiles"]> = [];
    const ocrTileRanges = buildWebOcrTileRanges(captureHeight);
    for (const [index, range] of ocrTileRanges.entries()) {
      const tilePath = join(tileDir, `ocr-tile-${String(index + 1).padStart(3, "0")}-of-${String(ocrTileRanges.length).padStart(3, "0")}.png`);
      const ocrTileBuffer = stitchWebCaptureTilesToPng(tiles, captureWidth, range.height, range.y);
      await writeFile(tilePath, ocrTileBuffer);
      ocrTiles.push({
        imagePath: tilePath,
        x: 0,
        y: range.y,
        width: captureWidth,
        height: range.height
      });
    }
    chapter = await saveChapterSnapshot({
      ...chapter,
      pages: chapter.pages.map((candidate) =>
        candidate.id === pageId
          ? {
              ...candidate,
              webMeta: {
                ...candidate.webMeta!,
                ocrTiles
              }
            }
          : candidate
      )
    });
    item.segmentCount += 1;
    return {
      sessionId: item.sessionId,
      chapter,
      pageId,
      segmentIndex,
      translated: false
    };
  }

  async selectRegion(sessionId: string): Promise<SelectWebRegionResult> {
    const item = this.requireSession(sessionId);
    const bbox = await item.view.webContents.executeJavaScript(WEB_REGION_SELECTION_SCRIPT, true);
    return { bbox: isUsableBbox(bbox) ? bbox : null };
  }

  async renderOverlay(sessionId: string, page: MangaPage, blocks?: WebOverlayRenderBlock[]): Promise<WebBrowseState> {
    const item = this.requireSession(sessionId);
    const payload = buildWebOverlayPayload(page, blocks);
    payload.interactionEnabled = item.overlayInteractionEnabled;
    logInfo("Web translation overlay render requested", {
      sessionId,
      pageId: page.id,
      pageName: page.name,
      blockCount: payload.blocks.length,
      scrollX: payload.scrollX,
      scrollY: payload.scrollY,
      viewportWidth: payload.viewportWidth,
      viewportHeight: payload.viewportHeight
    });
    const payloadJson = JSON.stringify(payload);
    const renderResult = await item.view.webContents.executeJavaScript(`(() => {
      const payload = ${payloadJson};
      if (payload.captureMode !== "full-page") {
        window.scrollTo(Number(payload.scrollX) || 0, Number(payload.scrollY) || 0);
      }
      if (typeof window.__mgtRenderTranslationOverlay === "function") {
        return window.__mgtRenderTranslationOverlay(payload);
      }
      return (${WEB_TRANSLATION_OVERLAY_SCRIPT})(payload);
    })();`, true);
    logInfo("Web translation overlay render completed", {
      sessionId,
      pageId: page.id,
      pageName: page.name,
      result: renderResult
    });
    return this.getState(sessionId);
  }

  private configureWebContents(webContents: WebContents, sessionId: string): void {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    webContents.on("will-navigate", (event, url) => {
      if (!isAllowedWebUrl(url)) {
        event.preventDefault();
      }
    });
    webContents.on("console-message", (_event, _level, message) => {
      const text = String(message);
      const selectPrefix = "__MGT_BLOCK_SELECT__";
      if (!text.startsWith(selectPrefix)) {
        return;
      }
      try {
        const payload = JSON.parse(text.slice(selectPrefix.length));
        const item = this.sessions.get(sessionId);
        const pageId = String(payload?.pageId || "");
        const blockId = String(payload?.blockId || "");
        if (!item || !pageId || !blockId) {
          return;
        }
        this.getMainWindow()?.webContents.send("web:overlay-block-selected", {
          sessionId,
          chapterId: item.chapterId,
          pageId,
          blockId
        });
      } catch {
        // Ignore malformed overlay click messages from untrusted page contexts.
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

function setWebContentsViewVisible(view: WebContentsView, visible: boolean): void {
  const maybeView = view as WebContentsView & { setVisible?: (visible: boolean) => void };
  if (typeof maybeView.setVisible === "function") {
    maybeView.setVisible(visible);
  }
}

async function readWebMetrics(webContents: WebContents): Promise<{
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  documentHeight: number;
  deviceScaleFactor: number;
}> {
  const fallback = { scrollX: 0, scrollY: 0, viewportWidth: 0, viewportHeight: 0, documentWidth: 0, documentHeight: 0, deviceScaleFactor: 1 };
  try {
    const raw = await webContents.executeJavaScript(
      String.raw`(() => {
        const viewportWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
        const viewportHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
        const findScrollRoot = () => {
          const scrolling = document.scrollingElement || document.documentElement;
          const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
          if (scrolling && scrollingOverflow > 8) {
            return scrolling;
          }
          let best = scrolling;
          let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
          for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
            const style = window.getComputedStyle(element);
            const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
            if (!canScroll) {
              continue;
            }
            const rect = element.getBoundingClientRect();
            const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
            if (!visible) {
              continue;
            }
            const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
            const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
            if (score > bestScore) {
              best = element;
              bestScore = score;
            }
          }
          return best || scrolling;
        };
        const scrollRoot = findScrollRoot();
        const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
        const rootRect = scrollRoot?.getBoundingClientRect?.() || { left: 0, top: 0 };
        const rootScrollX = isDocumentRoot ? (window.scrollX || 0) : (scrollRoot?.scrollLeft || 0);
        const rootScrollY = isDocumentRoot ? (window.scrollY || 0) : (scrollRoot?.scrollTop || 0);
        return {
          scrollX: Math.max(0, Math.round(rootScrollX)),
          scrollY: Math.max(0, Math.round(rootScrollY)),
          viewportWidth,
          viewportHeight,
          documentWidth: Math.max(
            1,
            Math.round(document.documentElement.scrollWidth || 0),
            Math.round(document.body?.scrollWidth || 0),
            Math.round((scrollRoot?.scrollWidth || 0) + Math.max(0, rootRect.left)),
            Math.round(window.innerWidth || 0)
          ),
          documentHeight: Math.max(
            1,
            Math.round(document.documentElement.scrollHeight || 0),
            Math.round(document.body?.scrollHeight || 0),
            Math.round((scrollRoot?.scrollHeight || 0) + Math.max(0, rootRect.top)),
            Math.round(window.innerHeight || 0)
          ),
          deviceScaleFactor: Number(window.devicePixelRatio || 1)
        };
      })()`,
      true
    );
    return {
      scrollX: Number(raw?.scrollX) || fallback.scrollX,
      scrollY: Number(raw?.scrollY) || fallback.scrollY,
      viewportWidth: Number(raw?.viewportWidth) || fallback.viewportWidth,
      viewportHeight: Number(raw?.viewportHeight) || fallback.viewportHeight,
      documentWidth: Number(raw?.documentWidth) || fallback.documentWidth,
      documentHeight: Number(raw?.documentHeight) || fallback.documentHeight,
      deviceScaleFactor: Number(raw?.deviceScaleFactor) || fallback.deviceScaleFactor
    };
  } catch {
    return fallback;
  }
}

async function readWebContentRect(webContents: WebContents): Promise<WebPageSourceMeta["contentRectCss"]> {
  try {
    const raw = await webContents.executeJavaScript(WEB_READ_CONTENT_RECT_SCRIPT, true);
    if (!isUsableWebRect(raw)) {
      return undefined;
    }
    return {
      x: Math.round(Number(raw.x)),
      y: Math.round(Number(raw.y)),
      width: Math.max(1, Math.round(Number(raw.width))),
      height: Math.max(1, Math.round(Number(raw.height)))
    };
  } catch {
    return undefined;
  }
}

function isUsableWebRect(value: unknown): value is { x: number; y: number; width: number; height: number } {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return Boolean(
    record &&
      Number.isFinite(record.x) &&
      Number.isFinite(record.y) &&
      Number.isFinite(record.width) &&
      Number.isFinite(record.height) &&
      Number(record.width) > 0 &&
      Number(record.height) > 0
  );
}

async function waitForWebAnimationFrame(webContents: WebContents): Promise<void> {
  await webContents.executeJavaScript(
    `new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(true);
      };
      setTimeout(finish, 180);
      requestAnimationFrame(() => requestAnimationFrame(finish));
    })`,
    true
  ).catch(() => undefined);
}

async function waitForStableScrollCapture(webContents: WebContents, targetY: number): Promise<{ scrollY: number; documentHeight: number }> {
  const raw = await webContents.executeJavaScript(String.raw`(async () => {
    const targetY = Math.max(0, Math.round(${JSON.stringify(targetY)}));
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(true)));
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const findScrollRoot = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
      if (scrolling && scrollingOverflow > 8) {
        return scrolling;
      }
      let best = scrolling;
      let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
      for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
        const style = window.getComputedStyle(element);
        const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
        if (!canScroll) continue;
        const rect = element.getBoundingClientRect();
        const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        if (!visible) continue;
        const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
        const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
      return best || scrolling;
    };
    const scrollRoot = findScrollRoot();
    const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
    const read = () => ({
      scrollY: Math.max(0, Math.round(isDocumentRoot ? (window.scrollY || document.documentElement.scrollTop || 0) : (scrollRoot.scrollTop || 0))),
      documentHeight: Math.max(
        viewportHeight,
        Math.round(scrollRoot?.scrollHeight || 0),
        Math.round(document.documentElement.scrollHeight || 0),
        Math.round(document.body?.scrollHeight || 0)
      )
    });
    let last = read();
    let stableCount = 0;
    for (let index = 0; index < 12; index += 1) {
      await frame();
      await sleep(index < 2 ? 80 : 45);
      const next = read();
      const scrollStable = Math.abs(next.scrollY - last.scrollY) <= 1;
      const heightStable = Math.abs(next.documentHeight - last.documentHeight) <= 1;
      const targetReached = Math.abs(next.scrollY - targetY) <= Math.max(2, viewportHeight * 0.02) || next.scrollY >= targetY;
      if (scrollStable && heightStable && targetReached) {
        stableCount += 1;
        if (stableCount >= 2) {
          return next;
        }
      } else {
        stableCount = 0;
      }
      last = next;
    }
    return read();
  })()`, true).catch(() => null);
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const scrollY = Number(record.scrollY);
  const documentHeight = Number(record.documentHeight);
  return {
    scrollY: Number.isFinite(scrollY) ? Math.max(0, Math.round(scrollY)) : Math.max(0, Math.round(targetY)),
    documentHeight: Number.isFinite(documentHeight) ? Math.max(1, Math.round(documentHeight)) : 0
  };
}

async function primeLazyContentForFullPageCapture(webContents: WebContents): Promise<void> {
  await webContents.executeJavaScript(String.raw`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const findScrollRoot = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
      if (scrolling && scrollingOverflow > 8) {
        return scrolling;
      }
      let best = scrolling;
      let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
      for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
        const style = window.getComputedStyle(element);
        const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
        if (!canScroll) continue;
        const rect = element.getBoundingClientRect();
        const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        if (!visible) continue;
        const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
        const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
      return best || scrolling;
    };
    const scrollRoot = findScrollRoot();
    const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
    const startX = isDocumentRoot ? (window.scrollX || 0) : (scrollRoot.scrollLeft || 0);
    const startY = isDocumentRoot ? (window.scrollY || 0) : (scrollRoot.scrollTop || 0);
    const scrollToRoot = (x, y) => {
      if (isDocumentRoot) {
        window.scrollTo(x, y);
      } else {
        scrollRoot.scrollLeft = x;
        scrollRoot.scrollTop = y;
      }
    };
    let previousHeight = 0;
    for (let pass = 0; pass < 3; pass += 1) {
      const height = Math.max(scrollRoot?.scrollHeight || 0, document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0, viewportHeight);
      const step = Math.max(240, Math.floor(viewportHeight * 0.85));
      for (let y = 0; y < height; y += step) {
        scrollToRoot(startX, y);
        await sleep(45);
      }
      scrollToRoot(startX, Math.max(0, height - viewportHeight));
      await sleep(80);
      const nextHeight = Math.max(scrollRoot?.scrollHeight || 0, document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0, viewportHeight);
      if (pass > 0 && Math.abs(nextHeight - previousHeight) < 4) {
        break;
      }
      previousHeight = nextHeight;
    }
    scrollToRoot(startX, startY);
    await sleep(80);
    return true;
  })();`, true).catch(() => undefined);
}

async function setScrollableContentExpandedForFullPageCapture(webContents: WebContents, expanded: true): Promise<boolean>;
async function setScrollableContentExpandedForFullPageCapture(webContents: WebContents, expanded: false, previousExpanded: boolean): Promise<boolean>;
async function setScrollableContentExpandedForFullPageCapture(webContents: WebContents, expanded: boolean, previousExpanded = false): Promise<boolean> {
  return webContents.executeJavaScript(String.raw`(() => {
    const marker = "data-mgt-capture-scroll-expanded";
    const propName = "__mgtCapturePreviousStyle";
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const findScrollRoot = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
      if (scrolling && scrollingOverflow > 8) {
        return scrolling;
      }
      let best = scrolling;
      let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
      for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
        const style = window.getComputedStyle(element);
        const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
        if (!canScroll) continue;
        const rect = element.getBoundingClientRect();
        const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        if (!visible) continue;
        const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
        const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
      return best || scrolling;
    };
    const remember = (element) => {
      if (!element || element.hasAttribute(marker)) return;
      element[propName] = {
        height: element.style.height || "",
        minHeight: element.style.minHeight || "",
        maxHeight: element.style.maxHeight || "",
        overflow: element.style.overflow || "",
        overflowY: element.style.overflowY || "",
        position: element.style.position || ""
      };
      element.setAttribute(marker, "1");
    };
    const restore = () => {
      for (const element of Array.from(document.querySelectorAll("[" + marker + "]"))) {
        const previous = element[propName] || {};
        element.style.height = previous.height || "";
        element.style.minHeight = previous.minHeight || "";
        element.style.maxHeight = previous.maxHeight || "";
        element.style.overflow = previous.overflow || "";
        element.style.overflowY = previous.overflowY || "";
        element.style.position = previous.position || "";
        element.removeAttribute(marker);
        try { delete element[propName]; } catch {}
      }
      return false;
    };
    if (!${JSON.stringify(expanded)}) {
      return ${JSON.stringify(previousExpanded)} ? restore() : false;
    }
    const scrollRoot = findScrollRoot();
    if (!scrollRoot) {
      return false;
    }
    const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
    const rootHeight = Math.max(scrollRoot.scrollHeight || 0, document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0, viewportHeight);
    const rootWidth = Math.max(scrollRoot.scrollWidth || 0, document.documentElement.scrollWidth || 0, document.body?.scrollWidth || 0, viewportWidth);
    remember(document.documentElement);
    remember(document.body);
    document.documentElement.style.minHeight = rootHeight + "px";
    document.documentElement.style.height = "auto";
    document.documentElement.style.overflowY = "visible";
    if (document.body) {
      document.body.style.minHeight = rootHeight + "px";
      document.body.style.height = "auto";
      document.body.style.overflowY = "visible";
    }
    if (!isDocumentRoot) {
      let node = scrollRoot;
      while (node && node.nodeType === 1 && node !== document.documentElement) {
        remember(node);
        node.style.height = node === scrollRoot ? rootHeight + "px" : "auto";
        node.style.minHeight = node === scrollRoot ? rootHeight + "px" : "";
        node.style.maxHeight = "none";
        node.style.overflow = "visible";
        node.style.overflowY = "visible";
        if (node === scrollRoot && window.getComputedStyle(node).position === "fixed") {
          node.style.position = "relative";
        }
        node = node.parentElement;
      }
    }
    window.scrollTo(0, 0);
    if (!isDocumentRoot) {
      scrollRoot.scrollTop = 0;
      scrollRoot.scrollLeft = 0;
    }
    return rootHeight > viewportHeight + 8 || rootWidth > viewportWidth + 8;
  })();`, true).catch(() => previousExpanded);
}

async function captureFullPageTiles(webContents: WebContents, metrics: WebMetrics): Promise<WebCaptureTile[]> {
  let height = Math.max(1, Math.ceil(metrics.documentHeight || metrics.viewportHeight || 1));
  const viewportHeight = Math.max(1, Math.ceil(metrics.viewportHeight || 1));
  const overlapPx = Math.max(0, Math.min(WEB_CAPTURE_TILE_MAX_OVERLAP_PX, Math.floor(viewportHeight * WEB_CAPTURE_TILE_OVERLAP_RATIO)));
  const edgeCropTopPx = Math.max(0, Math.min(WEB_CAPTURE_TILE_MAX_EDGE_CROP_PX, Math.floor(overlapPx * 0.45)));
  const edgeCropBottomPx = Math.max(0, Math.min(WEB_CAPTURE_TILE_MAX_EDGE_CROP_PX, Math.floor(overlapPx * 0.35)));
  const stepPx = Math.max(1, viewportHeight - overlapPx);
  const tiles: Array<Omit<WebCaptureTile, "index" | "total">> = [];
  const seenY = new Set<number>();
  let targetY = 0;
  try {
    while (targetY < height) {
      await scrollCaptureRootTo(webContents, targetY);
      const stable = await waitForStableScrollCapture(webContents, targetY);
      height = Math.max(height, stable.documentHeight || 0);
      const actualY = stable.scrollY;
      if (seenY.has(actualY)) {
        break;
      }
      seenY.add(actualY);
      const image = await webContents.capturePage();
      if (image.isEmpty()) {
        throw new Error("전체 스크롤 타일 캡처 이미지가 비어 있습니다.");
      }
      const size = image.getSize();
      const bitmap = image.toBitmap();
      const remainingHeight = Math.max(1, height - actualY);
      const sourceHeight = Math.max(1, Math.min(size.height, viewportHeight, remainingHeight));
      const isFirstTile = actualY <= 0;
      const isLastTile = actualY + sourceHeight >= height;
      const cropTop = isFirstTile ? 0 : Math.min(edgeCropTopPx, Math.max(0, sourceHeight - 1));
      const cropBottom = isLastTile ? 0 : Math.min(edgeCropBottomPx, Math.max(0, sourceHeight - cropTop - 1));
      const tileHeight = Math.max(1, sourceHeight - cropTop - cropBottom);
      const tileWidth = Math.max(1, size.width);
      tiles.push({
        buffer: encodeBitmapRectToPng(bitmap, tileWidth, size.height, 0, cropTop, tileWidth, tileHeight),
        bitmap,
        sourceWidth: tileWidth,
        sourceHeight: size.height,
        cropTop,
        cropBottom,
        scrollY: actualY + cropTop,
        width: tileWidth,
        height: tileHeight
      });
      logInfo("Web full-page capture tile captured", {
        targetY,
        actualY,
        stableScrollY: stable.scrollY,
        documentHeight: stable.documentHeight,
        viewportHeight,
        sourceHeight,
        cropTop,
        cropBottom,
        tileHeight
      });
      if (actualY + sourceHeight >= height) {
        break;
      }
      targetY = actualY + stepPx;
    }
  } finally {
    await scrollCaptureRootTo(webContents, metrics.scrollY || 0).catch(() => undefined);
  }
  const total = tiles.length;
  return tiles.map((tile, index) => ({ ...tile, index, total }));
}

function buildWebOcrTileRanges(height: number): Array<{ y: number; height: number }> {
  const safeHeight = Math.max(1, Math.ceil(height));
  const tileHeight = Math.max(512, WEB_OCR_TILE_TARGET_HEIGHT_PX);
  const overlap = Math.max(0, Math.min(WEB_OCR_TILE_OVERLAP_PX, tileHeight - 1));
  const step = Math.max(1, tileHeight - overlap);
  const ranges: Array<{ y: number; height: number }> = [];
  let y = 0;
  while (y < safeHeight) {
    const nextHeight = Math.min(tileHeight, safeHeight - y);
    ranges.push({ y, height: nextHeight });
    if (y + nextHeight >= safeHeight) {
      break;
    }
    y += step;
  }
  return ranges;
}

function stitchWebCaptureTilesToPng(tiles: WebCaptureTile[], width: number, height: number, offsetY = 0): Buffer {
  const output = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    output[row * (width * 4 + 1)] = 0;
  }
  for (const tile of tiles) {
    const copyWidth = Math.min(width, tile.width);
    const sourcePageStartY = Math.max(tile.scrollY, offsetY);
    const sourcePageEndY = Math.min(tile.scrollY + tile.height, offsetY + height);
    const copyHeight = Math.max(0, sourcePageEndY - sourcePageStartY);
    if (copyWidth <= 0 || copyHeight <= 0) {
      continue;
    }
    const tileRowOffset = sourcePageStartY - tile.scrollY;
    const targetRowOffset = sourcePageStartY - offsetY;
    for (let row = 0; row < copyHeight; row += 1) {
      const sourceRow = tile.cropTop + tileRowOffset + row;
      const sourceStart = sourceRow * tile.sourceWidth * 4;
      const targetStart = (targetRowOffset + row) * (width * 4 + 1) + 1;
      copyBitmapBgraToPngRgba(tile.bitmap, output, sourceStart, targetStart, copyWidth);
    }
  }
  return encodeFilteredRgbaPng(width, height, output);
}

function encodeBitmapRectToPng(bitmap: Buffer, sourceWidth: number, sourceHeight: number, x: number, y: number, width: number, height: number): Buffer {
  const cropX = Math.max(0, Math.min(sourceWidth - 1, Math.round(x)));
  const cropY = Math.max(0, Math.min(sourceHeight - 1, Math.round(y)));
  const cropWidth = Math.max(1, Math.min(sourceWidth - cropX, Math.round(width)));
  const cropHeight = Math.max(1, Math.min(sourceHeight - cropY, Math.round(height)));
  const filtered = Buffer.alloc((cropWidth * 4 + 1) * cropHeight);
  for (let row = 0; row < cropHeight; row += 1) {
    const rowStart = row * (cropWidth * 4 + 1);
    filtered[rowStart] = 0;
    const sourceStart = ((cropY + row) * sourceWidth + cropX) * 4;
    copyBitmapBgraToPngRgba(bitmap, filtered, sourceStart, rowStart + 1, cropWidth);
  }
  return encodeFilteredRgbaPng(cropWidth, cropHeight, filtered);
}

function copyBitmapBgraToPngRgba(source: Buffer, target: Buffer, sourceStart: number, targetStart: number, width: number): void {
  for (let column = 0; column < width; column += 1) {
    const sourceOffset = sourceStart + column * 4;
    const targetOffset = targetStart + column * 4;
    target[targetOffset] = source[sourceOffset + 2] ?? 255;
    target[targetOffset + 1] = source[sourceOffset + 1] ?? 255;
    target[targetOffset + 2] = source[sourceOffset] ?? 255;
    target[targetOffset + 3] = source[sourceOffset + 3] ?? 255;
  }
}

function encodeFilteredRgbaPng(width: number, height: number, filteredRgba: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    signature,
    createPngChunk("IHDR", ihdr),
    createPngChunk("IDAT", deflateSync(filteredRgba, { level: 6 })),
    createPngChunk("IEND", Buffer.alloc(0))
  ]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  const checksum = crc32(Buffer.concat([typeBuffer, data]));
  chunk.writeUInt32BE(checksum >>> 0, 8 + data.length);
  return chunk;
}

let pngCrcTable: number[] | null = null;

function crc32(buffer: Buffer): number {
  const table = pngCrcTable ?? (pngCrcTable = buildCrc32Table());
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildCrc32Table(): number[] {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

async function captureFullPageByScrollStitch(
  webContents: WebContents,
  metrics: WebMetrics
): Promise<Buffer> {
  const height = Math.max(1, Math.ceil(metrics.documentHeight || metrics.viewportHeight || 1));
  if (height > MAX_SINGLE_WEB_CAPTURE_HEIGHT) {
    throw new Error(
      `전체 스크롤 높이가 ${height}px라 단일 이미지 OCR 한계(${MAX_SINGLE_WEB_CAPTURE_HEIGHT}px)를 넘습니다. ` +
      "이 페이지는 타일 OCR/번역 병합 방식이 필요합니다. 현재 화면 번역을 사용하거나, 추후 타일 병합 기능으로 처리해야 합니다."
    );
  }
  const tiles = await captureFullPageTiles(webContents, metrics);
  const width = Math.max(1, ...tiles.map((tile) => tile.width), metrics.viewportWidth || 1);
  const maxArea = 120_000_000;
  if (width * height > maxArea) {
    throw new Error(`전체 스크롤 캡처가 너무 큽니다. (${width} x ${height}) 현재는 약 ${Math.round(maxArea / 1_000_000)}MP 이하만 지원합니다.`);
  }
  if (tiles.length === 0) {
    throw new Error("전체 스크롤 캡처 타일이 비어 있습니다.");
  }
  return stitchWebCaptureTilesToPng(tiles, width, height);
}

async function scrollCaptureRootTo(webContents: WebContents, targetY: number): Promise<number> {
  const actualY = await webContents.executeJavaScript(String.raw`(() => {
    const targetY = Math.max(0, Math.round(${JSON.stringify(targetY)}));
    const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const findScrollRoot = () => {
      const scrolling = document.scrollingElement || document.documentElement;
      const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
      if (scrolling && scrollingOverflow > 8) {
        return scrolling;
      }
      let best = scrolling;
      let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
      for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
        const style = window.getComputedStyle(element);
        const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
        if (!canScroll) continue;
        const rect = element.getBoundingClientRect();
        const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        if (!visible) continue;
        const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
        const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
        if (score > bestScore) {
          best = element;
          bestScore = score;
        }
      }
      return best || scrolling;
    };
    const scrollRoot = findScrollRoot();
    const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
    if (isDocumentRoot) {
      window.scrollTo(window.scrollX || 0, targetY);
      return Math.max(0, Math.round(window.scrollY || document.documentElement.scrollTop || 0));
    }
    scrollRoot.scrollTop = targetY;
    return Math.max(0, Math.round(scrollRoot.scrollTop || 0));
  })()`, true).catch(() => targetY);
  const parsed = Number(actualY);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : Math.max(0, Math.round(targetY));
}

async function setTranslationOverlayCaptureHidden(webContents: WebContents, hidden: true): Promise<boolean>;
async function setTranslationOverlayCaptureHidden(webContents: WebContents, hidden: false, previousHidden: boolean): Promise<boolean>;
async function setTranslationOverlayCaptureHidden(webContents: WebContents, hidden: boolean, previousHidden = false): Promise<boolean> {
  return webContents.executeJavaScript(`(() => {
    const root = document.getElementById("__mgt_translation_overlay_root");
    if (!root) {
      return false;
    }
    if (${JSON.stringify(hidden)}) {
      const wasHidden = root.style.display === "none";
      root.setAttribute("data-mgt-capture-previous-display", root.style.display || "");
      root.style.display = "none";
      return wasHidden;
    }
    if (${JSON.stringify(previousHidden)}) {
      root.style.display = "none";
      return true;
    }
    const previousDisplay = root.getAttribute("data-mgt-capture-previous-display");
    root.style.display = previousDisplay || "";
    root.removeAttribute("data-mgt-capture-previous-display");
    return false;
  })();`, true).catch(() => previousHidden);
}

async function setFixedElementsCaptureHidden(webContents: WebContents, hidden: true): Promise<boolean>;
async function setFixedElementsCaptureHidden(webContents: WebContents, hidden: false, previousHidden: boolean): Promise<boolean>;
async function setFixedElementsCaptureHidden(webContents: WebContents, hidden: boolean, previousHidden = false): Promise<boolean> {
  return webContents.executeJavaScript(String.raw`(() => {
    const marker = "data-mgt-capture-fixed-hidden";
    if (${JSON.stringify(hidden)}) {
      let hiddenAny = false;
      const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
      const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
      for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
        const style = window.getComputedStyle(element);
        if (style.position !== "fixed" && style.position !== "sticky") {
          continue;
        }
        const rect = element.getBoundingClientRect();
        const visible = rect.width > 12 && rect.height > 12 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
        const edgePinned = rect.top <= 4 || rect.bottom >= viewportHeight - 4 || rect.left <= 4 || rect.right >= viewportWidth - 4;
        if (!visible || !edgePinned) {
          continue;
        }
        element.setAttribute(marker, "1");
        element.setAttribute("data-mgt-capture-previous-visibility", element.style.visibility || "");
        element.style.visibility = "hidden";
        hiddenAny = true;
      }
      return hiddenAny;
    }
    if (!${JSON.stringify(previousHidden)}) {
      return false;
    }
    for (const element of Array.from(document.querySelectorAll("[" + marker + "]"))) {
      const previous = element.getAttribute("data-mgt-capture-previous-visibility");
      element.style.visibility = previous || "";
      element.removeAttribute(marker);
      element.removeAttribute("data-mgt-capture-previous-visibility");
    }
    return false;
  })();`, true).catch(() => previousHidden);
}

function buildWebOverlayPayload(page: MangaPage, renderBlocks?: WebOverlayRenderBlock[]): {
  pageId: string;
  captureMode?: WebCaptureMode;
  scrollX: number;
  scrollY: number;
  viewportWidth: number;
  viewportHeight: number;
  coordinateWidth: number;
  coordinateHeight: number;
  captureRectCss?: WebPageSourceMeta["captureRectCss"];
  contentRectCss?: WebPageSourceMeta["contentRectCss"];
  interactionEnabled?: boolean;
  blocks: WebOverlayRenderBlock[];
} {
  const viewportWidth = Math.max(1, page.webMeta?.viewport.width || page.width || 1);
  const viewportHeight = Math.max(1, page.webMeta?.viewport.height || page.height || 1);
  const coordinateWidth = page.webMeta?.captureMode === "full-page" ? Math.max(1, page.width || viewportWidth) : viewportWidth;
  const coordinateHeight = page.webMeta?.captureMode === "full-page" ? Math.max(1, page.height || viewportHeight) : viewportHeight;
  const scrollX = page.webMeta?.scrollX ?? 0;
  const scrollY = page.webMeta?.scrollY ?? 0;
  return {
    pageId: page.id,
    captureMode: page.webMeta?.captureMode,
    scrollX,
    scrollY,
    viewportWidth,
    viewportHeight,
    coordinateWidth,
    coordinateHeight,
    captureRectCss: page.webMeta?.captureRectCss,
    contentRectCss: page.webMeta?.contentRectCss,
    blocks: renderBlocks ?? page.blocks
      .filter((block) => block.renderDirection !== "hidden" && block.translatedText.trim())
      .map((block) => blockToWebOverlayBlock(block, scrollX, scrollY, coordinateWidth, coordinateHeight))
  };
}

function blockToWebOverlayBlock(
  block: TranslationBlock,
  scrollX: number,
  scrollY: number,
  viewportWidth: number,
  viewportHeight: number
): WebOverlayRenderBlock {
  const bbox = block.renderBbox ?? block.bbox;
  const x = scrollX + (bbox.x / 1000) * viewportWidth;
  const y = scrollY + (bbox.y / 1000) * viewportHeight;
  const w = Math.max(8, (bbox.w / 1000) * viewportWidth);
  const h = Math.max(8, (bbox.h / 1000) * viewportHeight);
  return {
    id: block.id,
    x,
    y,
    w,
    h,
    text: block.translatedText,
    textColor: block.textColor || "#111111",
    backgroundColor: block.backgroundColor || "#ffffff",
    opacity: Number.isFinite(block.opacity) ? block.opacity : 0.86,
    fontSizePx: Math.max(8, block.fontSizePx || 16),
    lineHeight: block.lineHeight || 1.2,
    textAlign: block.textAlign || "center",
    fontFamily: resolveWebOverlayFontFamily(block.fontFamily),
    outlineColor: block.outlineColor || "#ffffff",
    outlineWidthPx: resolveWebOverlayOutlineWidthPx(block),
    bold: Boolean(block.bold),
    italic: Boolean(block.italic),
    vertical: block.renderDirection === "vertical",
    autoFitText: block.autoFitText,
    smartWrap: block.smartKoLineBreaks !== false && block.renderDirection === "horizontal",
    preparedLayout: false,
  };
}

function resolveWebOverlayOutlineWidthPx(block: TranslationBlock): number {
  const scale = Math.max(0, block.outlineWidthScale ?? 1);
  const configured = Number(block.outlineWidthPx);
  if (Number.isFinite(configured)) {
    return Math.round(Math.min(8, Math.max(0, configured)) * scale * 10) / 10;
  }
  const fontSizePx = Math.max(8, block.fontSizePx || 16);
  return Math.round(Math.min(4, Math.max(0.35, fontSizePx * 0.055)) * scale * 10) / 10;
}

function resolveWebOverlayFontFamily(fontFamily: string | undefined): string {
  const id = String(fontFamily ?? "").trim();
  const defaultStack = '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif';
  const stacks: Record<string, string> = {
    default: defaultStack,
    mongtori: '"MGT Mongtori", "Malgun Gothic", sans-serif',
    "chosun-gungseo": '"MGT Chosun Gungseo", "Malgun Gothic", serif',
    "griun-pol-sensibility": '"MGT Griun Pol Sensibility", "Malgun Gothic", sans-serif',
    "nanum-gothic": '"MGT Nanum Gothic", "Malgun Gothic", sans-serif',
    "nanum-myeongjo": '"MGT Nanum Myeongjo", "Malgun Gothic", serif',
    "nanum-barun-gothic": '"MGT Nanum Barun Gothic", "Malgun Gothic", sans-serif',
    "seoul-namsan": '"MGT Seoul Namsan", "Malgun Gothic", sans-serif',
    "seoul-namsan-vertical": '"MGT Seoul Namsan Vertical", "Malgun Gothic", sans-serif',
    "seoul-hangang": '"MGT Seoul Hangang", "Malgun Gothic", serif'
  };
  return stacks[id] ?? defaultStack;
}

function isUsableBbox(value: unknown): value is { x: number; y: number; w: number; h: number } {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return Boolean(
    record &&
      Number.isFinite(record.x) &&
      Number.isFinite(record.y) &&
      Number.isFinite(record.w) &&
      Number.isFinite(record.h) &&
      Number(record.w) > 0 &&
      Number(record.h) > 0
  );
}

const WEB_READ_CONTENT_RECT_SCRIPT = String.raw`(() => {
  const viewportWidth = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  const viewportHeight = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  const findScrollRoot = () => {
    const scrolling = document.scrollingElement || document.documentElement;
    const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
    if (scrolling && scrollingOverflow > 8) return scrolling;
    let best = scrolling;
    let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
    for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
      const style = window.getComputedStyle(element);
      const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
      if (!canScroll) continue;
      const rect = element.getBoundingClientRect();
      const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
      if (!visible) continue;
      const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
      const score = overflow * Math.max(1, Math.min(element.scrollWidth || rect.width, viewportWidth * 2));
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best || scrolling || document.documentElement;
  };
  const scrollRoot = findScrollRoot();
  const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
  const scrollX = isDocumentRoot ? (window.scrollX || document.documentElement.scrollLeft || 0) : (scrollRoot.scrollLeft || 0);
  const scrollY = isDocumentRoot ? (window.scrollY || document.documentElement.scrollTop || 0) : (scrollRoot.scrollTop || 0);
  const candidates = [];
  for (const image of Array.from(document.images || [])) {
    const rect = image.getBoundingClientRect();
    const naturalWidth = Number(image.naturalWidth || 0);
    const naturalHeight = Number(image.naturalHeight || 0);
    if (naturalWidth < 220 || naturalHeight < 120) continue;
    if (rect.width < Math.min(220, viewportWidth * 0.18) || rect.height < 80) continue;
    if (rect.bottom < -viewportHeight * 3 || rect.top > viewportHeight * 4 + Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0)) continue;
    candidates.push({
      x: rect.left + scrollX,
      y: rect.top + scrollY,
      width: rect.width,
      height: rect.height,
      centerX: rect.left + scrollX + rect.width / 2,
      area: rect.width * rect.height
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.area - a.area);
  const anchor = candidates[0];
  const group = candidates.filter((candidate) =>
    Math.abs(candidate.centerX - anchor.centerX) <= Math.max(anchor.width, candidate.width) * 0.45 &&
    candidate.width >= anchor.width * 0.45
  );
  const selected = group.length ? group : [anchor];
  const left = Math.min(...selected.map((candidate) => candidate.x));
  const top = Math.min(...selected.map((candidate) => candidate.y));
  const right = Math.max(...selected.map((candidate) => candidate.x + candidate.width));
  const bottom = Math.max(...selected.map((candidate) => candidate.y + candidate.height));
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.max(1, Math.round(right - left)),
    height: Math.max(1, Math.round(bottom - top))
  };
})()`;

const WEB_TRANSLATION_OVERLAY_SCRIPT = String.raw`(function renderMgtTranslationOverlay(payload) {
  const rootId = "__mgt_translation_overlay_root";
  const clamp01 = (value, fallback) => {
    const next = Number(value);
    return Number.isFinite(next) ? Math.max(0, Math.min(1, next)) : fallback;
  };
  const toRgba = (color, opacity) => {
    const alpha = clamp01(opacity, 0.86);
    const hex = String(color || "#ffffff").trim();
    const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
    if (!match) return hex;
    const raw = match[1].length === 3
      ? match[1].split("").map((part) => part + part).join("")
      : match[1];
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  };
  const buildFont = (block, fontSize) => {
    const weight = block.bold ? "800" : "400";
    const style = block.italic ? "italic " : "";
    return style + weight + " " + Math.max(8, Math.round(fontSize)) + "px " + (block.fontFamily || "sans-serif");
  };
  const AUTOFIT_ROOM_RATIO = 0.9;
  const wrapTextToWidth = (context, text, maxWidth) => {
    const lines = [];
    const paragraphs = String(text || "").replace(/\r/g, "").split("\n");
    for (const paragraph of paragraphs) {
      const normalized = paragraph.replace(/\s+/g, " ").trim();
      if (!normalized) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const char of Array.from(normalized)) {
        const candidate = current + char;
        if (!current || context.measureText(candidate).width <= maxWidth) {
          current = candidate;
          continue;
        }
        lines.push(current.trimEnd());
        current = /\s/u.test(char) ? "" : char;
      }
      if (current) lines.push(current.trimEnd());
    }
    return lines.length ? lines : [String(text || "")];
  };
  const doesTextFit = (block, fontSize, innerWidth, innerHeight) => {
    const text = String(block.text || "");
    const lineHeightPx = Math.max(1, fontSize * (Number(block.lineHeight) || 1.2));
    if (block.vertical) {
      const compact = text.replace(/\r/g, "").replace(/\s+/g, "");
      if (!compact) return true;
      const charsPerColumn = Math.max(1, Math.floor(innerHeight / Math.max(fontSize, lineHeightPx)));
      const columnCount = Math.max(1, Math.ceil(Array.from(compact).length / charsPerColumn));
      return columnCount <= 2 && columnCount * fontSize * 1.15 <= innerWidth;
    }
    const canvas = window.__mgtOverlayMeasureCanvas || (window.__mgtOverlayMeasureCanvas = document.createElement("canvas"));
    const context = canvas.getContext("2d");
    if (!context) return true;
    context.font = buildFont(block, fontSize);
    const lines = wrapTextToWidth(context, text, innerWidth);
    const totalHeight = lines.length * lineHeightPx;
    const maxLineWidth = lines.reduce((widest, line) => Math.max(widest, context.measureText(line).width), 0);
    return totalHeight <= innerHeight && maxLineWidth <= innerWidth;
  };
  const resolveFontSize = (block, innerWidth, innerHeight) => {
    const preferred = Math.max(8, Math.round(Number(block.fontSizePx) || 16));
    if (!block.autoFitText || !String(block.text || "").trim()) {
      return preferred;
    }
    const min = 12;
    const heightBound = Math.floor(innerHeight / Math.max(1, Number(block.lineHeight) || 1.2));
    const widthBound = block.vertical ? Math.floor(innerWidth / 1.15) : 256;
    const highBound = Math.max(min, Math.min(256, Math.max(preferred, heightBound, widthBound)));
    let low = min;
    let high = highBound;
    let best = min;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (doesTextFit(block, mid, innerWidth, innerHeight)) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const fitted = Math.min(best, highBound);
    return fitted <= min ? min : Math.max(min, Math.floor(fitted * AUTOFIT_ROOM_RATIO));
  };
  const resolveOutlineWidth = (block, fontSize) => {
    const scale = Math.max(0, Number.isFinite(Number(block.outlineWidthScale)) ? Number(block.outlineWidthScale) : 1);
    const configured = Number(block.outlineWidthPx);
    if (Number.isFinite(configured)) {
      return Math.round(Math.min(8, Math.max(0, configured)) * scale * 10) / 10;
    }
    return Math.round(Math.min(4, Math.max(0.35, fontSize * 0.055)) * scale * 10) / 10;
  };
  const findOverlayScrollRoot = () => {
    const viewportWidth = Math.max(1, Math.round(window.innerWidth || document.documentElement.clientWidth || 0));
    const viewportHeight = Math.max(1, Math.round(window.innerHeight || document.documentElement.clientHeight || 0));
    const scrolling = document.scrollingElement || document.documentElement;
    const scrollingOverflow = Math.max(0, (scrolling?.scrollHeight || 0) - (scrolling?.clientHeight || 0));
    if (scrolling && scrollingOverflow > 8) {
      return scrolling;
    }
    let best = scrolling;
    let bestScore = scrollingOverflow * Math.max(1, scrolling?.clientWidth || viewportWidth);
    for (const element of Array.from(document.body?.querySelectorAll("*") || [])) {
      const style = window.getComputedStyle(element);
      const canScroll = /(auto|scroll|overlay)/.test(style.overflowY || "") || element.scrollHeight > element.clientHeight + 8;
      if (!canScroll) continue;
      const rect = element.getBoundingClientRect();
      const visible = rect.width > viewportWidth * 0.25 && rect.height > viewportHeight * 0.25 && rect.bottom > 0 && rect.right > 0 && rect.top < viewportHeight && rect.left < viewportWidth;
      if (!visible) continue;
      const overflow = Math.max(0, element.scrollHeight - element.clientHeight);
      const score = overflow * Math.max(1, element.clientWidth);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best || scrolling || document.documentElement;
  };
  const readOverlayScroll = () => {
    const scrollRoot = findOverlayScrollRoot();
    const isDocumentRoot = scrollRoot === document.documentElement || scrollRoot === document.body || scrollRoot === document.scrollingElement;
    return {
      x: isDocumentRoot ? (window.scrollX || document.documentElement.scrollLeft || 0) : (scrollRoot.scrollLeft || 0),
      y: isDocumentRoot ? (window.scrollY || document.documentElement.scrollTop || 0) : (scrollRoot.scrollTop || 0)
    };
  };
  const resolveCoordinateTransform = (overlayPayload) => {
    void overlayPayload;
    return {
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      fontScale: 1,
      source: "original-capture"
    };
  };
  const updateOverlayPosition = () => {
    const scroll = readOverlayScroll();
    const root = document.getElementById(rootId);
    if (root) {
      root.style.transform = "translate(" + (-Math.round(scroll.x)) + "px, " + (-Math.round(scroll.y)) + "px)";
    }
  };
  let root = document.getElementById(rootId);
  if (!root) {
    root = document.createElement("div");
    root.id = rootId;
    root.style.position = "fixed";
    root.style.left = "0";
    root.style.top = "0";
    root.style.width = "0";
    root.style.height = "0";
    root.style.overflow = "visible";
    root.style.zIndex = "2147483646";
    root.style.pointerEvents = "none";
    document.documentElement.appendChild(root);
  }
  if (!window.__mgtOverlayScrollListenerInstalled) {
    window.__mgtOverlayScrollListenerInstalled = true;
    document.addEventListener("scroll", updateOverlayPosition, true);
    window.addEventListener("resize", () => {
      if (window.__mgtLastTranslationOverlayPayload) {
        window.__mgtRenderTranslationOverlay(window.__mgtLastTranslationOverlayPayload);
      } else {
        updateOverlayPosition();
      }
    }, true);
  }
  window.__mgtLastTranslationOverlayPayload = payload;
  window.__mgtRenderTranslationOverlay = renderMgtTranslationOverlay;
  window.__mgtSetTranslationOverlayInteraction = function setMgtTranslationOverlayInteraction(enabled) {
    const active = Boolean(enabled);
    root.setAttribute("data-mgt-selectable", active ? "1" : "0");
    root.style.pointerEvents = active ? "auto" : "none";
    root.querySelectorAll("[data-mgt-block]").forEach((node) => {
      node.style.pointerEvents = active ? "auto" : "none";
      node.style.cursor = active ? "pointer" : "default";
    });
  };
  root.style.position = "fixed";
  root.style.left = "0";
  root.style.top = "0";
  root.style.width = "0";
  root.style.height = "0";
  root.style.overflow = "visible";
  updateOverlayPosition();
  root.querySelectorAll("[data-mgt-page]").forEach((node) => {
    node.remove();
  });
  const coordinateTransform = resolveCoordinateTransform(payload);
  let renderedCount = 0;
  let firstLayoutBlock = null;
  for (const block of payload.blocks || []) {
    const blockPageId = block.pageId || payload.pageId;
    const layoutBlock = {
      ...block,
      x: coordinateTransform.x + Number(block.x || 0) * coordinateTransform.scaleX,
      y: coordinateTransform.y + Number(block.y || 0) * coordinateTransform.scaleY,
      w: Math.max(1, Number(block.w || 1) * coordinateTransform.scaleX),
      h: Math.max(1, Number(block.h || 1) * coordinateTransform.scaleY),
      fontSizePx: Math.max(8, Number(block.fontSizePx || 16) * coordinateTransform.fontScale),
      outlineWidthPx: Number.isFinite(Number(block.outlineWidthPx))
        ? Math.max(0, Number(block.outlineWidthPx) * coordinateTransform.fontScale)
        : undefined
    };
    const box = document.createElement("div");
    box.setAttribute("data-mgt-page", blockPageId);
    box.setAttribute("data-mgt-block", block.id);
    box.style.position = "absolute";
    box.style.boxSizing = "border-box";
    box.style.left = Math.round(layoutBlock.x) + "px";
    box.style.top = Math.round(layoutBlock.y) + "px";
    box.style.width = Math.max(1, Math.round(layoutBlock.w)) + "px";
    box.style.height = Math.max(1, Math.round(layoutBlock.h)) + "px";
    box.style.padding = "0";
    box.style.display = "flex";
    box.style.alignItems = "center";
    box.style.justifyContent = block.textAlign === "left" ? "flex-start" : block.textAlign === "right" ? "flex-end" : "center";
    box.style.textAlign = block.textAlign || "center";
    box.style.whiteSpace = "pre-wrap";
    box.style.overflow = "visible";
    const smartWrap = Boolean(layoutBlock.smartWrap || layoutBlock.preparedLayout);
    box.style.overflowWrap = smartWrap ? "normal" : "anywhere";
    box.style.wordBreak = smartWrap ? "normal" : "break-word";
    box.style.color = block.textColor || "#111";
    box.style.background = toRgba(block.backgroundColor || "#fff", block.opacity);
    const cornerRadius = Math.round(Math.max(
      ${MIN_BLOCK_CORNER_RADIUS_PX},
      Math.min(
        ${MAX_BLOCK_CORNER_RADIUS_PX},
        Math.min(Number(layoutBlock.w) || 0, Number(layoutBlock.h) || 0) * ${BLOCK_CORNER_RADIUS_SCALE} || ${DEFAULT_BLOCK_CORNER_RADIUS_PX}
      )
    ));
    box.style.borderRadius = cornerRadius + "px";
    box.style.fontFamily = block.fontFamily || "sans-serif";
    box.style.boxShadow = "none";
    box.style.textShadow = "none";
    const innerWidth = Math.max(1, Math.round(layoutBlock.w) - 2);
    const innerHeight = Math.max(1, Math.round(layoutBlock.h) - 2);
    const resolvedFontSize = layoutBlock.preparedLayout
      ? Math.max(1, Math.round(Number(layoutBlock.fontSizePx) || 16))
      : resolveFontSize(layoutBlock, innerWidth, innerHeight);
    box.style.fontSize = resolvedFontSize + "px";
    box.style.lineHeight = String(block.lineHeight || 1.2);
    box.style.fontWeight = block.bold ? "800" : "400";
    box.style.fontStyle = block.italic ? "italic" : "normal";
    box.style.writingMode = block.vertical ? "vertical-rl" : "horizontal-tb";
    box.style.pointerEvents = payload.interactionEnabled ? "auto" : "none";
    box.style.cursor = payload.interactionEnabled ? "pointer" : "default";
    box.addEventListener("click", (event) => {
      if (root.getAttribute("data-mgt-selectable") !== "1") return;
      event.preventDefault();
      event.stopPropagation();
      console.info("__MGT_BLOCK_SELECT__" + JSON.stringify({ pageId: blockPageId, blockId: block.id }));
    }, true);
    const textStack = document.createElement("span");
    textStack.style.position = "relative";
    textStack.style.display = "grid";
    textStack.style.placeItems = "center";
    textStack.style.width = block.vertical ? "max-content" : "100%";
    textStack.style.height = block.vertical ? "100%" : "auto";
    textStack.style.maxWidth = "100%";
    textStack.style.maxHeight = "100%";
    textStack.style.overflow = "visible";
    const makeTextLayer = () => {
      const layer = document.createElement("span");
      layer.style.gridArea = "1 / 1";
      layer.style.boxSizing = "border-box";
      layer.style.maxWidth = "100%";
      layer.style.maxHeight = "100%";
      layer.style.overflow = "visible";
      layer.style.whiteSpace = "pre-wrap";
      layer.style.overflowWrap = smartWrap ? "normal" : "anywhere";
      layer.style.wordBreak = smartWrap ? "normal" : "break-word";
      layer.style.pointerEvents = "none";
      layer.style.textShadow = "none";
      layer.style.boxShadow = "none";
      layer.textContent = block.text || "";
      return layer;
    };
    const outlineWidth = resolveOutlineWidth(layoutBlock, resolvedFontSize);
    if (outlineWidth > 0) {
      const outlineLayer = makeTextLayer();
      outlineLayer.setAttribute("aria-hidden", "true");
      outlineLayer.style.zIndex = "0";
      outlineLayer.style.color = "transparent";
      outlineLayer.style.webkitTextStroke = outlineWidth + "px " + (block.outlineColor || "#ffffff");
      outlineLayer.style.paintOrder = "stroke";
      textStack.appendChild(outlineLayer);
    }
    const fillLayer = makeTextLayer();
    fillLayer.style.zIndex = "1";
    fillLayer.style.color = block.textColor || "#111";
    fillLayer.style.webkitTextStroke = "0 transparent";
    textStack.appendChild(fillLayer);
    box.appendChild(textStack);
    root.appendChild(box);
    renderedCount += 1;
    if (!firstLayoutBlock) {
      firstLayoutBlock = {
        id: block.id,
        x: layoutBlock.x,
        y: layoutBlock.y,
        w: layoutBlock.w,
        h: layoutBlock.h
      };
    }
  }
  window.__mgtSetTranslationOverlayInteraction(Boolean(payload.interactionEnabled));
  return {
    ok: true,
    renderedCount,
    firstLayoutBlock,
    transform: {
      source: coordinateTransform.source,
      x: coordinateTransform.x,
      y: coordinateTransform.y,
      scaleX: coordinateTransform.scaleX,
      scaleY: coordinateTransform.scaleY,
      capturedRect: coordinateTransform.capturedRect,
      currentRect: coordinateTransform.currentRect
    }
  };
})`;

const WEB_REGION_SELECTION_SCRIPT = String.raw`new Promise((resolve) => {
  const old = document.getElementById("__mgt_region_selector");
  old?.remove();
  const layer = document.createElement("div");
  layer.id = "__mgt_region_selector";
  layer.style.position = "fixed";
  layer.style.inset = "0";
  layer.style.zIndex = "2147483647";
  layer.style.cursor = "crosshair";
  layer.style.background = "rgba(0,0,0,0.04)";
  const box = document.createElement("div");
  box.style.position = "fixed";
  box.style.border = "2px solid #2f7d6b";
  box.style.background = "rgba(47,125,107,0.16)";
  box.style.display = "none";
  layer.appendChild(box);
  document.documentElement.appendChild(layer);
  let start = null;
  const cleanup = () => {
    window.removeEventListener("keydown", onKeyDown, true);
    layer.remove();
  };
  const finish = (bbox) => {
    cleanup();
    resolve(bbox);
  };
  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
    }
  };
  window.addEventListener("keydown", onKeyDown, true);
  layer.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    box.style.display = "block";
    box.style.left = start.x + "px";
    box.style.top = start.y + "px";
    box.style.width = "0px";
    box.style.height = "0px";
  });
  layer.addEventListener("pointermove", (event) => {
    if (!start) return;
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const w = Math.abs(event.clientX - start.x);
    const h = Math.abs(event.clientY - start.y);
    box.style.left = x + "px";
    box.style.top = y + "px";
    box.style.width = w + "px";
    box.style.height = h + "px";
  });
  layer.addEventListener("pointerup", (event) => {
    if (!start) {
      finish(null);
      return;
    }
    const x = Math.min(start.x, event.clientX);
    const y = Math.min(start.y, event.clientY);
    const w = Math.abs(event.clientX - start.x);
    const h = Math.abs(event.clientY - start.y);
    if (w < 10 || h < 10) {
      finish(null);
      return;
    }
    finish({
      x: Math.round((x / Math.max(1, window.innerWidth)) * 1000),
      y: Math.round((y / Math.max(1, window.innerHeight)) * 1000),
      w: Math.round((w / Math.max(1, window.innerWidth)) * 1000),
      h: Math.round((h / Math.max(1, window.innerHeight)) * 1000)
    });
  });
})`;
