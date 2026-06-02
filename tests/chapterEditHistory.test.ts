import { describe, expect, it } from "vitest";
import type { ChapterSnapshot } from "../src/shared/types";

function cloneChapter(chapter: ChapterSnapshot): ChapterSnapshot {
  return JSON.parse(JSON.stringify(chapter)) as ChapterSnapshot;
}

function createChapter(blockText: string): ChapterSnapshot {
  return {
    id: "chapter-1",
    workId: "work-1",
    title: "1화",
    status: "idle",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [
      {
        id: "page-1",
        name: "001",
        imagePath: "C:/page.png",
        dataUrl: "",
        width: 1000,
        height: 1400,
        blocks: [
          {
            id: "block-1",
            type: "nonsolid",
            bbox: { x: 100, y: 100, w: 200, h: 120 },
            sourceText: blockText,
            translatedText: blockText,
            confidence: 1,
            sourceDirection: "horizontal",
            renderDirection: "horizontal",
            fontSizePx: 24,
            lineHeight: 1.18,
            textAlign: "center",
            textColor: "#111111",
            backgroundColor: "#ffffff",
            opacity: 1
          }
        ],
        analysisStatus: "completed",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ]
  };
}

describe("chapter edit history flow", () => {
  it("restores a deleted block with undo", () => {
    const original = createChapter("before");
    const current = cloneChapter(original);
    current.pages[0].blocks = [];

    const undoEntry = {
      chapter: cloneChapter(original),
      selectedPageId: "page-1",
      selectedBlockId: "block-1"
    };

    expect(current.pages[0].blocks).toHaveLength(0);
    expect(undoEntry.chapter.pages[0].blocks).toHaveLength(1);
    expect(undoEntry.chapter.pages[0].blocks[0]?.translatedText).toBe("before");
  });
});
