import { describe, expect, it } from "vitest";
import { BLOCK_TEXT_LAYOUT_CONFIG } from "../src/shared/blockTextLayoutConfig";
import {
  applyAutoFitRoom,
  resolveAutoFitUpperBound,
  resolveBlockTextFontSizePx,
  resolveFitInnerSize,
  type BlockTextFitInput
} from "../src/shared/blockTextLayoutEngine";
import type { TextMeasurer } from "../src/shared/textMeasurer";

describe("blockTextLayoutEngine", () => {
  it("shares autofit room ratio from config", () => {
    expect(applyAutoFitRoom(100)).toBe(Math.floor(100 * BLOCK_TEXT_LAYOUT_CONFIG.autofitRoomRatio));
  });

  it("derives inner size from border inset config", () => {
    expect(resolveFitInnerSize(100, 80)).toEqual({
      innerWidth: 100 - BLOCK_TEXT_LAYOUT_CONFIG.blockBorderPx * 2,
      innerHeight: 80 - BLOCK_TEXT_LAYOUT_CONFIG.blockBorderPx * 2
    });
  });

  it("returns preferred size when auto-fit is disabled", () => {
    const block: BlockTextFitInput = {
      text: "테스트",
      autoFitText: false,
      fontSizePx: 24,
      lineHeight: 1.18,
      renderDirection: "horizontal"
    };
    const measurer = createFixedWidthMeasurer(8);
    expect(
      resolveBlockTextFontSizePx(block, block.text, 40, 120, 80, measurer, () => "sans-serif")
    ).toBe(40);
    expect(resolveAutoFitUpperBound(block, 24, 120, 80)).toBe(24);
  });
});

function createFixedWidthMeasurer(charWidth: number): TextMeasurer {
  return {
    setFont() {},
    measureText(text: string) {
      return { width: [...text].length * charWidth };
    }
  };
}
