import { dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { PageImageExportRequestSchema, parseIpcPayload } from "../../shared/ipcSchemas";
import type { JobEvent, MangaPage, PageImageExportResult } from "../../shared/types";
import { openChapter } from "../library";
import { AdmZip } from "../libraryStore/zipSafety";
import { logError } from "../logger";
import { renderPageWithTranslationBlocksForExport, sanitizeOutputBaseName } from "../pageExport";
import { emitJobEvent } from "./jobEvents";
import type { IpcContext } from "./context";

export function registerPageExportIpc(context: IpcContext): void {
  ipcMain.handle("page-export:images", async (_event, rawRequest: unknown): Promise<PageImageExportResult | null> => {
    const request = parseIpcPayload(PageImageExportRequestSchema, rawRequest, "번역 이미지 다운로드");
    if (context.jobs.hasActive) {
      throw new Error("이미 실행 중인 작업이 있습니다.");
    }

    const chapter = await openChapter(request.chapterId);
    const pages = resolveExportPages(chapter.pages, request.scope === "page" ? [request.pageId] : request.pageIds);
    if (!pages.length) {
      throw new Error("다운로드할 페이지가 없습니다.");
    }

    const saveOptions =
      request.scope === "page"
        ? {
            title: "번역 이미지 저장",
            defaultPath: `${sanitizeOutputBaseName(pages[0]!.name)}-translated.png`,
            filters: [{ name: "PNG 이미지", extensions: ["png"] }]
          }
        : {
            title: "번역 이미지 ZIP 저장",
            defaultPath: `${sanitizeOutputBaseName(chapter.title)} (korean_ai).zip`,
            filters: [{ name: "ZIP 압축 파일", extensions: ["zip"] }]
          };
    const mainWindow = context.getMainWindow();
    const saveResult = mainWindow ? await dialog.showSaveDialog(mainWindow, saveOptions) : await dialog.showSaveDialog(saveOptions);

    if (saveResult.canceled || !saveResult.filePath) {
      return null;
    }

    const id = randomUUID();
    const abortController = new AbortController();
    context.jobs.start({ id, kind: "inpainting", abortController });
    const emit = (event: JobEvent) => emitJobEvent(context.jobs, context.getMainWindow(), event);

    try {
      emit({
        id,
        kind: "inpainting",
        status: "starting",
        progressText: "번역 이미지 다운로드 준비 중",
        phase: "finalizing",
        progressCurrent: 0,
        progressTotal: pages.length,
        pageTotal: pages.length,
        detail: pages.length === 1 ? pages[0]!.name : `${pages.length}페이지`
      });

      if (request.scope === "page") {
        const png = await renderExportPage(context, pages[0]!, request.options, id, emit, 0, pages.length, abortController.signal);
        await writeFile(saveResult.filePath, png);
      } else {
        const zip = new AdmZip();
        for (const [index, page] of pages.entries()) {
          const png = await renderExportPage(context, page, request.options, id, emit, index, pages.length, abortController.signal);
          const entryName = `${String(index + 1).padStart(3, "0")}-${sanitizeOutputBaseName(page.name)}.png`;
          zip.addFile(entryName, png);
        }
        zip.writeZip(saveResult.filePath);
      }

      emit({
        id,
        kind: "inpainting",
        status: "completed",
        progressText: "번역 이미지 다운로드 완료",
        phase: "done",
        progressCurrent: pages.length,
        progressTotal: pages.length,
        pageTotal: pages.length,
        detail: saveResult.filePath
      });

      return {
        outputPath: saveResult.filePath,
        pageCount: pages.length
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError("Page image export failed", { request, error });
      emit({
        id,
        kind: "inpainting",
        status: "failed",
        progressText: "번역 이미지 다운로드 실패",
        phase: "failed",
        detail: message
      });
      throw error;
    } finally {
      context.jobs.clearIfCurrent(id);
    }
  });
}

function resolveExportPages(pages: MangaPage[], pageIds: string[]): MangaPage[] {
  const requested = new Set(pageIds);
  return pages.filter((page) => requested.has(page.id));
}

async function renderExportPage(
  context: IpcContext,
  page: MangaPage,
  options: { showTextBlocks: boolean; showBlockChrome: boolean },
  jobId: string,
  emit: (event: JobEvent) => void,
  index: number,
  total: number,
  signal: AbortSignal
): Promise<Buffer> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  emit({
    id: jobId,
    kind: "inpainting",
    status: "running",
    progressText: `${index + 1} / ${total} 페이지 이미지 생성 중`,
    phase: "finalizing",
    progressCurrent: index,
    progressTotal: total,
    pageIndex: index + 1,
    pageTotal: total,
    detail: page.name
  });
  const png = await renderPageWithTranslationBlocksForExport(page, {
    dataRoot: context.appPaths.dataRoot,
    decodeFallback: context.decodeImage,
    showTextBlocks: options.showTextBlocks,
    showBlockChrome: options.showBlockChrome
  });
  emit({
    id: jobId,
    kind: "inpainting",
    status: "running",
    progressText: `${index + 1} / ${total} 페이지 이미지 생성 완료`,
    phase: "finalizing",
    progressCurrent: index + 1,
    progressTotal: total,
    pageIndex: index + 1,
    pageTotal: total,
    detail: page.name
  });
  return png;
}
