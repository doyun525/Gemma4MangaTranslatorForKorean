import type { ChapterSnapshot, RunMode } from "../../../shared/types";
import { formatStoredTimestamp } from "../../../shared/storedTimestamp";

type ChapterSelection = {
  selectedPageId: string | null;
  selectedBlockId: string | null;
};

export type LiveChapterMergeResult = {
  chapter: ChapterSnapshot;
  preservedDirtyPageIds: string[];
};

export function resolveSelectionAfterChapterSync(
  chapter: ChapterSnapshot,
  selectedPageId: string | null,
  selectedBlockId: string | null
): ChapterSelection {
  const nextSelectedPageId = chapter.pages.some((page) => page.id === selectedPageId) ? selectedPageId : chapter.pages[0]?.id ?? null;
  const nextSelectedPage = chapter.pages.find((page) => page.id === nextSelectedPageId) ?? null;
  const nextSelectedBlockId =
    nextSelectedPage && nextSelectedPage.blocks.some((block) => block.id === selectedBlockId) ? selectedBlockId : null;

  return {
    selectedPageId: nextSelectedPageId,
    selectedBlockId: nextSelectedBlockId
  };
}

export function mergeLiveChapterPreservingDirtyPages(
  liveChapter: ChapterSnapshot,
  localChapter: ChapterSnapshot | null,
  dirtyPageIds: Iterable<string>
): LiveChapterMergeResult {
  if (!localChapter || localChapter.id !== liveChapter.id) {
    return {
      chapter: liveChapter,
      preservedDirtyPageIds: []
    };
  }

  const dirtyPageIdSet = new Set(dirtyPageIds);
  const localPages = new Map(localChapter.pages.map((page) => [page.id, page]));
  const preservedDirtyPageIds: string[] = [];

  return {
    chapter: {
      ...liveChapter,
      pages: liveChapter.pages.map((page) => {
        const localPage = localPages.get(page.id);
        if (!localPage) {
          return page;
        }

        const localUpdatedAt = Date.parse(localPage.updatedAt ?? "");
        const liveUpdatedAt = Date.parse(page.updatedAt ?? "");
        const localIsNewer =
          Number.isFinite(localUpdatedAt) &&
          Number.isFinite(liveUpdatedAt) &&
          localUpdatedAt > liveUpdatedAt;
        if (!dirtyPageIdSet.has(page.id) && !localIsNewer) {
          return page;
        }

        preservedDirtyPageIds.push(page.id);
        return {
          ...localPage,
          inpaintedImagePath: page.inpaintedImagePath,
          analysisStatus: page.analysisStatus,
          lastError: page.lastError,
          updatedAt: page.updatedAt
        };
      })
    },
    preservedDirtyPageIds
  };
}

export function markChapterPagesRunning(chapter: ChapterSnapshot, runMode: RunMode, pageId?: string): ChapterSnapshot {
  const targetPageIds =
    runMode === "all"
      ? new Set(chapter.pages.map((page) => page.id))
      : runMode === "single-page"
        ? new Set(pageId ? [pageId] : [])
        : new Set(chapter.pages.filter((page) => page.analysisStatus !== "completed").map((page) => page.id));

  if (targetPageIds.size === 0) {
    return chapter;
  }

  const now = formatStoredTimestamp();
  return {
    ...chapter,
    status: "running",
    updatedAt: now,
    pages: chapter.pages.map((page) =>
      targetPageIds.has(page.id)
        ? {
            ...page,
            analysisStatus: "running",
            lastError: undefined,
            updatedAt: now
          }
        : page
    )
  };
}
