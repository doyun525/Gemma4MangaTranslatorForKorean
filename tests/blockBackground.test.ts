import { describe, expect, it } from "vitest";
import { estimateBackgroundFromBitmap, rgbToHex, sampleBlockBackgroundsFromBitmap } from "../src/shared/blockBackground";

function createFlatBitmap(width: number, height: number, color: { r: number; g: number; b: number }): Buffer {
  const bitmap = Buffer.alloc(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4;
    bitmap[offset] = color.b;
    bitmap[offset + 1] = color.g;
    bitmap[offset + 2] = color.r;
    bitmap[offset + 3] = 255;
  }
  return bitmap;
}

describe("blockBackground", () => {
  it("detects a flat white background inside a bbox", () => {
    const bitmap = createFlatBitmap(100, 100, { r: 250, g: 248, b: 245 });
    const sampled = estimateBackgroundFromBitmap(
      bitmap,
      100,
      100,
      { x: 100, y: 100, w: 400, h: 300 },
      100,
      100
    );

    expect(sampled?.flat).toBe(true);
    expect(rgbToHex(sampled!.color)).toBe("#faf8f5");
  });

  it("rejects noisy mixed backgrounds", () => {
    const bitmap = Buffer.alloc(100 * 100 * 4);
    for (let y = 0; y < 100; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        const offset = (y * 100 + x) * 4;
        const value = (x + y) % 2 === 0 ? 240 : 40;
        bitmap[offset] = value;
        bitmap[offset + 1] = value;
        bitmap[offset + 2] = value;
        bitmap[offset + 3] = 255;
      }
    }

    const sampled = estimateBackgroundFromBitmap(
      bitmap,
      100,
      100,
      { x: 0, y: 0, w: 1000, h: 1000 },
      100,
      100
    );

    expect(sampled?.flat).toBe(false);
  });

  it("samples multiple blocks at once", () => {
    const bitmap = createFlatBitmap(200, 200, { r: 220, g: 220, b: 220 });
    const results = sampleBlockBackgroundsFromBitmap(bitmap, 200, 200, 200, 200, [
      { id: "a", bbox: { x: 0, y: 0, w: 500, h: 500 } },
      { id: "b", bbox: { x: 500, y: 500, w: 400, h: 400 } }
    ]);

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.flat && result.backgroundColor === "#dcdcdc")).toBe(true);
  });
});
