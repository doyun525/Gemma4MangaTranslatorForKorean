import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BBox,
  ChapterSnapshot,
  ImportPreviewSession,
  InpaintingMaskStroke,
  JobState,
  LibraryIndex,
  MangaPage,
  OpenWebBrowseRequest,
  TranslationBlock,
  WebBrowseState,
  WebCaptureMode,
  WorkShareExportRequest,
  WorkShareImportPreview
} from "../../shared/types";
import { FLAT_BACKGROUND_OPACITY } from "../../shared/blockBackground";
import {
  clampBbox,
  normalizeBlockType,
  normalizeRenderDirection,
  normalizeRotationDeg,
  offsetBlockBboxes,
  resolveBlockRenderBbox,
  resolveEditableBlockBbox
} from "../../shared/geometry";
import { isUsableRegionBbox } from "../../shared/region";
import { AppModals, type RenameTarget } from "./components/AppModals";
import { AppSidebar } from "./components/AppSidebar";
import { AppRightRail } from "./components/AppRightRail";
import { AppWorkspace } from "./components/AppWorkspace";
import { WebBrowseModal } from "./components/WebBrowseModal";
import type { ImportModalSubmit } from "./components/ImportModal";
import { type BlockCounts, type InpaintingTool } from "./components/InpaintingControlPanel";
import { InpaintingProvider, type InpaintingContextValue } from "./inpainting/InpaintingContext";
import { FontsProvider } from "./fonts/FontsContext";
import type { ShareImportModalSubmit } from "./components/ShareImportModal";
import type { TranslateSourceMode } from "./components/TranslateSourceModal";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { useChapterEditHistory, type ChapterEditSnapshot } from "./hooks/useChapterEditHistory";
import { useChapterPersistence } from "./hooks/useChapterPersistence";
import { useJobEvents } from "./hooks/useJobEvents";
import { usePageImageDataUrls } from "./hooks/usePageImageDataUrls";
import { useSettingsDialog } from "./hooks/useSettingsDialog";
import { useStageSize } from "./hooks/useStageSize";
import { useStatusLog } from "./hooks/useStatusLog";
import {
  formatErrorMessage,
  isEditableTarget,
  regionSelectionToBbox,
  reorderByTarget,
  reorderRecordsByIdOrder,
  type RegionSelectionState
} from "./lib/appHelpers";
import { markChapterPagesRunning, mergeLiveChapterPreservingDirtyPages, resolveSelectionAfterChapterSync } from "./lib/chapterSync";
import { resolveProgressSnapshot, summarizeWarnings, type ProgressSnapshot } from "./lib/jobProgress";
import { resolveOverlayBlockRenderModel, toWebOverlayRenderBlock } from "./lib/blockRenderModel";
import { resolveAdjacentPageId, resolveKeyboardPageNavigation, resolveWheelPageNavigation } from "./lib/pageNavigation";
import "./styles.css";

const EMPTY_JOB: JobState = {
  id: "idle",
  kind: "gemma-analysis",
  status: "idle",
  progressText: "대기 중"
};

const INPAINTING_GUIDE_HIDDEN_KEY = "mgt.inpaintingGuide.hidden";
const WEB_OVERLAY_PRELOAD_MISSING_MESSAGE =
  "웹 번역 오버레이 API가 로드되지 않았습니다. dev 실행 중 preload 변경 후에는 앱을 완전히 종료하고 npm run dev를 다시 실행하세요.";

type DragMode = "move" | "resize";

type DragState = {
  mode: DragMode;
  blockId: string;
  startX: number;
  startY: number;
  bboxKey: "bbox" | "renderBbox";
  startBbox: BBox;
};

type RetouchPreviewState = {
  mode: "brush" | "eraser" | "mask";
  points: Array<{ x: number; y: number }>;
  radiusPx: number;
  color: string;
};
type RetouchHistoryEntry = {
  pageId: string;
  beforePath?: string;
  afterPath?: string;
};

type WebOverlayRenderOptions = {
  showBlockChrome: boolean;
  showTextBlocks: boolean;
};

async function renderWebTranslationOverlay(
  sessionId: string,
  page: MangaPage,
  options: WebOverlayRenderOptions = { showBlockChrome: true, showTextBlocks: true }
): Promise<WebBrowseState> {
  const api = window.mangaApi as unknown as {
    renderWebOverlay?: (request: { sessionId: string; page: MangaPage; blocks?: import("../../shared/types").WebOverlayRenderBlock[] }) => Promise<WebBrowseState>;
    writeLog?: (level: "debug" | "info" | "warn" | "error", message: string, detail?: unknown) => Promise<unknown>;
  };
  if (typeof api.renderWebOverlay !== "function") {
    await api.writeLog?.("error", "Web overlay preload API unavailable", {
      availableApiKeys: Object.keys(window.mangaApi ?? {}).sort()
    });
    throw new Error(WEB_OVERLAY_PRELOAD_MISSING_MESSAGE);
  }
  const displayPage = toWebOverlayDisplayPage(page, options);
  return api.renderWebOverlay({
    sessionId,
    page: toWebOverlayIpcPage(displayPage),
    blocks: buildWebOverlayRenderBlocks(displayPage, options)
  });
}

async function renderWebTranslationOverlayForPages(
  sessionId: string,
  pages: MangaPage[],
  options: WebOverlayRenderOptions = { showBlockChrome: true, showTextBlocks: true }
): Promise<WebBrowseState> {
  const visiblePages = pages.filter((page) => page.webMeta);
  if (visiblePages.length <= 1) {
    return renderWebTranslationOverlay(sessionId, visiblePages[0] ?? pages[0], options);
  }
  const api = window.mangaApi as unknown as {
    renderWebOverlay?: (request: { sessionId: string; page: MangaPage; blocks?: import("../../shared/types").WebOverlayRenderBlock[] }) => Promise<WebBrowseState>;
    writeLog?: (level: "debug" | "info" | "warn" | "error", message: string, detail?: unknown) => Promise<unknown>;
  };
  if (typeof api.renderWebOverlay !== "function") {
    await api.writeLog?.("error", "Web overlay preload API unavailable", {
      availableApiKeys: Object.keys(window.mangaApi ?? {}).sort()
    });
    throw new Error(WEB_OVERLAY_PRELOAD_MISSING_MESSAGE);
  }
  const first = visiblePages[0]!;
  const maxWidth = Math.max(...visiblePages.map((page) => page.webMeta?.viewport.width || page.width || 1), 1);
  const maxHeight = Math.max(
    ...visiblePages.map((page) => (page.webMeta?.scrollY ?? 0) + (page.webMeta?.viewport.height || page.height || 1)),
    1
  );
  const aggregatePage: MangaPage = {
    ...first,
    id: "00000000-0000-4000-8000-000000000001",
    name: "web-full-tile-overlay",
    dataUrl: "",
    width: maxWidth,
    height: maxHeight,
    blocks: [],
    webMeta: {
      ...(first.webMeta!),
      scrollX: 0,
      scrollY: 0,
      viewport: {
        width: maxWidth,
        height: maxHeight,
        deviceScaleFactor: first.webMeta?.viewport.deviceScaleFactor || 1
      },
      captureMode: "full-page",
      captureRectCss: { x: 0, y: 0, width: maxWidth, height: maxHeight }
    }
  };
  const blocks = visiblePages.flatMap((page) =>
    buildWebOverlayRenderBlocks(toWebOverlayDisplayPage(page, options), options).map((block) => ({
      ...block,
      pageId: page.id
    }))
  );
  return api.renderWebOverlay({
    sessionId,
    page: toWebOverlayIpcPage(aggregatePage),
    blocks
  });
}

async function clearWebTranslationOverlay(sessionId: string): Promise<WebBrowseState | null> {
  const fallbackPage: MangaPage = {
    id: "00000000-0000-4000-8000-000000000000",
    name: "clear-web-overlay",
    imagePath: "clear-web-overlay.png",
    dataUrl: "",
    width: 1,
    height: 1,
    blocks: [],
    analysisStatus: "idle",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    webMeta: {
      url: "https://example.invalid/",
      segmentIndex: 0,
      scrollX: 0,
      scrollY: 0,
      viewport: { width: 1, height: 1, deviceScaleFactor: 1 },
      captureMode: "viewport",
      capturedAt: new Date(0).toISOString()
    }
  };
  const api = window.mangaApi as unknown as {
    renderWebOverlay?: (request: { sessionId: string; page: MangaPage; blocks?: import("../../shared/types").WebOverlayRenderBlock[] }) => Promise<WebBrowseState>;
  };
  if (typeof api.renderWebOverlay !== "function") {
    return null;
  }
  return api.renderWebOverlay({ sessionId, page: fallbackPage, blocks: [] });
}

function toWebOverlayDisplayPage(page: MangaPage, options: WebOverlayRenderOptions): MangaPage {
  if (!options.showTextBlocks) {
    return { ...page, blocks: [] };
  }
  if (options.showBlockChrome) {
    return page;
  }
  return {
    ...page,
    blocks: page.blocks.map((block) => ({
      ...block,
      opacity: 0
    }))
  };
}

function toWebOverlayIpcPage(page: MangaPage): MangaPage {
  return page;
}

function buildWebOverlayRenderBlocks(page: MangaPage, options: WebOverlayRenderOptions): import("../../shared/types").WebOverlayRenderBlock[] {
  if (!options.showTextBlocks || !page.webMeta) {
    return [];
  }
  const pageSize = { width: Math.max(1, page.width), height: Math.max(1, page.height) };
  const stageSize = page.webMeta.captureMode === "full-page"
    ? pageSize
    : {
        width: Math.max(1, page.webMeta.viewport.width || page.width || 1),
        height: Math.max(1, page.webMeta.viewport.height || page.height || 1)
      };
  const scrollX = page.webMeta.scrollX ?? 0;
  const scrollY = page.webMeta.scrollY ?? 0;
  return page.blocks
    .map((block) => {
      const model = resolveOverlayBlockRenderModel(block, pageSize, stageSize);
      return toWebOverlayRenderBlock(block, model, scrollX, scrollY, options.showBlockChrome);
    })
    .filter((block): block is import("../../shared/types").WebOverlayRenderBlock => Boolean(block));
}

function applyDraggedBlockBbox(block: TranslationBlock, nextBbox: BBox, bboxKey: "bbox" | "renderBbox"): TranslationBlock {
  const clamped = clampBbox(nextBbox);
  if (bboxKey === "renderBbox") {
    return {
      ...block,
      renderBbox: clamped,
      renderBboxSpace: "normalized_1000"
    };
  }
  return {
    ...block,
    bbox: clamped,
    bboxSpace: "normalized_1000"
  };
}

function resolveWebOverlayPagesForSelection(chapter: ChapterSnapshot | null, page: MangaPage | null): MangaPage[] {
  if (!chapter || !page?.webMeta) {
    return [];
  }
  const isTile = /^web-full-tile-\d+-of-\d+\.png$/i.test(page.name);
  if (!isTile) {
    return [page];
  }
  const capturedAt = page.webMeta.capturedAt;
  const finalUrl = page.webMeta.finalUrl || page.webMeta.url;
  return chapter.pages
    .filter((candidate) =>
      /^web-full-tile-\d+-of-\d+\.png$/i.test(candidate.name) &&
      candidate.webMeta?.capturedAt === capturedAt &&
      (candidate.webMeta.finalUrl || candidate.webMeta.url) === finalUrl
    )
    .sort((a, b) => (a.webMeta?.scrollY ?? 0) - (b.webMeta?.scrollY ?? 0));
}

