import { describe, expect, it } from "vitest";
import {
  ChapterSnapshotSchema,
  OpenWebBrowseRequestSchema,
  parseIpcPayload,
  SaveChapterSnapshotSchema,
  SavePageBlocksRequestSchema,
  StartAnalysisRequestSchema,
  WorkShareImportRequestSchema
} from "../src/shared/ipcSchemas";

const workId = "11111111-1111-4111-8111-111111111111";
const chapterId = "22222222-2222-4222-8222-222222222222";
const pageId = "33333333-3333-4333-8333-333333333333";

describe("IPC schemas", () => {
  it("rejects forged ids before IPC handlers reach filesystem paths", () => {
    expect(() =>
      parseIpcPayload(StartAnalysisRequestSchema, { chapterId: "../outside", runMode: "all" }, "번역 작업")
    ).toThrow(/요청 형식/);
  });

  it("rejects unknown fields in full chapter snapshots", () => {
    const payload = makeChapterSnapshot();
    expect(() =>
      parseIpcPayload(
        ChapterSnapshotSchema,
        {
          ...payload,
          pages: [
            {
              ...payload.pages[0],
              unexpected: "renderer should not be able to persist this"
            }
          ]
        },
        "화 저장"
      )
    ).toThrow(/요청 형식/);
  });

  it("accepts a valid share import command but keeps package ids bounded strings", () => {
    const parsed = parseIpcPayload(
      WorkShareImportRequestSchema,
      {
        previewId: "44444444-4444-4444-8444-444444444444",
        target: { mode: "existing", workId },
        entries: [{ source: "package", packageChapterId: "chapter-in-package", title: "1화" }]
      },
      "공유 파일 가져오기"
    );
    expect(parsed.entries[0]?.source).toBe("package");
  });

  it("rejects file paths in share import commands after preview sessions are created", () => {
    expect(() =>
      parseIpcPayload(
        WorkShareImportRequestSchema,
        {
          previewId: "44444444-4444-4444-8444-444444444444",
          packagePath: "C:\\temp\\sample.mgtshare",
          target: { mode: "existing", workId },
          entries: []
        },
        "공유 파일 가져오기"
      )
    ).toThrow(/요청 형식/);
  });

  it("rejects oversized save data urls", () => {
    const payload = makeChapterSnapshot();
    expect(() =>
      parseIpcPayload(
        SaveChapterSnapshotSchema,
        {
          ...payload,
          pages: [{ ...payload.pages[0], dataUrl: "data:image/png;base64,AAAA" }]
        },
        "화 저장"
      )
    ).toThrow(/요청 형식/);
  });

  it("accepts page block saves with outline width", () => {
    const payload = makeChapterSnapshot();
    const parsed = parseIpcPayload(
      SavePageBlocksRequestSchema,
      {
        chapterId,
        pageId,
        blocks: [
          {
            ...payload.pages[0].blocks[0],
            outlineColor: "#ffffff",
            outlineWidthPx: 1.4
          }
        ]
      },
      "페이지 블록 저장"
    );
    expect(parsed.blocks[0]?.outlineWidthPx).toBe(1.4);
  });

  it("accepts web chapter metadata round-trips through strict chapter schemas", () => {
    const payload = {
      ...makeChapterSnapshot(),
      sourceKind: "web",
      webOrigin: {
        startUrl: "https://example.com/comic",
        finalUrl: "https://example.com/comic/1",
        title: "웹툰",
        createdFrom: "manual-capture"
      },
      pages: [
        {
          ...makeChapterSnapshot().pages[0],
          webMeta: {
            url: "https://example.com/comic",
            finalUrl: "https://example.com/comic/1",
            segmentIndex: 0,
            scrollY: 320,
            viewport: { width: 1280, height: 720, deviceScaleFactor: 1.25 },
            captureMode: "viewport",
            capturedAt: "2026-06-02T00:00:00.000Z",
            contentHash: "abc123"
          }
        }
      ]
    };

    expect(parseIpcPayload(ChapterSnapshotSchema, payload, "웹 화")).toMatchObject({
      sourceKind: "web",
      webOrigin: { createdFrom: "manual-capture" },
      pages: [{ webMeta: { segmentIndex: 0, captureMode: "viewport" } }]
    });
    expect(parseIpcPayload(SaveChapterSnapshotSchema, payload, "웹 화 저장").pages[0]?.webMeta?.contentHash).toBe("abc123");
  });

  it("validates web browse open requests", () => {
    const parsed = parseIpcPayload(
      OpenWebBrowseRequestSchema,
      {
        url: "https://example.com",
        target: { mode: "new", title: "웹 번역" },
        mode: "manual"
      },
      "웹 열기"
    );

    expect(parsed.target.mode).toBe("new");
  });
});

function makeChapterSnapshot() {
  return {
    id: chapterId,
    workId,
    title: "1화",
    sourceKind: "folder",
    status: "completed",
    pageOrder: [pageId],
    pages: [
      {
        id: pageId,
        name: "001.png",
        imagePath: "C:\\library\\works\\work\\chapters\\chapter\\pages\\001.png",
        dataUrl: "",
        width: 100,
        height: 120,
        blocks: [
          {
            id: "block-1",
            type: "nonsolid",
            bbox: { x: 10, y: 10, w: 100, h: 100 },
            sourceText: "こんにちは",
            translatedText: "안녕",
            confidence: 0.9,
            sourceDirection: "vertical",
            renderDirection: "vertical",
            fontSizePx: 20,
            lineHeight: 1.2,
            textAlign: "center",
            textColor: "#111111",
            backgroundColor: "#ffffff",
            opacity: 0.9
          }
        ],
        analysisStatus: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
