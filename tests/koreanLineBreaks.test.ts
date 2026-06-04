import { afterEach, describe, expect, it } from "vitest";
import { wrapTextToWidthWordAware } from "../src/renderer/src/lib/overlayLayout";

const originalDocument = globalThis.document;

describe("korean line breaks", () => {
  afterEach(() => {
    Object.defineProperty(globalThis, "document", {
      value: originalDocument,
      configurable: true,
      writable: true
    });
  });

  it("wraps at spaces instead of breaking words when possible", () => {
    const context = installCanvasMeasureMock();
    const lines = wrapTextToWidthWordAware(context, "만약 잔 속에 사람의 마음이 없다면", 220);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.every((line) => !line.startsWith(" ") && !line.endsWith(" "))).toBe(true);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe("만약 잔 속에 사람의 마음이 없다면");
  });

  it("keeps explicit paragraph breaks", () => {
    const context = installCanvasMeasureMock();
    const lines = wrapTextToWidthWordAware(context, "첫 줄\n둘째 줄", 400);
    expect(lines).toEqual(["첫 줄", "둘째 줄"]);
  });

  it("breaks before ellipsis instead of splitting the trailing word", () => {
    const context = installCanvasMeasureMock(16);
    const lines = wrapTextToWidthWordAware(context, "이라니...", 70);
    expect(lines).toEqual(["이라니", "..."]);
  });

  it("keeps ellipsis attached when the full token fits on one line", () => {
    const context = installCanvasMeasureMock(16);
    const lines = wrapTextToWidthWordAware(context, "이라니...", 200);
    expect(lines).toEqual(["이라니..."]);
  });

  it("breaks before a trailing quote when the word would otherwise split", () => {
    const context = installCanvasMeasureMock(16);
    const lines = wrapTextToWidthWordAware(context, '부활을"', 55);
    expect(lines).toEqual(["부활을", '"']);
  });

  it("breaks before ellipsis on hangul tail after an embedded quote", () => {
    const context = installCanvasMeasureMock(16);
    const lines = wrapTextToWidthWordAware(context, '죽은 자에게 부활을"이라니...', 95);
    const joined = lines.join("\n");
    expect(joined).toContain("이라니");
    expect(joined).toContain("...");
    expect(lines[lines.length - 1]).toBe("...");
    expect(lines.some((line) => line.endsWith("이라니"))).toBe(true);
    expect(lines.some((line) => line === "니...")).toBe(false);
    expect(lines.some((line) => line.endsWith("이라") && !line.endsWith("이라니"))).toBe(false);
  });
});

function installCanvasMeasureMock(fontSize = 16): CanvasRenderingContext2D {
  const context = {
    font: `${fontSize}px sans-serif`,
    measureText(text: string) {
      const match = /(\d+)px/.exec(this.font);
      const size = Number(match?.[1] ?? fontSize);
      return { width: [...text].length * size * 0.95 } as TextMetrics;
    }
  };

  Object.defineProperty(globalThis, "document", {
    value: {
      createElement: () => ({
        getContext: () => context
      })
    },
    configurable: true,
    writable: true
  });

  return context as unknown as CanvasRenderingContext2D;
}