export default function App(): React.JSX.Element {
  const [library, setLibrary] = useState<LibraryIndex>({ workOrder: [], works: [] });
  const [currentChapter, setCurrentChapter] = useState<ChapterSnapshot | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [regionSelection, setRegionSelection] = useState<RegionSelectionState | null>(null);
  const [jobState, setJobState] = useState<JobState>(EMPTY_JOB);
  const { statusLines, appendStatusLine, pushStatus, clearStatusLines } = useStatusLog();
  const [translationSourceOpen, setTranslationSourceOpen] = useState(false);
  const [webBrowseOpen, setWebBrowseOpen] = useState(false);
  const [webBrowseBusy, setWebBrowseBusy] = useState(false);
  const [webCaptureBusy, setWebCaptureBusy] = useState(false);
  const [webTranslateAfterCapture, setWebTranslateAfterCapture] = useState(true);
  const [webSession, setWebSession] = useState<WebBrowseState | null>(null);
  const [webBrowserCollapsed, setWebBrowserCollapsed] = useState(false);
  const [webOverlaySelectionEnabled, setWebOverlaySelectionEnabled] = useState(false);
  const [importPreview, setImportPreview] = useState<ImportPreviewSession | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [fileDropActive, setFileDropActive] = useState(false);
  const [shareExportOpen, setShareExportOpen] = useState(false);
  const [shareExportBusy, setShareExportBusy] = useState(false);
  const [shareImportPreview, setShareImportPreview] = useState<WorkShareImportPreview | null>(null);
  const [shareImportBusy, setShareImportBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const { confirmDialog, askConfirm, resolveConfirmDialog } = useConfirmDialog();
  const [inpaintingMode, setInpaintingMode] = useState(false);
  const [inpaintingGuideOpen, setInpaintingGuideOpen] = useState(false);
  const [hideInpaintingGuide, setHideInpaintingGuide] = useState(() =>
    typeof window === "undefined" ? false : window.localStorage.getItem(INPAINTING_GUIDE_HIDDEN_KEY) === "1"
  );
  const [inpaintingTool, setInpaintingTool] = useState<InpaintingTool>("none");
  const [inpaintingBrushRadius, setInpaintingBrushRadius] = useState(28);
  const [inpaintingPaintColor, setInpaintingPaintColor] = useState("#ffffff");
  const [peekOriginal, setPeekOriginal] = useState(false);
  const [retouchCursorPoint, setRetouchCursorPoint] = useState<{ x: number; y: number } | null>(null);
  const [retouchPreview, setRetouchPreview] = useState<RetouchPreviewState | null>(null);
  const [patternMaskStrokesByPage, setPatternMaskStrokesByPage] = useState<Record<string, InpaintingMaskStroke[]>>({});
  const [retouchUndoStack, setRetouchUndoStack] = useState<RetouchHistoryEntry[]>([]);
  const [retouchRedoStack, setRetouchRedoStack] = useState<RetouchHistoryEntry[]>([]);
  const [showBlockChrome, setShowBlockChrome] = useState(false);
  const [showTextBlocks, setShowTextBlocks] = useState(true);
  const [pageDownloadSelectionMode, setPageDownloadSelectionMode] = useState(false);
  const [selectedDownloadPageIds, setSelectedDownloadPageIds] = useState<Set<string>>(() => new Set());
  const { settings, settingsOpen, settingsBusy, openSettings, closeSettings, submitSettings, resetSettings } = useSettingsDialog(pushStatus);
  const workspacePanelRef = useRef<HTMLElement | null>(null);
  const webBrowserHostRef = useRef<HTMLDivElement | null>(null);
  const fileDragDepthRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const lastWheelNavigationAtRef = useRef(0);
  const currentChapterRef = useRef<ChapterSnapshot | null>(null);
  const selectedPageIdRef = useRef<string | null>(null);
  const selectedBlockIdRef = useRef<string | null>(null);
  const inpaintingRetouchDrawingRef = useRef(false);
  const inpaintingRetouchPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lastInpaintingRetouchPointRef = useRef<{ x: number; y: number } | null>(null);
  const retouchUndoStackRef = useRef<RetouchHistoryEntry[]>([]);
  const retouchRedoStackRef = useRef<RetouchHistoryEntry[]>([]);

  const selectedPage = useMemo(
    () => currentChapter?.pages.find((page) => page.id === selectedPageId) ?? currentChapter?.pages[0] ?? null,
    [currentChapter?.pages, selectedPageId]
  );
  const patternMaskStrokes = useMemo(
    () => (selectedPage ? (patternMaskStrokesByPage[selectedPage.id] ?? []) : []),
    [patternMaskStrokesByPage, selectedPage]
  );
  const selectedPageImagePath = selectedPage?.inpaintedImagePath ?? selectedPage?.imagePath ?? null;
  const { selectedPageImageDataUrl, selectedPageOriginalImageDataUrl, clearPageImageCache } = usePageImageDataUrls({
    chapterId: currentChapter?.id ?? null,
    selectedPage,
    selectedPageImagePath
  });
  const selectedBlock = selectedPage?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const peekAvailable = Boolean(selectedPage?.inpaintedImagePath && selectedPageOriginalImageDataUrl);
  const showingOriginalPeek = inpaintingMode && peekOriginal && peekAvailable;
  const workspaceImageDataUrl = showingOriginalPeek ? selectedPageOriginalImageDataUrl : selectedPageImageDataUrl;
  const jobActive = ["starting", "running", "cancelling"].includes(jobState.status);
  const { clearDirtyTracking, dirty, dirtyPageIdsRef, markDirty, replaceDirtyPageIds, saveNow } = useChapterPersistence({
    currentChapter,
    currentChapterRef,
    jobActive,
    setCurrentChapter
  });

  useEffect(() => {
    if (!currentChapter) {
      setPageDownloadSelectionMode(false);
      setSelectedDownloadPageIds(new Set());
      return;
    }
    setSelectedDownloadPageIds((current) => {
      const validPageIds = new Set(currentChapter.pages.map((page) => page.id));
      const next = new Set([...current].filter((pageId) => validPageIds.has(pageId)));
      return next.size === current.size ? current : next;
    });
  }, [currentChapter]);
  const { recordEditHistory, undoEdit, redoEdit } = useChapterEditHistory(currentChapter?.id ?? null);
  const modalOpen = Boolean(
    translationSourceOpen || webBrowseOpen || importPreview || shareExportOpen || shareImportPreview || renameTarget || settingsOpen || confirmDialog || inpaintingGuideOpen
  );
  const selectedPageEditLocked = Boolean(jobActive && selectedPage && selectedPage.analysisStatus !== "completed");
  const selectedPageSize = useMemo(
    () => (selectedPage ? { width: selectedPage.width, height: selectedPage.height } : null),
    [selectedPage?.height, selectedPage?.width]
  );
  const webModeActive = Boolean(webSession && currentChapter?.sourceKind === "web");
  const webEditorMode = Boolean(webModeActive && webBrowserCollapsed);
  const stageSizeRevision = `${selectedPageImageDataUrl}|${webEditorMode ? "web-editor" : "normal"}`;
  const stageSize = useStageSize(imageRef, selectedPageSize, stageSizeRevision);
  const progressSnapshot = useMemo(() => resolveProgressSnapshot(jobState), [jobState]);
  const showProgressBar = jobState.status !== "idle" && !!progressSnapshot;
  const regionSelectionRect = useMemo(() => (regionSelection ? regionSelectionToBbox(regionSelection) : null), [regionSelection]);
  const blockCounts = useMemo(() => countChapterBlocks(currentChapter, selectedPage?.id ?? null), [currentChapter, selectedPage?.id]);
  const inpaintedPageCount = useMemo(
    () => currentChapter?.pages.filter((page) => Boolean(page.inpaintedImagePath)).length ?? 0,
    [currentChapter?.pages]
  );
  const inpaintingToolActive = inpaintingMode && inpaintingTool !== "none";
  const retouchCursor =
    inpaintingTool === "brush" || inpaintingTool === "eraser" || inpaintingTool === "mask"
      ? {
          point: retouchCursorPoint,
          radiusPx: inpaintingBrushRadius,
          mode: inpaintingTool,
          color: inpaintingTool === "brush" ? inpaintingPaintColor : inpaintingTool === "mask" ? "#ff9f1c" : "#70b7ff"
        }
      : null;
  const retouchPreviewLayer =
    retouchPreview && retouchPreview.points.length > 0
      ? {
          ...retouchPreview,
          originalImageDataUrl: retouchPreview.mode === "eraser" ? selectedPageOriginalImageDataUrl : ""
        }
      : null;
  const refreshLibrary = useCallback(async () => {
    const next = await window.mangaApi.getLibrary();
    setLibrary(next);
  }, []);

  React.useEffect(() => {
    void refreshLibrary();
  }, [refreshLibrary]);

  React.useEffect(() => {
    currentChapterRef.current = currentChapter;
  }, [currentChapter]);

  React.useEffect(() => {
    selectedPageIdRef.current = selectedPageId;
  }, [selectedPageId]);

  React.useEffect(() => {
    selectedBlockIdRef.current = selectedBlockId;
  }, [selectedBlockId]);

  React.useEffect(() => {
    retouchUndoStackRef.current = retouchUndoStack;
  }, [retouchUndoStack]);

  React.useEffect(() => {
    retouchRedoStackRef.current = retouchRedoStack;
  }, [retouchRedoStack]);

  React.useEffect(() => {
    setRegionSelection(null);
  }, [selectedPage?.id]);

  React.useEffect(() => {
    if (!currentChapter) {
      setInpaintingMode(false);
      setInpaintingGuideOpen(false);
      setPatternMaskStrokesByPage({});
    }
  }, [currentChapter]);

  React.useEffect(() => {
    setRetouchUndoStack([]);
    setRetouchRedoStack([]);
  }, [currentChapter?.id]);

  React.useEffect(() => {
    if (!selectedPage) {
      setRetouchCursorPoint(null);
      setRetouchPreview(null);
    }
  }, [selectedPage]);

  React.useEffect(() => {
    if (!webSession) {
      return;
    }

    let frame = 0;
    const syncHiddenBounds = () => {
      void window.mangaApi.syncWebBrowserBounds({
        sessionId: webSession.sessionId,
        bounds: { x: 0, y: 0, width: 0, height: 0 }
      });
    };
    const syncBounds = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        if (modalOpen || !webModeActive || webEditorMode) {
          syncHiddenBounds();
          return;
        }
        const rect = webBrowserHostRef.current?.getBoundingClientRect();
        if (!rect) {
          return;
        }
        void window.mangaApi.syncWebBrowserBounds({
          sessionId: webSession.sessionId,
          bounds: {
            x: Math.max(0, Math.round(rect.left)),
            y: Math.max(0, Math.round(rect.top)),
            width: Math.max(0, Math.round(rect.width)),
            height: Math.max(0, Math.round(rect.height))
          }
        });
      });
    };

    if (!webModeActive || webEditorMode || !webBrowserHostRef.current) {
      syncHiddenBounds();
      return () => window.cancelAnimationFrame(frame);
    }

    const observer = new ResizeObserver(syncBounds);
    observer.observe(webBrowserHostRef.current);
    window.addEventListener("resize", syncBounds);
    syncBounds();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [modalOpen, webEditorMode, webModeActive, webSession?.sessionId]);

  React.useEffect(() => {
    if (!webSession) {
      return;
    }
    void window.mangaApi.setWebOverlayInteraction({
      sessionId: webSession.sessionId,
      enabled: webOverlaySelectionEnabled && !webBrowserCollapsed
    }).catch((error) => console.error(error));
  }, [webBrowserCollapsed, webOverlaySelectionEnabled, webSession?.sessionId]);

  React.useEffect(() => {
    const unsubscribe = window.mangaApi.onWebOverlayBlockSelected((event) => {
      const chapter = currentChapterRef.current;
      if (!chapter || chapter.id !== event.chapterId || webSession?.sessionId !== event.sessionId) {
        return;
      }
      const page = chapter.pages.find((candidate) => candidate.id === event.pageId);
      if (!page?.blocks.some((block) => block.id === event.blockId)) {
        return;
      }
      setSelectedPageId(event.pageId);
      setSelectedBlockId(event.blockId);
      setShowBlockChrome(true);
    });
    return unsubscribe;
  }, [webSession?.sessionId]);

  React.useEffect(() => {
    if (!inpaintingToolActive) {
      setRetouchCursorPoint(null);
      setRetouchPreview(null);
    }
  }, [inpaintingToolActive]);

  const mergeLiveChapter = useCallback((chapter: ChapterSnapshot) => {
    const current = currentChapterRef.current;
    if (current && current.id !== chapter.id) {
      return;
    }

    const mergeResult = mergeLiveChapterPreservingDirtyPages(chapter, current, dirtyPageIdsRef.current);
    replaceDirtyPageIds(mergeResult.preservedDirtyPageIds);
    currentChapterRef.current = mergeResult.chapter;

    setCurrentChapter((currentChapter) => {
      if (currentChapter && currentChapter.id !== mergeResult.chapter.id) {
        return currentChapter;
      }
      return mergeResult.chapter;
    });

    const selection = resolveSelectionAfterChapterSync(mergeResult.chapter, selectedPageIdRef.current, selectedBlockIdRef.current);
    setSelectedPageId(selection.selectedPageId);
    setSelectedBlockId(selection.selectedBlockId);
  }, [dirtyPageIdsRef, replaceDirtyPageIds]);

  useJobEvents({
    appendStatusLine,
    currentChapterRef,
    mergeLiveChapter,
    refreshLibrary,
    setJobState
  });

  const clearCurrentChapter = useCallback(() => {
    setCurrentChapter(null);
    currentChapterRef.current = null;
    setSelectedPageId(null);
    setSelectedBlockId(null);
    clearDirtyTracking();
  }, [clearDirtyTracking]);

  const openChapter = useCallback(
    async (chapterId: string) => {
      if (dirty) {
        await saveNow();
      }
      const chapter = await window.mangaApi.openChapter(chapterId);
      if (webSession) {
        try {
          await window.mangaApi.closeWebBrowse(webSession.sessionId);
        } catch (error) {
          console.error(error);
        }
        setWebSession(null);
      }
      if (chapter.sourceKind === "web" && chapter.webOrigin?.startUrl) {
        try {
          const result = await window.mangaApi.reopenWebChapter({ chapterId: chapter.id, mode: "manual" });
          clearDirtyTracking();
          currentChapterRef.current = result.openedChapter;
          setCurrentChapter(result.openedChapter);
          setSelectedPageId(result.openedChapter.pages[0]?.id ?? null);
          setSelectedBlockId(null);
          setWebSession({
            sessionId: result.sessionId,
            chapterId: result.chapterId,
            url: result.url,
            title: result.title,
            mode: "manual",
            segmentCount: result.openedChapter.pages.length,
            autoTranslate: false
          });
          setWebBrowserCollapsed(false);
          setWebOverlaySelectionEnabled(false);
          pushStatus("저장된 웹 주소로 페이지를 다시 열었습니다.");
          return;
        } catch (error) {
          console.error(error);
          pushStatus(formatErrorMessage(error, "저장된 웹 주소를 다시 열지 못해 캡처본만 표시합니다."));
        }
      }
      clearDirtyTracking();
      currentChapterRef.current = chapter;
      setCurrentChapter(chapter);
      setSelectedPageId(chapter.pages[0]?.id ?? null);
      setSelectedBlockId(null);
    },
    [clearDirtyTracking, dirty, pushStatus, saveNow, webSession]
  );

  const applyChapter = useCallback((chapter: ChapterSnapshot | undefined, fallbackStatus?: string) => {
    if (!chapter) {
      return;
    }
    clearDirtyTracking();
    currentChapterRef.current = chapter;
    setCurrentChapter(chapter);
    setSelectedPageId((current) => (chapter.pages.some((page) => page.id === current) ? current : chapter.pages[0]?.id ?? null));
    setSelectedBlockId(null);
    if (fallbackStatus) {
      pushStatus(fallbackStatus);
    }
  }, [clearDirtyTracking, pushStatus]);

  const selectPageForReading = useCallback((pageId: string | null) => {
    if (!pageId) {
      return;
    }
    selectedPageIdRef.current = pageId;
    selectedBlockIdRef.current = null;
    setSelectedPageId(pageId);
    setSelectedBlockId(null);
  }, []);

  const selectAdjacentPageForReading = useCallback(
    (direction: "previous" | "next") => {
      const chapter = currentChapterRef.current;
      const pageIds = chapter?.pages.map((page) => page.id) ?? [];
      const nextPageId = resolveAdjacentPageId(pageIds, selectedPageIdRef.current, direction);
      if (!nextPageId) {
        return false;
      }

      selectPageForReading(nextPageId);
      return true;
    },
    [selectPageForReading]
  );

  const openImportPreview = useCallback(async (mode: "images" | "folder" | "zip" | "zip-folder") => {
    const preview =
      mode === "images"
        ? await window.mangaApi.previewImagesImport()
        : mode === "folder"
          ? await window.mangaApi.previewFolderImport()
          : mode === "zip"
            ? await window.mangaApi.previewZipImport()
            : await window.mangaApi.previewZipFolderImport();
    if (!preview) {
      return;
    }
    setImportPreview(preview);
  }, []);

  const openDroppedImportPreview = useCallback(
    async (files: File[]) => {
      const filePaths = files
        .map((file) => window.mangaApi.getPathForFile(file) || (file as File & { path?: string }).path || "")
        .filter(Boolean);
      if (filePaths.length === 0) {
        pushStatus("드롭한 파일 경로를 알 수 없습니다.");
        return;
      }
      try {
        const preview = await window.mangaApi.previewDroppedImport(filePaths);
        if (preview) {
          setImportPreview(preview);
        } else {
          pushStatus("가져올 수 있는 이미지가 없습니다.");
        }
      } catch (error) {
        console.error(error);
        pushStatus(formatErrorMessage(error, "드롭한 파일을 열 수 없습니다."));
      }
    },
    [pushStatus]
  );

  const onWorkspaceDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current += 1;
    setFileDropActive(true);
  }, []);

  const onWorkspaceDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setFileDropActive(true);
  }, []);

  const onWorkspaceDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
    if (fileDragDepthRef.current === 0) {
      setFileDropActive(false);
    }
  }, []);

  const onWorkspaceDrop = useCallback(
    (event: React.DragEvent<HTMLElement>) => {
      if (!hasDraggedFiles(event.dataTransfer)) {
        return;
      }
      event.preventDefault();
      fileDragDepthRef.current = 0;
      setFileDropActive(false);
      void openDroppedImportPreview(Array.from(event.dataTransfer.files));
    },
    [openDroppedImportPreview]
  );

  const selectTranslateSource = useCallback(
    async (mode: TranslateSourceMode) => {
      setTranslationSourceOpen(false);
      await openImportPreview(mode);
    },
    [openImportPreview]
  );

  const submitShareExport = useCallback(
    async (request: WorkShareExportRequest) => {
      setShareExportBusy(true);
      try {
        if (dirty) {
          await saveNow();
        }
        const result = await window.mangaApi.exportWorkShare(request);
        if (result) {
          pushStatus(`${result.workTitle} 공유 파일을 저장했습니다. ${result.chapterCount}개 화, ${result.pageCount}페이지`);
          setShareExportOpen(false);
        }
      } catch (error) {
        console.error(error);
        pushStatus(formatErrorMessage(error, "공유 파일을 저장하지 못했습니다."));
      } finally {
        setShareExportBusy(false);
      }
    },
    [dirty, pushStatus, saveNow]
  );

  const openShareImportPreview = useCallback(async () => {
    try {
      if (dirty) {
        await saveNow();
      }
      const preview = await window.mangaApi.previewWorkShareImport();
      if (preview) {
        setShareImportPreview(preview);
      }
    } catch (error) {
      console.error(error);
      pushStatus(formatErrorMessage(error, "공유 파일을 읽지 못했습니다."));
    }
  }, [dirty, pushStatus, saveNow]);

  const submitShareImport = useCallback(
    async (payload: ShareImportModalSubmit) => {
      if (!shareImportPreview) {
        return;
      }

      if (payload.remainingPackageChapters.length > 0) {
        const confirmed = await askConfirm(
          "가져오지 않는 화가 있습니다",
          "오른쪽에 남은 공유 화는 적용되지 않습니다.",
          payload.remainingPackageChapters.map((chapter) => chapter.title).join("\n")
        );
        if (!confirmed) {
          return;
        }
      }

      if (payload.deletedExistingChapters.length > 0) {
        const confirmed = await askConfirm(
          "기존 화 삭제",
          "왼쪽 최종 목록에서 빠진 기존 화가 보관함에서 삭제됩니다.",
          payload.deletedExistingChapters.map((chapter) => chapter.title).join("\n")
        );
        if (!confirmed) {
          return;
        }
      }

      setShareImportBusy(true);
      try {
        if (dirty) {
          await saveNow();
        }
        const result = await window.mangaApi.importWorkShare({
          previewId: shareImportPreview.previewId,
          target: payload.target,
          entries: payload.entries
        });
        await refreshLibrary();
        applyChapter(result.openedChapter, `${result.chapterIds.length}개 화를 보관함에 적용했습니다.`);
        setShareImportPreview(null);
      } catch (error) {
        console.error(error);
        pushStatus(formatErrorMessage(error, "공유 파일을 가져오지 못했습니다."));
      } finally {
        setShareImportBusy(false);
      }
    },
    [applyChapter, askConfirm, dirty, pushStatus, refreshLibrary, saveNow, shareImportPreview]
  );

  const runAnalysis = useCallback(
    async (runMode: "pending" | "all" | "single-page", pageId?: string) => {
      if (!currentChapter || jobActive) {
        return;
      }

      await saveNow();
      clearStatusLines();
      setJobState({
        id: "pending",
        kind: "gemma-analysis",
        status: "starting",
        progressText: "모델 준비 중",
        phase: "booting"
      });
      setCurrentChapter((chapter) => (chapter ? markChapterPagesRunning(chapter, runMode, pageId) : chapter));

      const result = await window.mangaApi.startAnalysis({ chapterId: currentChapter.id, runMode, pageId });
      if (result.chapter) {
        mergeLiveChapter(result.chapter);
      }
      await refreshLibrary();

      if (result.status === "completed") {
        const warningSummary = summarizeWarnings(result.warnings ?? []);
        if (warningSummary) {
          pushStatus(warningSummary);
        }
        return;
      }

      if (result.status === "failed" && result.error) {
        pushStatus(result.error);
      }
    },
    [clearStatusLines, currentChapter, jobActive, mergeLiveChapter, pushStatus, refreshLibrary, saveNow]
  );

  const openWebBrowse = useCallback(
    async (request: OpenWebBrowseRequest) => {
      if (dirty) {
        await saveNow();
      }
      setWebBrowseBusy(true);
      try {
        const result = await window.mangaApi.openWebBrowse(request);
        clearDirtyTracking();
        currentChapterRef.current = result.openedChapter;
        setCurrentChapter(result.openedChapter);
        setSelectedPageId(result.openedChapter.pages[0]?.id ?? null);
        setSelectedBlockId(null);
        setWebSession({
          sessionId: result.sessionId,
          chapterId: result.chapterId,
          url: result.url,
          title: result.title,
          mode: request.mode || "manual",
          segmentCount: 0,
          autoTranslate: false
        });
        setWebBrowserCollapsed(false);
        setWebOverlaySelectionEnabled(false);
        setWebBrowseOpen(false);
        await refreshLibrary();
        pushStatus("웹 페이지를 열었습니다. 현재 화면 캡처를 누르면 보관함에 페이지로 추가됩니다.");
      } catch (error) {
        console.error(error);
        pushStatus(formatErrorMessage(error, "웹 페이지를 열지 못했습니다."));
      } finally {
        setWebBrowseBusy(false);
      }
    },
    [clearDirtyTracking, dirty, pushStatus, refreshLibrary, saveNow]
  );

  const closeWebBrowse = useCallback(async () => {
    if (!webSession) {
      return;
    }
    try {
      await window.mangaApi.closeWebBrowse(webSession.sessionId);
    } catch (error) {
      console.error(error);
    }
    setWebSession(null);
    setWebBrowserCollapsed(false);
    setWebOverlaySelectionEnabled(false);
  }, [webSession]);

  const toggleWebOverlaySelection = useCallback((enabled: boolean) => {
    setWebOverlaySelectionEnabled(enabled);
    if (enabled) {
      setShowTextBlocks(true);
      setShowBlockChrome(true);
    }
    if (!enabled) {
      setSelectedBlockId(null);
    }
  }, []);

  const toggleWebBrowserCollapsed = useCallback(() => {
    setWebBrowserCollapsed((value) => {
      const next = !value;
      if (next) {
        setShowTextBlocks(true);
        setShowBlockChrome(true);
      }
      return next;
    });
  }, []);

  const captureWebSegment = useCallback(async (translateAfterCapture = webTranslateAfterCapture, captureMode: WebCaptureMode = "viewport") => {
    if (!webSession || webCaptureBusy || jobActive) {
      return null;
    }
    if (dirty) {
      await saveNow();
    }
    setWebCaptureBusy(true);
    try {
      const result = await window.mangaApi.captureWebSegment({ sessionId: webSession.sessionId, captureMode });
      clearDirtyTracking();
      currentChapterRef.current = result.chapter;
      setCurrentChapter(result.chapter);
      setSelectedPageId(result.pageId);
      setSelectedBlockId(null);
      setWebSession((current) =>
        current
          ? {
              ...current,
              chapterId: result.chapter.id,
              segmentCount: result.chapter.pages.length
            }
          : current
      );
      await refreshLibrary();
      clearPageImageCache();
      const capturedPageIds = result.pageIds?.length ? result.pageIds : [result.pageId];
      const capturedPageCount = capturedPageIds.length;
      pushStatus(
        captureMode === "full-page"
          ? capturedPageCount > 1
            ? `전체 스크롤을 ${capturedPageCount}개 타일로 캡처했습니다.`
            : `전체 스크롤을 캡처했습니다: ${result.segmentIndex + 1}번째 세그먼트`
          : `웹 화면을 캡처했습니다: ${result.segmentIndex + 1}번째 세그먼트`
      );

      if (translateAfterCapture) {
        clearStatusLines();
        setJobState({
          id: "pending",
          kind: "gemma-analysis",
          status: "starting",
          progressText: "모델 준비 중",
          phase: "booting"
        });
        const analysisRunMode = capturedPageCount > 1 ? "pending" : "single-page";
        setCurrentChapter((chapter) => (chapter ? markChapterPagesRunning(chapter, analysisRunMode, result.pageId) : chapter));
        const analysis = await window.mangaApi.startAnalysis({
          chapterId: result.chapter.id,
          runMode: analysisRunMode,
          pageId: analysisRunMode === "single-page" ? result.pageId : undefined
        });
        if (analysis.chapter) {
          mergeLiveChapter(analysis.chapter);
        }
        await refreshLibrary();
        if (analysis.status === "failed" && analysis.error) {
          pushStatus(analysis.error);
        } else {
          const translatedPages = capturedPageIds
            .map((pageId) => analysis.chapter?.pages.find((page) => page.id === pageId))
            .filter((page): page is MangaPage => Boolean(page));
          const translatedPage = translatedPages[0];
          if (translatedPage) {
            await renderWebTranslationOverlayForPages(webSession.sessionId, translatedPages, { showBlockChrome, showTextBlocks });
          }
          const warningSummary = summarizeWarnings(analysis.warnings ?? []);
          if (warningSummary) {
            pushStatus(warningSummary);
          } else if (translatedPage) {
            pushStatus(
              captureMode === "full-page" && capturedPageCount > 1
                ? `전체 스크롤 타일 ${capturedPageCount}개의 번역 오버레이를 표시했습니다.`
                : captureMode === "full-page"
                  ? "전체 스크롤 번역 오버레이를 표시했습니다."
                  : "웹 화면 위에 번역 오버레이를 표시했습니다."
            );
          }
        }
      }
      return result;
    } catch (error) {
      console.error(error);
      pushStatus(formatErrorMessage(error, "웹 화면을 캡처하지 못했습니다."));
      return null;
    } finally {
      setWebCaptureBusy(false);
    }
  }, [
    clearDirtyTracking,
    clearPageImageCache,
    clearStatusLines,
    dirty,
    jobActive,
    mergeLiveChapter,
    pushStatus,
    refreshLibrary,
    saveNow,
    showBlockChrome,
    showTextBlocks,
    webCaptureBusy,
    webSession,
    webTranslateAfterCapture
  ]);

  const translateCurrentWebScreen = useCallback(async () => {
    await captureWebSegment(true);
  }, [captureWebSegment]);

  const translateFullWebPage = useCallback(async () => {
    await captureWebSegment(true, "full-page");
  }, [captureWebSegment]);

  const startWebRegionTranslation = useCallback(async () => {
    if (!webSession || webCaptureBusy || jobActive) {
      return;
    }
    pushStatus("웹 화면에서 번역할 영역을 드래그하세요. 취소하려면 Esc를 누르세요.");
    const selection = await window.mangaApi.selectWebRegion({ sessionId: webSession.sessionId });
    if (!selection.bbox) {
      pushStatus("웹 선택영역 번역을 취소했습니다.");
      return;
    }
    const result = await captureWebSegment(false);
    if (!result) {
      return;
    }
    clearStatusLines();
    setJobState({
      id: "pending",
      kind: "gemma-analysis",
      status: "starting",
      progressText: "선택 영역 번역 준비 중",
      phase: "booting",
      progressCurrent: 0,
      progressTotal: 1,
      pageIndex: 1,
      pageTotal: 1
    });
    const analysis = await window.mangaApi.translateRegion({
      chapterId: result.chapter.id,
      pageId: result.pageId,
      bbox: selection.bbox
    });
    if (analysis.chapter) {
      mergeLiveChapter(analysis.chapter);
    }
    await refreshLibrary();
    if (analysis.status === "failed" && analysis.error) {
      pushStatus(analysis.error);
      return;
    }
    const translatedPage = analysis.chapter?.pages.find((page) => page.id === result.pageId);
    if (translatedPage) {
      await renderWebTranslationOverlay(webSession.sessionId, translatedPage, { showBlockChrome, showTextBlocks });
    }
    const warningSummary = summarizeWarnings(analysis.warnings ?? []);
    pushStatus(warningSummary || "웹 선택영역 번역 오버레이를 표시했습니다.");
  }, [
    captureWebSegment,
    clearStatusLines,
    jobActive,
    mergeLiveChapter,
    pushStatus,
    refreshLibrary,
    showBlockChrome,
    showTextBlocks,
    webCaptureBusy,
    webSession
  ]);

  const enterInpaintingMode = useCallback(async () => {
    if (!currentChapter || jobActive) {
      return;
    }
    if (currentChapter.pages.length === 0) {
      pushStatus("인페인팅할 페이지가 없습니다. 먼저 웹 화면을 캡처/번역해 페이지를 추가하세요.");
      return;
    }
    if (dirty) {
      await saveNow();
    }
    if (webModeActive) {
      setWebBrowserCollapsed(true);
      setWebOverlaySelectionEnabled(false);
    }
    setInpaintingMode(true);
    setInpaintingTool("none");
    setSelectedBlockId(null);
    setRegionSelection(null);
    setShowBlockChrome(true);
    setShowTextBlocks(true);
    if (!hideInpaintingGuide) {
      setInpaintingGuideOpen(true);
    }
    pushStatus("인페인팅 모드로 전환했습니다. 무늬 배경 지우기부터 시작하세요.");
  }, [currentChapter, dirty, hideInpaintingGuide, jobActive, pushStatus, saveNow, webModeActive]);

  const exitInpaintingMode = useCallback(() => {
    if (jobActive) {
      return;
    }
    setInpaintingMode(false);
    setInpaintingTool("none");
    setPeekOriginal(false);
    setInpaintingGuideOpen(false);
    setPatternMaskStrokesByPage({});
    setSelectedBlockId(null);
    setRegionSelection(null);
    void window.mangaApi.disposeInpaintingEngine().catch((error) => console.error(error));
    pushStatus("인페인팅 모드를 종료했습니다.");
  }, [jobActive, pushStatus]);

  const runInpainting = useCallback(
    async (scope: "page" | "chapter") => {
      if (!currentChapter || jobActive) {
        return;
      }
      if (scope === "page" && !selectedPage) {
        return;
      }
      if (dirty) {
        await saveNow();
      }
      const targetLabel = "무늬 배경";
      const scopeLabel = scope === "page" ? "현재 페이지" : "아직 지우지 않은 페이지";
      const confirmed = await askConfirm(
        `${targetLabel} 원문 지우기`,
        `${scopeLabel}의 ${targetLabel} 블록을 지웁니다.`,
        "말풍선, 톤, 배경 그림, 효과음 위 글자까지 모두 Flux 인페인팅으로 지웁니다. 원본 이미지는 유지하고 결과 이미지는 별도로 저장합니다."
      );
      if (!confirmed) {
        return;
      }

      setJobState({
        id: "pending-inpainting",
        kind: "inpainting",
        status: "starting",
        progressText: `${targetLabel} 지우기 준비 중`,
        phase: "inpainting_preparing"
      });

      const result = await window.mangaApi.startInpainting(
        scope === "page"
          ? {
              chapterId: currentChapter.id,
              mode: "page-pattern",
              pageId: selectedPage!.id
            }
          : {
              chapterId: currentChapter.id,
              mode: "chapter-pattern-pending"
            }
      );
      if (result.chapter) {
        clearPageImageCache();
        mergeLiveChapter(result.chapter);
      }
      await refreshLibrary();

      if (result.status === "completed") {
        pushStatus(`${targetLabel} 지우기 완료: ${result.pagesChanged ?? 0}페이지, ${result.blocksErased ?? 0}블록`);
      } else if (result.status === "failed" && result.error) {
        pushStatus(result.error);
      }
    },
    [askConfirm, clearPageImageCache, currentChapter, dirty, jobActive, mergeLiveChapter, pushStatus, refreshLibrary, saveNow, selectedPage]
  );

  const runDrawnPatternInpainting = useCallback(async () => {
    if (!currentChapter || !selectedPage || jobActive || patternMaskStrokes.length === 0) {
      return;
    }
    if (dirty) {
      await saveNow();
    }
    const confirmed = await askConfirm(
      "그린 영역 지우기",
      "주황색으로 그린 마스크 영역만 Flux로 지웁니다.",
      "글자 위를 넉넉히 문질러 둔 영역을 crop으로 잘라 무늬 배경을 복원합니다. 결과는 별도 이미지로 저장되며 원본 페이지는 유지됩니다."
    );
    if (!confirmed) {
      return;
    }
    setInpaintingTool("none");
    setJobState({
      id: "pending-inpainting",
      kind: "inpainting",
      status: "starting",
      progressText: "그린 영역 지우기 준비 중",
      phase: "inpainting_preparing",
      progressCurrent: 0,
      progressTotal: 1
    });
    const result = await window.mangaApi.startInpainting({
      chapterId: currentChapter.id,
      mode: "page-pattern-drawn",
      pageId: selectedPage.id,
      strokes: patternMaskStrokes,
      featherPx: 8
    });
    if (result.chapter) {
      clearPageImageCache();
      mergeLiveChapter(result.chapter);
    }
    await refreshLibrary();
    if (result.status === "completed") {
      setPatternMaskStrokesByPage((current) => {
        const next = { ...current };
        delete next[selectedPage.id];
        return next;
      });
      pushStatus(`그린 영역 지우기 완료: ${result.pagesChanged ?? 0}페이지, ${result.blocksErased ?? 0}영역`);
    } else if (result.status === "failed" && result.error) {
      pushStatus(result.error);
    }
  }, [
    askConfirm,
    currentChapter,
    clearPageImageCache,
    dirty,
    jobActive,
    mergeLiveChapter,
    patternMaskStrokes,
    pushStatus,
    refreshLibrary,
    saveNow,
    selectedPage
  ]);

  const exportInpaintingResults = useCallback(async (scope: "page" | "chapter") => {
    if (!currentChapter || jobActive) {
      return;
    }
    if (scope === "page" && !selectedPage) {
      pushStatus("출력할 페이지가 선택되어 있지 않습니다.");
      return;
    }
    if (dirty) {
      await saveNow();
    }
    const targetTotal = scope === "page" ? 1 : currentChapter.pages.length;
    try {
      setJobState({
        id: "pending-export",
        kind: "inpainting",
        status: "starting",
        progressText: "PNG 출력 준비 중",
        phase: "finalizing",
        progressCurrent: 0,
        progressTotal: targetTotal,
        pageTotal: targetTotal,
        detail: scope === "page" ? selectedPage?.name : `${currentChapter.pages.length}페이지`
      });
      const request =
        scope === "page"
          ? { chapterId: currentChapter.id, scope, pageId: selectedPage!.id }
          : { chapterId: currentChapter.id, scope };
      const result = await window.mangaApi.exportInpaintingResults(request);
      pushStatus(`인페인팅 결과를 PNG로 출력했습니다: ${result.pageCount}페이지`);
    } catch (error) {
      console.error(error);
      pushStatus(formatErrorMessage(error, "인페인팅 결과를 출력하지 못했습니다."));
    }
  }, [currentChapter, dirty, jobActive, pushStatus, saveNow, selectedPage]);

  const exportPageImages = useCallback(
    async (pageIds: string[]) => {
      if (!currentChapter || jobActive) {
        return;
      }
      const validPageIds = currentChapter.pages.map((page) => page.id);
      const requested = pageIds.filter((pageId) => validPageIds.includes(pageId));
      if (!requested.length) {
        pushStatus("다운로드할 페이지가 없습니다.");
        return;
      }
      if (dirty) {
        await saveNow();
      }
      try {
        const result =
          requested.length === 1
            ? await window.mangaApi.exportPageImages({
                chapterId: currentChapter.id,
                scope: "page",
                pageId: requested[0]!,
                options: { showTextBlocks, showBlockChrome }
              })
            : await window.mangaApi.exportPageImages({
                chapterId: currentChapter.id,
                scope: "pages",
                pageIds: requested,
                options: { showTextBlocks, showBlockChrome }
              });
        if (result) {
          pushStatus(`번역 이미지를 저장했습니다: ${result.pageCount}페이지`);
        } else {
          pushStatus("번역 이미지 다운로드를 취소했습니다.");
        }
      } catch (error) {
        console.error(error);
        pushStatus(formatErrorMessage(error, "번역 이미지를 저장하지 못했습니다."));
      }
    },
    [currentChapter, dirty, jobActive, pushStatus, saveNow, showBlockChrome, showTextBlocks]
  );

  const startPageDownloadSelection = useCallback(() => {
    if (!currentChapter || jobActive) {
      return;
    }
    setSelectedDownloadPageIds(new Set(currentChapter.pages.map((page) => page.id)));
    setPageDownloadSelectionMode(true);
  }, [currentChapter, jobActive]);

  const togglePageDownloadSelection = useCallback((pageId: string) => {
    setSelectedDownloadPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        next.add(pageId);
      }
      return next;
    });
  }, []);

  const downloadSelectedPages = useCallback(() => {
    if (!currentChapter) {
      return;
    }
    const selected = currentChapter.pages.map((page) => page.id).filter((pageId) => selectedDownloadPageIds.has(pageId));
    void exportPageImages(selected);
  }, [currentChapter, exportPageImages, selectedDownloadPageIds]);

  const startRegionTranslationSelection = useCallback(() => {
    if (!selectedPage || !selectedPageImageDataUrl || jobActive) {
      return;
    }

    if (regionSelection?.active) {
      setRegionSelection(null);
      pushStatus("영역 번역 선택을 취소했습니다.");
      return;
    }

    setSelectedBlockId(null);
    setRegionSelection({
      active: true,
      dragging: false,
      start: { x: 0, y: 0 },
      current: { x: 0, y: 0 }
    });
    pushStatus("번역할 영역을 드래그하세요.");
  }, [jobActive, pushStatus, regionSelection?.active, selectedPage, selectedPageImageDataUrl]);

  const translateSelectedRegion = useCallback(
    async (bbox: BBox) => {
      if (!currentChapter || !selectedPage || jobActive) {
        return;
      }
      if (!isUsableRegionBbox(bbox, 10)) {
        pushStatus("선택 영역이 너무 작습니다.");
        return;
      }

      await saveNow();
      clearStatusLines();
      setJobState({
        id: "pending",
        kind: "gemma-analysis",
        status: "starting",
        progressText: "선택 영역 번역 준비 중",
        phase: "booting",
        progressCurrent: 0,
        progressTotal: 1,
        pageIndex: 1,
        pageTotal: 1
      });

      const result = await window.mangaApi.translateRegion({
        chapterId: currentChapter.id,
        pageId: selectedPage.id,
        bbox
      });
      if (result.chapter) {
        mergeLiveChapter(result.chapter);
      }
      await refreshLibrary();

      if (result.status === "completed") {
        if (result.blockIds?.[0]) {
          setSelectedBlockId(result.blockIds[0]);
        }
        const warningSummary = summarizeWarnings(result.warnings ?? []);
        pushStatus(warningSummary || `선택 영역에서 ${result.blockIds?.length ?? 0}개 블록을 만들었습니다.`);
        return;
      }

      if (result.status === "failed" && result.error) {
        pushStatus(result.error);
      }
    },
    [clearStatusLines, currentChapter, jobActive, mergeLiveChapter, pushStatus, refreshLibrary, saveNow, selectedPage]
  );

  const submitImport = useCallback(
    async ({ target, selections }: ImportModalSubmit) => {
      if (!importPreview) {
        return;
      }

      setImportBusy(true);
      try {
        const result = await window.mangaApi.createImport({
          previewId: importPreview.previewId,
          target,
          selections
        });
        await refreshLibrary();
        applyChapter(result.openedChapter, `${result.chapterIds.length}개 화를 보관함에 추가했습니다.`);
        setImportPreview(null);

        if (importPreview.mode === "batch") {
          for (const chapterId of result.chapterIds) {
            await openChapter(chapterId);
            const runResult = await window.mangaApi.startAnalysis({ chapterId, runMode: "pending" });
            if (runResult.chapter) {
              mergeLiveChapter(runResult.chapter);
            }
            await refreshLibrary();
            if (runResult.status !== "completed") {
              break;
            }
          }
        }
      } finally {
        setImportBusy(false);
      }
    },
    [applyChapter, importPreview, mergeLiveChapter, openChapter, refreshLibrary]
  );

  const updateCurrentChapter = useCallback((pageId: string, updater: (chapter: ChapterSnapshot) => ChapterSnapshot) => {
    setCurrentChapter((current) => {
      if (!current) {
        return current;
      }
      const next = updater(current);
      currentChapterRef.current = next;
      markDirty(pageId);
      return next;
    });
  }, [markDirty]);

  const getCurrentEditSnapshot = useCallback((): ChapterEditSnapshot | null => {
    const chapter = currentChapterRef.current;
    if (!chapter) {
      return null;
    }
    return {
      chapter,
      selectedPageId: selectedPageIdRef.current,
      selectedBlockId: selectedBlockIdRef.current
    };
  }, []);

  const recordEditHistoryBeforeChange = useCallback(
    (options?: { force?: boolean }) => {
      const snapshot = getCurrentEditSnapshot();
      if (snapshot) {
        recordEditHistory(snapshot, options);
      }
    },
    [getCurrentEditSnapshot, recordEditHistory]
  );

  React.useEffect(() => {
    if (!webSession) {
      return;
    }
    if (!selectedPage?.webMeta) {
      const handle = window.setTimeout(() => {
        void clearWebTranslationOverlay(webSession.sessionId).catch((error) => console.error(error));
      }, 80);
      return () => window.clearTimeout(handle);
    }
    const overlayOptions = {
      showBlockChrome,
      showTextBlocks
    };
    const handle = window.setTimeout(() => {
      const overlayPages = resolveWebOverlayPagesForSelection(currentChapter, selectedPage);
      void renderWebTranslationOverlayForPages(webSession.sessionId, overlayPages.length ? overlayPages : [selectedPage], overlayOptions).catch((error) => console.error(error));
    }, 80);
    return () => window.clearTimeout(handle);
  }, [
    currentChapter,
    selectedPage,
    selectedBlockId,
    webOverlaySelectionEnabled,
    webBrowserCollapsed,
    showBlockChrome,
    showTextBlocks,
    webSession?.sessionId
  ]);

  const applyEditSnapshot = useCallback(
    (snapshot: ChapterEditSnapshot) => {
      currentChapterRef.current = snapshot.chapter;
      setCurrentChapter(snapshot.chapter);
      setSelectedPageId(snapshot.selectedPageId);
      setSelectedBlockId(snapshot.selectedBlockId);
      for (const page of snapshot.chapter.pages) {
        markDirty(page.id);
      }
    },
    [markDirty]
  );

  const undoChapterEdit = useCallback(() => {
    if (jobActive) {
      return;
    }
    const current = getCurrentEditSnapshot();
    if (!current) {
      return;
    }
    const previous = undoEdit(current);
    if (!previous) {
      return;
    }
    applyEditSnapshot(previous);
    pushStatus("편집을 되돌렸습니다.");
  }, [applyEditSnapshot, getCurrentEditSnapshot, jobActive, pushStatus, undoEdit]);

  const redoChapterEdit = useCallback(() => {
    if (jobActive) {
      return;
    }
    const current = getCurrentEditSnapshot();
    if (!current) {
      return;
    }
    const next = redoEdit(current);
    if (!next) {
      return;
    }
    applyEditSnapshot(next);
    pushStatus("편집을 다시 적용했습니다.");
  }, [applyEditSnapshot, getCurrentEditSnapshot, jobActive, pushStatus, redoEdit]);

  const reapplyWebTranslationOverlay = useCallback(async () => {
    if (!webSession || !selectedPage?.webMeta) {
      return;
    }
    const overlayPages = resolveWebOverlayPagesForSelection(currentChapter, selectedPage);
    await renderWebTranslationOverlayForPages(
      webSession.sessionId,
      overlayPages.length ? overlayPages : [selectedPage],
      { showBlockChrome, showTextBlocks }
    );
    pushStatus("현재 웹 화면에 번역 블록을 다시 적용했습니다.");
  }, [currentChapter, pushStatus, selectedPage, showBlockChrome, showTextBlocks, webSession]);

  const reloadWebBrowser = useCallback(async () => {
    if (!webSession) {
      return;
    }
    const state = await window.mangaApi.reloadWebBrowse(webSession.sessionId);
    setWebSession(state);
    await clearWebTranslationOverlay(webSession.sessionId);
    pushStatus("웹 페이지를 새로고침했습니다. 로딩 후 번역 다시 적용을 누르세요.");
  }, [pushStatus, webSession]);

  const removePage = useCallback(
    async (pageId: string) => {
      if (!currentChapter) {
        return;
      }
      const page = currentChapter.pages.find((candidate) => candidate.id === pageId);
      if (!page) {
        return;
      }
      const confirmed = await askConfirm(
        "페이지 삭제",
        "정말 삭제하시겠습니까?",
        "이 페이지와 해당 번역 결과가 보관함에서 삭제됩니다."
      );
      if (!confirmed) {
        return;
      }

      const previousOrder = currentChapter.pages.map((candidate) => candidate.id);
      const nextChapter = await window.mangaApi.deletePage(currentChapter.id, pageId);
      applyChapter(nextChapter);
      const currentIndex = previousOrder.indexOf(pageId);
      const nextId = previousOrder[currentIndex + 1] ?? previousOrder[currentIndex - 1] ?? null;
      const nextSelectedPageId = nextId && nextChapter.pages.some((candidate) => candidate.id === nextId) ? nextId : nextChapter.pages[0]?.id ?? null;
      setSelectedPageId(nextSelectedPageId);
      const nextSelectedPage = nextChapter.pages.find((candidate) => candidate.id === nextSelectedPageId) ?? null;
      if (webSession && page.webMeta && !nextSelectedPage?.webMeta) {
        void clearWebTranslationOverlay(webSession.sessionId).catch((error) => console.error(error));
      }
      pushStatus(`${page.name} 페이지를 삭제했습니다.`);
      await refreshLibrary();
    },
    [applyChapter, askConfirm, currentChapter, pushStatus, refreshLibrary, webSession]
  );

  const retranslatePage = useCallback(
    async (pageId: string) => {
      const page = currentChapter?.pages.find((candidate) => candidate.id === pageId);
      if (!page || !currentChapter) {
        return;
      }
      const confirmed = await askConfirm(
        "페이지 재번역",
        "정말 재번역 하시겠습니까?",
        "기존 번역 결과와 수정 내용이 이 페이지에서 덮어써집니다."
      );
      if (!confirmed) {
        return;
      }
      await runAnalysis("single-page", pageId);
    },
    [askConfirm, currentChapter, runAnalysis]
  );

  const updateSelectedBlock = (patch: Partial<TranslationBlock>) => {
    if (!selectedPage || !selectedBlock || selectedPageEditLocked) {
      return;
    }

    recordEditHistoryBeforeChange();
    updateCurrentChapter(selectedPage.id, (current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id !== selectedPage.id
          ? page
          : {
              ...page,
              updatedAt: new Date().toISOString(),
              blocks: page.blocks.map((block) => {
                if (block.id !== selectedBlock.id) {
                  return block;
                }

                const nextType = normalizeBlockType(patch.type ?? block.type);
                const nextRenderDirection = normalizeRenderDirection(patch.renderDirection ?? block.renderDirection, block.renderDirection);
                return {
                  ...block,
                  ...patch,
                  type: nextType,
                  renderDirection: nextRenderDirection,
                  rotationDeg: normalizeRotationDeg(patch.rotationDeg ?? block.rotationDeg ?? 0),
                  backgroundColor: patch.backgroundColor ?? block.backgroundColor,
                  opacity: patch.opacity ?? block.opacity,
                  bbox: patch.bbox ? clampBbox(patch.bbox) : block.bbox,
                  bboxSpace: patch.bbox ? "normalized_1000" : block.bboxSpace,
                  renderBbox: patch.renderBbox ? clampBbox(patch.renderBbox) : block.renderBbox,
                  renderBboxSpace: patch.renderBbox ? "normalized_1000" : block.renderBboxSpace
                };
              })
            }
      )
    }));
  };

  const toggleBlockInpaintExcluded = (blockId: string) => {
    if (!selectedPage || jobActive) {
      return;
    }
    recordEditHistoryBeforeChange();
    updateCurrentChapter(selectedPage.id, (current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id !== selectedPage.id
          ? page
          : {
              ...page,
              updatedAt: new Date().toISOString(),
              blocks: page.blocks.map((block) =>
                block.id === blockId ? { ...block, inpaintExcluded: !block.inpaintExcluded } : block
              )
            }
      )
    }));
  };

  const applyFontToScope = (scope: "page" | "chapter") => {
    if (!currentChapter || !selectedBlock || selectedPageEditLocked) {
      return;
    }
    const fontFamily = selectedBlock.fontFamily;
    const targetPageIds = scope === "page" ? (selectedPage ? [selectedPage.id] : []) : currentChapter.pages.map((page) => page.id);
    if (targetPageIds.length === 0) {
      return;
    }
    const targetSet = new Set(targetPageIds);
    const stamp = new Date().toISOString();
    setCurrentChapter((current) => {
      if (!current) {
        return current;
      }
      const next = {
        ...current,
        pages: current.pages.map((page) =>
          targetSet.has(page.id) ? { ...page, updatedAt: stamp, blocks: page.blocks.map((block) => ({ ...block, fontFamily })) } : page
        )
      };
      currentChapterRef.current = next;
      return next;
    });
    targetPageIds.forEach((id) => markDirty(id));
    pushStatus(scope === "page" ? "이 페이지의 모든 블록에 폰트를 적용했습니다." : "이 화 전체 블록에 폰트를 적용했습니다.");
  };

  const deleteSelectedBlock = useCallback(() => {
    if (!selectedPage || !selectedBlock || selectedPageEditLocked) {
      return;
    }
    recordEditHistoryBeforeChange({ force: true });
    updateCurrentChapter(selectedPage.id, (current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === selectedPage.id
          ? {
              ...page,
              updatedAt: new Date().toISOString(),
              blocks: page.blocks.filter((block) => block.id !== selectedBlock.id)
            }
          : page
      )
    }));
    setSelectedBlockId(null);
  }, [recordEditHistoryBeforeChange, selectedBlock, selectedPage, selectedPageEditLocked, updateCurrentChapter]);

  const duplicateSelectedBlock = useCallback(() => {
    if (!selectedPage || !selectedBlock || selectedPageEditLocked) {
      return;
    }
    recordEditHistoryBeforeChange({ force: true });
    const copy = {
      ...offsetBlockBboxes(selectedBlock, 16, 16, { width: selectedPage.width, height: selectedPage.height }),
      id: `${selectedBlock.id}-copy-${Date.now()}`
    };
    updateCurrentChapter(selectedPage.id, (current) => ({
      ...current,
      pages: current.pages.map((page) =>
        page.id === selectedPage.id
          ? {
              ...page,
              updatedAt: new Date().toISOString(),
              blocks: [...page.blocks, copy]
            }
          : page
      )
    }));
    setSelectedBlockId(copy.id);
  }, [recordEditHistoryBeforeChange, selectedBlock, selectedPage, selectedPageEditLocked, updateCurrentChapter]);

  const applyBackgroundSamples = useCallback(
    (samples: Array<{ id: string; flat: boolean; backgroundColor?: string }>, scopeLabel: string) => {
      if (!selectedPage) {
        return;
      }

      const sampleById = new Map(samples.map((sample) => [sample.id, sample]));
      const applicableIds = new Set(
        selectedPage.blocks
          .filter((block) => {
            const sample = sampleById.get(block.id);
            return Boolean(sample?.flat && sample.backgroundColor);
          })
          .map((block) => block.id)
      );
      const appliedCount = applicableIds.size;
      recordEditHistoryBeforeChange();
      updateCurrentChapter(selectedPage.id, (current) => ({
        ...current,
        pages: current.pages.map((page) =>
          page.id !== selectedPage.id
            ? page
            : {
                ...page,
                updatedAt: new Date().toISOString(),
                blocks: page.blocks.map((block) => {
                  const sample = sampleById.get(block.id);
                  if (!sample?.flat || !sample.backgroundColor) {
                    return block;
                  }
                  return {
                    ...block,
                    backgroundColor: sample.backgroundColor,
                    opacity: Math.max(block.opacity ?? 0, FLAT_BACKGROUND_OPACITY)
                  };
                })
              }
        )
      }));

      if (appliedCount > 0) {
        pushStatus(`${scopeLabel}: 단색 배경 ${appliedCount}개 블록에 적용했습니다.`);
      } else {
        pushStatus(`${scopeLabel}: 단색 배경을 찾지 못했습니다.`);
      }
    },
    [pushStatus, recordEditHistoryBeforeChange, selectedPage, updateCurrentChapter]
  );

  const sampleSelectedBlockBackground = useCallback(async () => {
    if (!selectedPage || !selectedBlock || selectedPageEditLocked || jobActive) {
      return;
    }

    try {
      const result = await window.mangaApi.sampleBlockBackgrounds({
        imagePath: selectedPage.imagePath,
        pageWidth: selectedPage.width,
        pageHeight: selectedPage.height,
        blocks: [
          {
            id: selectedBlock.id,
            bbox: resolveBlockRenderBbox(selectedBlock, { width: selectedPage.width, height: selectedPage.height })
          }
        ]
      });
      applyBackgroundSamples(result.results, "선택 블록");
    } catch (error) {
      pushStatus(`배경색 추출 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [applyBackgroundSamples, jobActive, pushStatus, selectedBlock, selectedPage, selectedPageEditLocked]);

  const samplePageBlockBackgrounds = useCallback(async () => {
    if (!selectedPage || selectedPageEditLocked || jobActive || selectedPage.blocks.length === 0) {
      return;
    }

    try {
      const result = await window.mangaApi.sampleBlockBackgrounds({
        imagePath: selectedPage.imagePath,
        pageWidth: selectedPage.width,
        pageHeight: selectedPage.height,
        blocks: selectedPage.blocks.map((block) => ({
          id: block.id,
          bbox: resolveBlockRenderBbox(block, { width: selectedPage.width, height: selectedPage.height })
        }))
      });
      applyBackgroundSamples(result.results, "현재 페이지");
    } catch (error) {
      pushStatus(`배경색 추출 실패: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [applyBackgroundSamples, jobActive, pushStatus, selectedPage, selectedPageEditLocked]);

  const getNormalizedImagePoint = useCallback((event: React.PointerEvent): { x: number; y: number } | null => {
    const stage = stageRef.current;
    if (!stage) {
      return null;
    }
    const rect = imageRef.current?.getBoundingClientRect() ?? stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - rect.left) / rect.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - rect.top) / rect.height) * 1000))
    };
  }, []);

  const getImagePixelPoint = useCallback(
    (event: React.PointerEvent): { x: number; y: number } | null => {
      const stage = stageRef.current;
      const page = selectedPage;
      if (!stage || !page) {
        return null;
      }
      const rect = imageRef.current?.getBoundingClientRect() ?? stage.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return null;
      }
      return {
        x: Math.max(0, Math.min(page.width - 1, ((event.clientX - rect.left) / rect.width) * page.width)),
        y: Math.max(0, Math.min(page.height - 1, ((event.clientY - rect.top) / rect.height) * page.height))
      };
    },
    [selectedPage]
  );

  const appendRetouchPoint = useCallback(
    (point: { x: number; y: number }, tool?: Extract<InpaintingTool, "brush" | "eraser" | "mask">) => {
      const last = lastInpaintingRetouchPointRef.current;
      const minDistance = Math.max(2, inpaintingBrushRadius * 0.2);
      if (last) {
        const dx = point.x - last.x;
        const dy = point.y - last.y;
        if (Math.sqrt(dx * dx + dy * dy) < minDistance) {
          return;
        }
      }
      lastInpaintingRetouchPointRef.current = point;
      inpaintingRetouchPointsRef.current.push({
        x: Math.round(point.x),
        y: Math.round(point.y)
      });
      if (tool) {
        const nextPoint = { x: Math.round(point.x), y: Math.round(point.y) };
        setRetouchPreview((current) => {
          if (!current || current.mode !== tool) {
            return {
              mode: tool,
              points: [nextPoint],
              radiusPx: inpaintingBrushRadius,
              color: tool === "mask" ? "#ff9f1c" : inpaintingPaintColor
            };
          }
          return {
            ...current,
            radiusPx: inpaintingBrushRadius,
            color: tool === "mask" ? "#ff9f1c" : inpaintingPaintColor,
            points: [...current.points, nextPoint].slice(-1200)
          };
        });
      }
    },
    [inpaintingBrushRadius, inpaintingPaintColor]
  );

  const saveChapterWithInpaintPath = useCallback(
    async (pageId: string, inpaintedImagePath?: string) => {
      const chapter = currentChapterRef.current;
      if (!chapter) {
        return null;
      }
      const nextChapter: ChapterSnapshot = {
        ...chapter,
        pages: chapter.pages.map((page) =>
          page.id === pageId
            ? {
                ...page,
                inpaintedImagePath,
                updatedAt: new Date().toISOString()
              }
            : page
        )
      };
      clearPageImageCache();
      setCurrentChapter(nextChapter);
      currentChapterRef.current = nextChapter;
      const result = await window.mangaApi.setPageInpaintingResult({
        chapterId: chapter.id,
        pageId,
        inpaintedImagePath: inpaintedImagePath ?? null
      });
      mergeLiveChapter(result.chapter);
      return result.chapter;
    },
    [clearPageImageCache, mergeLiveChapter]
  );

  const applyRetouchPoints = useCallback(
    async (tool: Extract<InpaintingTool, "brush" | "eraser">, points: Array<{ x: number; y: number }>) => {
      if (!currentChapter || !selectedPage || points.length === 0 || jobActive) {
        return;
      }
      const beforePath = selectedPage.inpaintedImagePath;
      try {
        const result = await window.mangaApi.applyInpaintingRetouch({
          chapterId: currentChapter.id,
          pageId: selectedPage.id,
          mode: tool === "brush" ? "paint" : "restore",
          points,
          radiusPx: inpaintingBrushRadius,
          color: inpaintingPaintColor
        });
        const afterPage = result.chapter.pages.find((page) => page.id === selectedPage.id);
        clearPageImageCache();
        mergeLiveChapter(result.chapter);
        const afterPath = afterPage?.inpaintedImagePath;
        if (afterPath !== beforePath) {
          setRetouchUndoStack((stack) => [...stack, { pageId: selectedPage.id, beforePath, afterPath }].slice(-60));
          setRetouchRedoStack([]);
        }
      } catch (error) {
        console.error(error);
        pushStatus("리터치 적용에 실패했습니다.");
      }
    },
    [clearPageImageCache, currentChapter, inpaintingBrushRadius, inpaintingPaintColor, jobActive, mergeLiveChapter, pushStatus, selectedPage]
  );

  const undoRetouch = useCallback(async () => {
    const entry = retouchUndoStackRef.current[retouchUndoStackRef.current.length - 1];
    if (!entry || jobActive) {
      return;
    }
    setRetouchUndoStack((stack) => stack.slice(0, -1));
    await saveChapterWithInpaintPath(entry.pageId, entry.beforePath);
    setRetouchRedoStack((stack) => [...stack, entry].slice(-60));
    pushStatus("리터치를 되돌렸습니다.");
  }, [jobActive, pushStatus, saveChapterWithInpaintPath]);

  const redoRetouch = useCallback(async () => {
    const entry = retouchRedoStackRef.current[retouchRedoStackRef.current.length - 1];
    if (!entry || jobActive) {
      return;
    }
    setRetouchRedoStack((stack) => stack.slice(0, -1));
    await saveChapterWithInpaintPath(entry.pageId, entry.afterPath);
    setRetouchUndoStack((stack) => [...stack, entry].slice(-60));
    pushStatus("리터치를 다시 적용했습니다.");
  }, [jobActive, pushStatus, saveChapterWithInpaintPath]);

  const revertInpainting = useCallback(
    async (scope: "page" | "chapter") => {
      if (!currentChapter || jobActive) {
        return;
      }
      if (scope === "page" && !selectedPage) {
        return;
      }
      const confirmed = await askConfirm(
        scope === "page" ? "이 페이지 원본으로 되돌리기" : "전체 페이지 원본으로 되돌리기",
        scope === "page" ? "현재 페이지의 인페인팅 결과를 원본 이미지로 되돌립니다." : "현재 화의 인페인팅 결과를 원본 이미지로 되돌립니다.",
        "번역 블록과 좌표는 유지하고, 지워진 이미지 결과만 해제합니다."
      );
      if (!confirmed) {
        return;
      }
      const result = await window.mangaApi.revertInpainting(
        scope === "page"
          ? { chapterId: currentChapter.id, scope: "page", pageId: selectedPage!.id }
          : { chapterId: currentChapter.id, scope: "chapter" }
      );
      clearPageImageCache();
      mergeLiveChapter(result.chapter);
      setRetouchUndoStack([]);
      setRetouchRedoStack([]);
      pushStatus(`인페인팅 되돌리기 완료: ${result.pagesChanged}페이지`);
    },
    [askConfirm, clearPageImageCache, currentChapter, jobActive, mergeLiveChapter, pushStatus, selectedPage]
  );

  const onBlockPointerDown = (event: React.PointerEvent, block: TranslationBlock, mode: DragMode) => {
    if (!stageRef.current || selectedPageEditLocked || regionSelection?.active || inpaintingToolActive) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    recordEditHistoryBeforeChange({ force: true });
    setSelectedBlockId(block.id);
    const pageSize = selectedPage ? { width: selectedPage.width, height: selectedPage.height } : null;
    const displayText = block.translatedText || block.sourceText || "...";
    const target = resolveEditableBlockBbox(block, pageSize, displayText);
    dragRef.current = {
      mode,
      blockId: block.id,
      startX: event.clientX,
      startY: event.clientY,
      bboxKey: target.key,
      startBbox: target.bbox
    };
    stageRef.current.setPointerCapture(event.pointerId);
  };

  const onStagePointerDown = (event: React.PointerEvent) => {
    if (inpaintingToolActive) {
      const point = getImagePixelPoint(event);
      if (!point || !stageRef.current) {
        return;
      }
      if (inpaintingTool === "brush" || inpaintingTool === "eraser" || inpaintingTool === "mask") {
        setRetouchCursorPoint(point);
      }
      event.preventDefault();
      event.stopPropagation();
      setSelectedBlockId(null);
      if (inpaintingTool === "picker") {
        const imagePath = selectedPageImagePath ?? selectedPage?.imagePath;
        if (imagePath) {
          void window.mangaApi
            .sampleInpaintingColor({ imagePath, x: point.x, y: point.y })
            .then((result) => {
              setInpaintingPaintColor(result.color);
              pushStatus(`붓 색상을 ${result.color}로 선택했습니다. 계속 다른 색을 뽑거나 붓으로 전환하세요.`);
            })
            .catch((error) => {
              console.error(error);
              pushStatus("색상을 가져오지 못했습니다.");
            });
        }
        return;
      }
      inpaintingRetouchDrawingRef.current = true;
      inpaintingRetouchPointsRef.current = [];
      lastInpaintingRetouchPointRef.current = null;
      setRetouchPreview(null);
      appendRetouchPoint(point, inpaintingTool);
      stageRef.current.setPointerCapture(event.pointerId);
      return;
    }

    if (!regionSelection?.active) {
      setSelectedBlockId(null);
      return;
    }

    const point = getNormalizedImagePoint(event);
    if (!point || !stageRef.current) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedBlockId(null);
    setRegionSelection({
      active: true,
      dragging: true,
      start: point,
      current: point
    });
    stageRef.current.setPointerCapture(event.pointerId);
  };

  const onStagePointerMove = (event: React.PointerEvent) => {
    if (inpaintingToolActive) {
      const point = getImagePixelPoint(event);
      if (point && (inpaintingTool === "brush" || inpaintingTool === "eraser" || inpaintingTool === "mask")) {
        setRetouchCursorPoint(point);
      }
      if (point && inpaintingRetouchDrawingRef.current && (inpaintingTool === "brush" || inpaintingTool === "eraser" || inpaintingTool === "mask")) {
        appendRetouchPoint(point, inpaintingTool);
      }
      return;
    }

    if (regionSelection?.active && regionSelection.dragging) {
      const point = getNormalizedImagePoint(event);
      if (point) {
        setRegionSelection((current) => (current?.active ? { ...current, current: point } : current));
      }
      return;
    }

    const drag = dragRef.current;
    const page = selectedPage;
    const stage = stageRef.current;
    if (!drag || !page || !stage || !currentChapter || selectedPageEditLocked) {
      return;
    }
    const rect = imageRef.current?.getBoundingClientRect() ?? stage.getBoundingClientRect();
    const dx = ((event.clientX - drag.startX) / Math.max(1, rect.width)) * 1000;
    const dy = ((event.clientY - drag.startY) / Math.max(1, rect.height)) * 1000;
    const next =
      drag.mode === "move"
        ? {
            ...drag.startBbox,
            x: drag.startBbox.x + dx,
            y: drag.startBbox.y + dy
          }
        : {
            ...drag.startBbox,
            w: drag.startBbox.w + dx,
            h: drag.startBbox.h + dy
          };

    updateCurrentChapter(page.id, (chapter) => ({
      ...chapter,
      pages: chapter.pages.map((candidate) =>
        candidate.id !== page.id
          ? candidate
          : {
              ...candidate,
              updatedAt: new Date().toISOString(),
              blocks: candidate.blocks.map((block) =>
                block.id === drag.blockId
                  ? applyDraggedBlockBbox(block, next, drag.bboxKey)
                  : block
              )
            }
      )
    }));
  };

  const onStagePointerUp = (event: React.PointerEvent) => {
    if (inpaintingRetouchDrawingRef.current) {
      if (stageRef.current) {
        stageRef.current.releasePointerCapture(event.pointerId);
      }
      inpaintingRetouchDrawingRef.current = false;
      lastInpaintingRetouchPointRef.current = null;
      const points = inpaintingRetouchPointsRef.current;
      inpaintingRetouchPointsRef.current = [];
      if (inpaintingTool === "brush" || inpaintingTool === "eraser") {
        void applyRetouchPoints(inpaintingTool, points);
      } else if (inpaintingTool === "mask" && points.length > 0) {
        const pageId = selectedPageIdRef.current;
        if (pageId) {
          setPatternMaskStrokesByPage((current) => ({
            ...current,
            [pageId]: [...(current[pageId] ?? []), { points, radiusPx: inpaintingBrushRadius }].slice(-200)
          }));
        }
      }
      window.setTimeout(() => setRetouchPreview(null), 180);
      return;
    }

    if (regionSelection?.active && regionSelection.dragging) {
      if (stageRef.current) {
        stageRef.current.releasePointerCapture(event.pointerId);
      }
      const bbox = regionSelectionToBbox(regionSelection);
      setRegionSelection(null);
      if (!isUsableRegionBbox(bbox, 10)) {
        pushStatus("선택 영역이 너무 작습니다.");
        return;
      }
      void translateSelectedRegion(bbox);
      return;
    }

    if (dragRef.current && stageRef.current) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const onStagePointerLeave = () => {
    if (!inpaintingRetouchDrawingRef.current) {
      setRetouchCursorPoint(null);
    }
  };

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const pageIds = currentChapterRef.current?.pages.map((page) => page.id) ?? [];
      const activeElement = typeof document !== "undefined" ? document.activeElement : null;
      const editableTarget = isEditableTarget(event.target);

      if (!modalOpen && !editableTarget) {
        if ((event.key === "Delete" || event.key === "Backspace") && selectedBlockIdRef.current && !selectedPageEditLocked && !inpaintingToolActive) {
          event.preventDefault();
          deleteSelectedBlock();
          return;
        }

        if (event.ctrlKey || event.metaKey) {
          const key = event.key.toLowerCase();
          if (inpaintingMode && inpaintingToolActive && key === "z" && !event.shiftKey) {
            event.preventDefault();
            void undoRetouch();
            return;
          }
          if (inpaintingMode && inpaintingToolActive && (key === "y" || (key === "z" && event.shiftKey))) {
            event.preventDefault();
            void redoRetouch();
            return;
          }
          if (key === "z" && !event.shiftKey) {
            event.preventDefault();
            undoChapterEdit();
            return;
          }
          if (key === "y" || (key === "z" && event.shiftKey)) {
            event.preventDefault();
            redoChapterEdit();
            return;
          }
        }
      }

      const navigation = resolveKeyboardPageNavigation({
        key: event.key,
        hasPages: pageIds.length > 0,
        modalOpen,
        editableTarget,
        centerPanelFocused: Boolean(workspacePanelRef.current && activeElement && workspacePanelRef.current.contains(activeElement))
      });

      if (!navigation) {
        return;
      }

      if (!selectAdjacentPageForReading(navigation.direction)) {
        return;
      }

      if (navigation.preventDefault) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [
    deleteSelectedBlock,
    inpaintingMode,
    inpaintingToolActive,
    modalOpen,
    redoChapterEdit,
    redoRetouch,
    selectAdjacentPageForReading,
    selectedPageEditLocked,
    undoChapterEdit,
    undoRetouch
  ]);

  const onWorkspaceWheel = useCallback(
    (event: React.WheelEvent<HTMLElement>) => {
      const pageIds = currentChapterRef.current?.pages.map((page) => page.id) ?? [];
      const direction = resolveWheelPageNavigation({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        hasPages: pageIds.length > 0,
        modalOpen,
        editableTarget: isEditableTarget(event.target)
      });

      if (!direction) {
        return;
      }

      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastWheelNavigationAtRef.current < 320) {
        event.preventDefault();
        return;
      }

      if (!selectAdjacentPageForReading(direction)) {
        return;
      }

      lastWheelNavigationAtRef.current = now;
      workspacePanelRef.current?.focus();
      event.preventDefault();
    },
    [modalOpen, selectAdjacentPageForReading]
  );

  const renameWork = useCallback((workId: string) => {
    const work = library.works.find((candidate) => candidate.id === workId);
    if (!work) {
      return;
    }
    setRenameTarget({ kind: "work", id: workId, title: work.title });
  }, [library.works]);

  const renameChapter = useCallback((chapterId: string) => {
    const chapter =
      library.works.flatMap((work) => work.chapters).find((candidate) => candidate.id === chapterId) ??
      (currentChapter ? { id: currentChapter.id, title: currentChapter.title } : null);
    if (!chapter) {
      return;
    }
    setRenameTarget({ kind: "chapter", id: chapterId, title: chapter.title });
  }, [currentChapter, library.works]);

  const submitRename = useCallback(async (title: string) => {
    if (!renameTarget) {
      return;
    }

    setRenameBusy(true);
    try {
      if (renameTarget.kind === "work") {
        setLibrary(await window.mangaApi.renameWork(renameTarget.id, title));
      } else {
        if (currentChapter?.id === renameTarget.id && dirty) {
          await saveNow();
        }
        setLibrary(await window.mangaApi.renameChapter(renameTarget.id, title));
        if (currentChapter?.id === renameTarget.id) {
          applyChapter(await window.mangaApi.openChapter(renameTarget.id));
        }
      }
      setRenameTarget(null);
    } finally {
      setRenameBusy(false);
    }
  }, [applyChapter, currentChapter, dirty, renameTarget, saveNow]);

  const deleteRenameTarget = useCallback(async () => {
    if (!renameTarget) {
      return;
    }

    const isCurrentChapter = currentChapter?.id === renameTarget.id;
    const isCurrentWork = renameTarget.kind === "work" && currentChapter?.workId === renameTarget.id;
    const confirmed = await askConfirm(
      renameTarget.kind === "work" ? "작품 삭제" : "화 삭제",
      "정말 삭제하시겠습니까?",
      renameTarget.kind === "work"
        ? `"${renameTarget.title}" 작품과 포함된 모든 화, 페이지, 번역 결과가 보관함에서 삭제됩니다.`
        : `"${renameTarget.title}" 화와 포함된 모든 페이지, 번역 결과가 보관함에서 삭제됩니다.`
    );
    if (!confirmed) {
      return;
    }

    setRenameBusy(true);
    try {
      if ((isCurrentChapter || isCurrentWork) && dirty) {
        await saveNow();
      }

      if (renameTarget.kind === "work") {
        setLibrary(await window.mangaApi.deleteWork(renameTarget.id));
        if (isCurrentWork) {
          clearCurrentChapter();
        }
        pushStatus(`${renameTarget.title} 작품을 삭제했습니다.`);
      } else {
        setLibrary(await window.mangaApi.deleteChapter(renameTarget.id));
        if (isCurrentChapter) {
          clearCurrentChapter();
        }
        pushStatus(`${renameTarget.title} 화를 삭제했습니다.`);
      }

      setRenameTarget(null);
    } catch (error) {
      console.error(error);
      pushStatus(renameTarget.kind === "work" ? "작품을 삭제하지 못했습니다." : "화를 삭제하지 못했습니다.");
    } finally {
      setRenameBusy(false);
    }
  }, [askConfirm, clearCurrentChapter, currentChapter?.id, currentChapter?.workId, dirty, pushStatus, renameTarget, saveNow]);

  const reorderChapterInLibrary = useCallback(
    (workId: string, sourceChapterId: string, targetChapterId: string) => {
      const work = library.works.find((candidate) => candidate.id === workId);
      if (!work) {
        return;
      }
      const nextOrder = reorderByTarget(work.chapterOrder, sourceChapterId, targetChapterId);
      setLibrary((current) => ({
        ...current,
        works: current.works.map((candidate) =>
          candidate.id === workId
            ? {
                ...candidate,
                chapterOrder: nextOrder,
                chapters: reorderRecordsByIdOrder(candidate.chapters, nextOrder)
              }
            : candidate
        )
      }));
      void window.mangaApi.reorderChapters(workId, nextOrder).then(setLibrary);
    },
    [library.works]
  );

  const reorderPageInChapter = useCallback(
    (sourcePageId: string, targetPageId: string) => {
      if (!currentChapter) {
        return;
      }
      const nextOrder = reorderByTarget(currentChapter.pageOrder, sourcePageId, targetPageId);
      setCurrentChapter((chapter) => {
        if (!chapter || chapter.id !== currentChapter.id) {
          return chapter;
        }
        const nextChapter = {
          ...chapter,
          pageOrder: nextOrder,
          pages: reorderRecordsByIdOrder(chapter.pages, nextOrder)
        };
        currentChapterRef.current = nextChapter;
        return nextChapter;
      });
      void window.mangaApi.reorderPages(currentChapter.id, nextOrder).then((chapter) => {
        applyChapter(chapter);
        void refreshLibrary();
      });
    },
    [applyChapter, currentChapter, refreshLibrary]
  );

  const inpaintingContextValue: InpaintingContextValue = {
    currentChapter,
    selectedPage,
    blockCounts,
    inpaintedPageCount,
    tool: inpaintingTool,
    brushRadius: inpaintingBrushRadius,
    brushColor: inpaintingPaintColor,
    maskStrokeCount: patternMaskStrokes.length,
    canUndo: retouchUndoStack.length > 0,
    canRedo: retouchRedoStack.length > 0,
    jobState,
    progressSnapshot,
    showBlockChrome,
    showTextBlocks,
    jobActive,
    peekAvailable,
    peeking: showingOriginalPeek,
    onSelectTool: setInpaintingTool,
    onBrushRadiusChange: setInpaintingBrushRadius,
    onBrushColorChange: setInpaintingPaintColor,
    onUndoRetouch: () => void undoRetouch(),
    onRedoRetouch: () => void redoRetouch(),
    onRevertPage: () => void revertInpainting("page"),
    onRevertChapter: () => void revertInpainting("chapter"),
    onRunPage: () => void runInpainting("page"),
    onRunChapter: () => void runInpainting("chapter"),
    onRunDrawnPattern: () => void runDrawnPatternInpainting(),
    onClearPatternMask: () => {
      if (!selectedPage) {
        return;
      }
      setPatternMaskStrokesByPage((current) => {
        const next = { ...current };
        delete next[selectedPage.id];
        return next;
      });
    },
    onShowGuide: () => setInpaintingGuideOpen(true),
    onPeekToggle: () => setPeekOriginal((value) => !value),
    onToggleChrome: () => setShowBlockChrome((value) => !value),
    onToggleBlocks: () => setShowTextBlocks((value) => !value),
    onExportResults: (scope) => void exportInpaintingResults(scope),
    onCancelJob: () => void window.mangaApi.cancelJob()
  };

  return (
    <FontsProvider>
    <main className={`app-shell ${inpaintingMode ? "inpainting-mode" : ""}`}>
      <AppSidebar
        inpaintingMode={inpaintingMode}
        currentChapter={currentChapter}
        selectedPageId={selectedPage?.id ?? null}
        library={library}
        jobActive={jobActive}
        settingsBusy={settingsBusy}
        settingsOpen={settingsOpen}
        onExitInpainting={exitInpaintingMode}
        onOpenTranslationSource={() => setTranslationSourceOpen(true)}
        onOpenWebBrowse={() => setWebBrowseOpen(true)}
        onOpenBatchImport={() => void openImportPreview("zip-folder")}
        onOpenSettings={() => void openSettings()}
        onOpenLibraryFolder={() => void window.mangaApi.openLibraryFolder()}
        onOpenShareExport={() => setShareExportOpen(true)}
        onOpenShareImport={() => void openShareImportPreview()}
        onOpenChapter={(chapterId) => void openChapter(chapterId)}
        onRenameWork={(workId) => void renameWork(workId)}
        onRenameChapter={(chapterId) => void renameChapter(chapterId)}
        onReorderChapter={reorderChapterInLibrary}
        onSelectPage={selectPageForReading}
        onRetranslatePage={(pageId) => void retranslatePage(pageId)}
        onDownloadPage={(pageId) => void exportPageImages([pageId])}
        onRemovePage={(pageId) => void removePage(pageId)}
        onReorderPage={reorderPageInChapter}
        pageDownloadSelectionMode={pageDownloadSelectionMode}
        selectedDownloadPageIds={selectedDownloadPageIds}
        onDownloadAllPages={() => void exportPageImages(currentChapter?.pages.map((page) => page.id) ?? [])}
        onStartPageDownloadSelection={startPageDownloadSelection}
        onDownloadSelectedPages={downloadSelectedPages}
        onCancelPageDownloadSelection={() => setPageDownloadSelectionMode(false)}
        onTogglePageDownloadSelection={togglePageDownloadSelection}
      />

      <AppWorkspace
        workspacePanelRef={workspacePanelRef}
        webBrowserHostRef={webBrowserHostRef}
        webModeActive={webModeActive}
        webSessionTitle={webSession?.title || webSession?.url}
        webBrowserCollapsed={webBrowserCollapsed}
        webOverlaySelectionEnabled={webOverlaySelectionEnabled}
        webCaptureBusy={webCaptureBusy}
        webTranslateAfterCapture={webTranslateAfterCapture}
        selectedPage={selectedPage}
        selectedPageImageDataUrl={workspaceImageDataUrl}
        imageRef={imageRef}
        stageRef={stageRef}
        stageSize={stageSize}
        selectedBlockId={selectedBlockId}
        showTextBlocks={showTextBlocks}
        showBlockChrome={showBlockChrome}
        inpaintingMode={inpaintingMode}
        showingOriginalPeek={showingOriginalPeek}
        inpaintingToolActive={inpaintingToolActive}
        retouchCursor={retouchCursor}
        retouchPreviewLayer={retouchPreviewLayer}
        maskStrokes={inpaintingMode ? patternMaskStrokes : []}
        regionSelectionActive={Boolean(regionSelection?.active)}
        regionSelectionRect={regionSelectionRect}
        jobState={jobState}
        progressSnapshot={progressSnapshot}
        onWorkspaceWheel={onWorkspaceWheel}
        fileDropActive={fileDropActive}
        onWorkspaceDragEnter={onWorkspaceDragEnter}
        onWorkspaceDragOver={onWorkspaceDragOver}
        onWorkspaceDragLeave={onWorkspaceDragLeave}
        onWorkspaceDrop={onWorkspaceDrop}
        onStagePointerMove={onStagePointerMove}
        onStagePointerUp={onStagePointerUp}
        onStagePointerDown={onStagePointerDown}
        onStagePointerLeave={onStagePointerLeave}
        onBlockPointerDown={onBlockPointerDown}
        onToggleBlockExcluded={toggleBlockInpaintExcluded}
        onOpenTranslationSource={() => setTranslationSourceOpen(true)}
        onCaptureWebSegment={() => void captureWebSegment()}
        onReloadWebBrowse={() => void reloadWebBrowser()}
        onReapplyWebTranslationOverlay={() => void reapplyWebTranslationOverlay()}
        onCloseWebBrowse={() => void closeWebBrowse()}
        onToggleWebBrowserCollapsed={toggleWebBrowserCollapsed}
        onToggleWebOverlaySelection={toggleWebOverlaySelection}
        onToggleWebTranslateAfterCapture={setWebTranslateAfterCapture}
        onOpenBatchImport={() => void openImportPreview("zip-folder")}
        onOpenShareImport={() => void openShareImportPreview()}
      />

      <InpaintingProvider value={inpaintingContextValue}>
        <AppRightRail
          inpaintingMode={inpaintingMode}
          currentChapter={currentChapter}
          selectedPage={selectedPage}
          selectedBlock={selectedBlock}
          selectedPageImageDataUrl={selectedPageImageDataUrl}
          selectedPageEditLocked={selectedPageEditLocked}
          jobState={jobState}
          progressSnapshot={progressSnapshot}
          showProgressBar={showProgressBar}
          showBlockChrome={showBlockChrome}
          showTextBlocks={showTextBlocks}
          jobActive={jobActive}
          statusLines={statusLines}
          areaTranslateSelecting={Boolean(regionSelection?.active)}
          onToggleChrome={() => setShowBlockChrome((value) => !value)}
          onToggleBlocks={() => setShowTextBlocks((value) => !value)}
          onRunPending={() => void runAnalysis("pending")}
          onRunAll={() => void runAnalysis("all")}
          onEnterInpainting={() => void enterInpaintingMode()}
          onWebTranslateCurrent={() => void translateCurrentWebScreen()}
          onWebTranslateFullPage={() => void translateFullWebPage()}
          onWebTranslateRegion={() => void startWebRegionTranslation()}
          webSessionActive={webModeActive}
          onCancelJob={() => void window.mangaApi.cancelJob()}
          onStartAreaTranslate={startRegionTranslationSelection}
          onSampleBlockBackground={() => void sampleSelectedBlockBackground()}
          onSamplePageBackgrounds={() => void samplePageBlockBackgrounds()}
          onApplyFont={applyFontToScope}
          onUpdateBlock={updateSelectedBlock}
          onDeleteBlock={deleteSelectedBlock}
          onDuplicateBlock={duplicateSelectedBlock}
        />
      </InpaintingProvider>

      <AppModals
        library={library}
        currentWorkId={currentChapter?.workId ?? null}
        translationSourceOpen={translationSourceOpen}
        importPreview={importPreview}
        importBusy={importBusy}
        shareExportOpen={shareExportOpen}
        shareExportBusy={shareExportBusy}
        shareImportPreview={shareImportPreview}
        shareImportBusy={shareImportBusy}
        renameTarget={renameTarget}
        renameBusy={renameBusy}
        settingsOpen={settingsOpen}
        settings={settings}
        settingsBusy={settingsBusy}
        jobActive={jobActive}
        confirmDialog={confirmDialog}
        inpaintingGuideOpen={inpaintingGuideOpen}
        onCancelTranslationSource={() => setTranslationSourceOpen(false)}
        onSelectTranslationSource={(mode) => void selectTranslateSource(mode)}
        onCancelImport={() => setImportPreview(null)}
        onSubmitImport={(payload) => void submitImport(payload)}
        onCancelShareExport={() => {
          if (!shareExportBusy) {
            setShareExportOpen(false);
          }
        }}
        onSubmitShareExport={(request) => void submitShareExport(request)}
        onCancelShareImport={() => {
          if (!shareImportBusy) {
            setShareImportPreview(null);
          }
        }}
        onSubmitShareImport={(payload) => void submitShareImport(payload)}
        onCancelRename={() => {
          if (!renameBusy) {
            setRenameTarget(null);
          }
        }}
        onDeleteRename={() => void deleteRenameTarget()}
        onSubmitRename={(title) => void submitRename(title)}
        onCancelSettings={closeSettings}
        onOpenLogFolder={() => {
          void window.mangaApi.openLogFolder();
        }}
        onResetSettings={() => void resetSettings()}
        onSubmitSettings={(nextSettings) => void submitSettings(nextSettings)}
        onResolveConfirm={resolveConfirmDialog}
        onCloseInpaintingGuide={(hideNextTime) => {
          if (hideNextTime) {
            window.localStorage.setItem(INPAINTING_GUIDE_HIDDEN_KEY, "1");
            setHideInpaintingGuide(true);
          }
          setInpaintingGuideOpen(false);
        }}
      />
      {webBrowseOpen ? (
        <WebBrowseModal
          library={library}
          busy={webBrowseBusy}
          onCancel={() => setWebBrowseOpen(false)}
          onSubmit={(request) => void openWebBrowse(request)}
        />
      ) : null}
    </main>
    </FontsProvider>
  );
}

function hasDraggedFiles(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) {
    return false;
  }
  return Array.from(dataTransfer.types).includes("Files");
}

function countChapterBlocks(chapter: ChapterSnapshot | null, selectedPageId: string | null): BlockCounts {
  if (!chapter) {
    return { total: 0, selectedPage: 0, pendingTotal: 0, pendingPages: 0 };
  }
  return chapter.pages.reduce<BlockCounts>(
    (counts, page) => {
      const targetBlocks = page.blocks.filter((block) => !block.inpaintExcluded).length;
      counts.total += targetBlocks;
      if (page.id === selectedPageId) {
        counts.selectedPage = targetBlocks;
      }
      if (!page.inpaintedImagePath && targetBlocks > 0) {
        counts.pendingPages += 1;
        counts.pendingTotal += targetBlocks;
      }
      return counts;
    },
    { total: 0, selectedPage: 0, pendingTotal: 0, pendingPages: 0 }
  );
}

