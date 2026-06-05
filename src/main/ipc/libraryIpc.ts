import { ipcMain, shell } from "electron";
import {
  DeleteChapterRequestSchema,
  DeletePageRequestSchema,
  DeleteWorkRequestSchema,
  ImageDataUrlRequestSchema,
  OpenChapterRequestSchema,
  RenameChapterRequestSchema,
  RenameWorkRequestSchema,
  ReorderChaptersRequestSchema,
  ReorderPagesRequestSchema,
  SampleBlockBackgroundsRequestSchema,
  SavePageBlocksRequestSchema,
  SaveChapterSnapshotSchema,
  parseIpcPayload
} from "../../shared/ipcSchemas";
import {
  deleteChapter,
  deletePage,
  deleteWork,
  getLibraryRoot,
  listLibrary,
  openChapter,
  renameChapter,
  renameWork,
  reorderChapters,
  reorderPages,
  savePageBlocks,
  saveChapterSnapshot
} from "../library";
import { sampleBlockBackgrounds } from "../pipeline/blockBackground";
import { createLibraryImageUrl } from "../imageProtocol";
import { logInfo } from "../logger";
import type { IpcContext } from "./context";

export function registerLibraryIpc(context: IpcContext): void {
  ipcMain.handle("library:get-index", async () => listLibrary());
  ipcMain.handle("library:open-folder", async () => {
    const error = await shell.openPath(getLibraryRoot());
    return { opened: !error, libraryPath: getLibraryRoot(), ...(error ? { error } : {}) };
  });
  ipcMain.handle("library:open-chapter", async (_event, chapterId: unknown) => {
    const request = parseIpcPayload(OpenChapterRequestSchema, { chapterId }, "화 열기");
    return openChapter(request.chapterId);
  });
  ipcMain.handle("library:get-page-image-data-url", async (_event, imagePath: unknown) => {
    const request = parseIpcPayload(ImageDataUrlRequestSchema, { imagePath }, "페이지 이미지 열기");
    return createLibraryImageUrl(request.imagePath);
  });
  ipcMain.handle("library:save-chapter", async (_event, chapter: unknown) => saveChapterSnapshot(parseIpcPayload(SaveChapterSnapshotSchema, chapter, "화 저장")));
  ipcMain.handle("library:save-page-blocks", async (_event, raw: unknown) =>
    savePageBlocks(parseIpcPayload(SavePageBlocksRequestSchema, raw, "페이지 블록 저장"))
  );
  ipcMain.handle("library:sample-block-backgrounds", async (_event, raw: unknown) => {
    const request = parseIpcPayload(SampleBlockBackgroundsRequestSchema, raw, "블록 배경색 샘플");
    logInfo("Block background sample IPC received", {
      imagePath: request.imagePath,
      pageWidth: request.pageWidth,
      pageHeight: request.pageHeight,
      blockCount: request.blocks.length,
      blocks: request.blocks.slice(0, 5)
    });
    const results = await sampleBlockBackgrounds(request.imagePath, request.pageWidth, request.pageHeight, request.blocks, context.decodeImage);
    return { results };
  });
  ipcMain.handle("library:rename-work", async (_event, workId: unknown, title: unknown) => {
    const request = parseIpcPayload(RenameWorkRequestSchema, { workId, title }, "작품 이름 변경");
    return renameWork(request.workId, request.title);
  });
  ipcMain.handle("library:rename-chapter", async (_event, chapterId: unknown, title: unknown) => {
    const request = parseIpcPayload(RenameChapterRequestSchema, { chapterId, title }, "화 이름 변경");
    return renameChapter(request.chapterId, request.title);
  });
  ipcMain.handle("library:delete-work", async (_event, workId: unknown) => {
    const request = parseIpcPayload(DeleteWorkRequestSchema, { workId }, "작품 삭제");
    return deleteWork(request.workId);
  });
  ipcMain.handle("library:delete-chapter", async (_event, chapterId: unknown) => {
    const request = parseIpcPayload(DeleteChapterRequestSchema, { chapterId }, "화 삭제");
    return deleteChapter(request.chapterId);
  });
  ipcMain.handle("library:reorder-chapters", async (_event, workId: unknown, chapterIds: unknown) => {
    const request = parseIpcPayload(ReorderChaptersRequestSchema, { workId, chapterIds }, "화 순서 변경");
    return reorderChapters(request.workId, request.chapterIds);
  });
  ipcMain.handle("library:reorder-pages", async (_event, chapterId: unknown, pageIds: unknown) => {
    const request = parseIpcPayload(ReorderPagesRequestSchema, { chapterId, pageIds }, "페이지 순서 변경");
    return reorderPages(request.chapterId, request.pageIds);
  });
  ipcMain.handle("library:delete-page", async (_event, chapterId: unknown, pageId: unknown) => {
    const request = parseIpcPayload(DeletePageRequestSchema, { chapterId, pageId }, "페이지 삭제");
    return deletePage(request.chapterId, request.pageId);
  });
}
