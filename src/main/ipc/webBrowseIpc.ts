import { ipcMain } from "electron";
import {
  CaptureWebSegmentRequestSchema,
  OpenWebBrowseRequestSchema,
  ReopenWebChapterRequestSchema,
  RenderWebOverlayRequestSchema,
  ScrollWebBrowserRequestSchema,
  SelectWebRegionRequestSchema,
  SetWebAutoTranslateRequestSchema,
  SetWebOverlayInteractionRequestSchema,
  SyncWebBrowserBoundsRequestSchema,
  WebSessionIdRequestSchema,
  parseIpcPayload
} from "../../shared/ipcSchemas";
import type { CaptureWebSegmentResult, OpenWebBrowseResult, SelectWebRegionResult, WebBrowseState } from "../../shared/types";
import type { IpcContext } from "./context";

export function registerWebBrowseIpc(context: IpcContext): void {
  ipcMain.handle("web:open", async (_event, raw: unknown): Promise<OpenWebBrowseResult> => {
    const request = parseIpcPayload(OpenWebBrowseRequestSchema, raw, "웹 페이지 열기");
    const result = await context.webBrowser.open(request);
    context.translationWarmup.startDelayed("web-open");
    return result;
  });

  ipcMain.handle("web:reopen-chapter", async (_event, raw: unknown): Promise<OpenWebBrowseResult> => {
    const request = parseIpcPayload(ReopenWebChapterRequestSchema, raw, "웹 화 다시 열기");
    const result = await context.webBrowser.reopenChapter(request);
    context.translationWarmup.startDelayed("web-reopen");
    return result;
  });

  ipcMain.handle("web:close", async (_event, raw: unknown): Promise<{ closed: boolean }> => {
    const request = parseIpcPayload(WebSessionIdRequestSchema, raw, "웹 페이지 닫기");
    context.webBrowser.close(request.sessionId);
    if (!context.webBrowser.hasActiveSessions()) {
      await context.translationWarmup.stop();
    }
    return { closed: true };
  });

  ipcMain.handle("web:capture-segment", async (_event, raw: unknown): Promise<CaptureWebSegmentResult> => {
    const request = parseIpcPayload(CaptureWebSegmentRequestSchema, raw, "웹 페이지 캡처");
    return context.webBrowser.captureSegment(request.sessionId, request.captureMode || "viewport");
  });

  ipcMain.handle("web:select-region", async (_event, raw: unknown): Promise<SelectWebRegionResult> => {
    const request = parseIpcPayload(SelectWebRegionRequestSchema, raw, "웹 영역 선택");
    return context.webBrowser.selectRegion(request.sessionId);
  });

  ipcMain.handle("web:render-overlay", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(RenderWebOverlayRequestSchema, raw, "웹 번역 오버레이");
    return context.webBrowser.renderOverlay(request.sessionId, request.page, request.blocks);
  });

  ipcMain.handle("web:set-overlay-interaction", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(SetWebOverlayInteractionRequestSchema, raw, "웹 번역 오버레이 선택 설정");
    return context.webBrowser.setOverlayInteraction(request.sessionId, request.enabled);
  });

  ipcMain.handle("web:sync-bounds", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(SyncWebBrowserBoundsRequestSchema, raw, "웹 브라우저 위치 동기화");
    return context.webBrowser.setBounds(request.sessionId, request.bounds);
  });

  ipcMain.handle("web:set-auto-translate", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(SetWebAutoTranslateRequestSchema, raw, "웹 자동 번역 설정");
    return context.webBrowser.setAutoTranslate(request.sessionId, request.enabled);
  });

  ipcMain.handle("web:scroll", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(ScrollWebBrowserRequestSchema, raw, "웹 스크롤");
    return context.webBrowser.scroll(request.sessionId, request.deltaY);
  });

  ipcMain.handle("web:reload", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(WebSessionIdRequestSchema, raw, "웹 페이지 새로고침");
    return context.webBrowser.reload(request.sessionId);
  });

  ipcMain.handle("web:get-state", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(WebSessionIdRequestSchema, raw, "웹 브라우저 상태");
    return context.webBrowser.getState(request.sessionId);
  });
}
