import { ipcMain } from "electron";
import {
  CaptureWebSegmentRequestSchema,
  OpenWebBrowseRequestSchema,
  ScrollWebBrowserRequestSchema,
  SetWebAutoTranslateRequestSchema,
  SyncWebBrowserBoundsRequestSchema,
  WebSessionIdRequestSchema,
  parseIpcPayload
} from "../../shared/ipcSchemas";
import type { CaptureWebSegmentResult, OpenWebBrowseResult, WebBrowseState } from "../../shared/types";
import type { IpcContext } from "./context";

export function registerWebBrowseIpc(context: IpcContext): void {
  ipcMain.handle("web:open", async (_event, raw: unknown): Promise<OpenWebBrowseResult> => {
    const request = parseIpcPayload(OpenWebBrowseRequestSchema, raw, "웹 페이지 열기");
    const result = await context.webBrowser.open(request);
    context.translationWarmup.start("web-open");
    return result;
  });

  ipcMain.handle("web:close", async (_event, raw: unknown): Promise<{ closed: boolean }> => {
    const request = parseIpcPayload(WebSessionIdRequestSchema, raw, "웹 페이지 닫기");
    context.webBrowser.close(request.sessionId);
    return { closed: true };
  });

  ipcMain.handle("web:capture-segment", async (_event, raw: unknown): Promise<CaptureWebSegmentResult> => {
    const request = parseIpcPayload(CaptureWebSegmentRequestSchema, raw, "웹 페이지 캡처");
    return context.webBrowser.captureSegment(request.sessionId, request.captureMode || "viewport");
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

  ipcMain.handle("web:get-state", async (_event, raw: unknown): Promise<WebBrowseState> => {
    const request = parseIpcPayload(WebSessionIdRequestSchema, raw, "웹 브라우저 상태");
    return context.webBrowser.getState(request.sessionId);
  });
}
