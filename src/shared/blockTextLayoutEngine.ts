import { BLOCK_TEXT_LAYOUT_CONFIG } from "./blockTextLayoutConfig";
import type { TextMeasurer } from "./textMeasurer";
import { wrapTextToWidthWordAware } from "./wordAwareTextWrap";
import { clamp } from "./geometry";

export type BlockTextFitInput = {
  text: string;
  autoFitText?: boolean;
  fontSizePx: number;
  lineHeight: number;
  renderDirection: "horizontal" | "vertical" | "rotated" | "hidden";
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
};

export type BlockWrappedTextMeasurement = {
  lines: string[];
  totalHeight: number;
  maxLineWidth: number;
};

export function resolveFitInnerSize(width: number, height: number, paddingPx: number = BLOCK_TEXT_LAYOUT_CONFIG.minBlockPaddingPx): {
  innerWidth: number;
  innerHeight: number;
} {
  const borderInsetPx = BLOCK_TEXT_LAYOUT_CONFIG.blockBorderPx * 2;
  return {
    innerWidth: Math.max(BLOCK_TEXT_LAYOUT_CONFIG.minInnerSizePx, width - paddingPx * 2 - borderInsetPx),
    innerHeight: Math.max(BLOCK_TEXT_LAYOUT_CONFIG.minInnerSizePx, height - paddingPx * 2 - borderInsetPx)
  };
}

export function buildBlockTextFontCss(
  fontSize: number,
  fontFamily: string,
  bold?: boolean,
  italic?: boolean
): string {
  const weight = bold ? 800 : 600;
  const style = italic ? "italic" : "normal";
  return `${style} ${weight} ${fontSize}px ${fontFamily}`;
}

export function measureVerticalText(
  text: string,
  fontSize: number,
  maxWidth: number,
  maxHeight: number,
  lineHeight: number
): { columnCount: number; fits: boolean } {
  const compact = text.replace(/\r/g, "").replace(/\s+/g, "");
  if (!compact) {
    return { columnCount: 0, fits: true };
  }

  const charsPerColumn = Math.max(1, Math.floor(maxHeight / Math.max(fontSize, lineHeight)));
  const columnCount = Math.max(1, Math.ceil(compact.length / charsPerColumn));
  const estimatedColumnWidth = fontSize * BLOCK_TEXT_LAYOUT_CONFIG.verticalColumnWidthRatio;
  return {
    columnCount,
    fits:
      columnCount <= BLOCK_TEXT_LAYOUT_CONFIG.maxVerticalColumns &&
      columnCount * estimatedColumnWidth <= maxWidth
  };
}

export function measureBlockWrappedText(
  measurer: TextMeasurer,
  block: Pick<BlockTextFitInput, "fontFamily" | "bold" | "italic" | "lineHeight">,
  text: string,
  maxWidth: number,
  fontSize: number,
  resolveFontFamily: (fontFamily?: string) => string
): BlockWrappedTextMeasurement {
  measurer.setFont(buildBlockTextFontCss(fontSize, resolveFontFamily(block.fontFamily), block.bold, block.italic));
  const lines = wrapTextToWidthWordAware(measurer, text, maxWidth);
  const lineHeightPx = fontSize * block.lineHeight;
  return {
    lines,
    totalHeight: lines.length * lineHeightPx,
    maxLineWidth: lines.reduce((widest, line) => Math.max(widest, measurer.measureText(line).width), 0)
  };
}

export function doesBlockTextFit(
  block: BlockTextFitInput,
  text: string,
  fontSize: number,
  innerWidth: number,
  innerHeight: number,
  measurer: TextMeasurer,
  resolveFontFamily: (fontFamily?: string) => string
): boolean {
  if (block.renderDirection === "vertical") {
    return measureVerticalText(text, fontSize, innerWidth, innerHeight, fontSize * block.lineHeight).fits;
  }

  const measured = measureBlockWrappedText(measurer, block, text, innerWidth, fontSize, resolveFontFamily);
  return measured.totalHeight <= innerHeight && measured.maxLineWidth <= innerWidth;
}

export function resolveAutoFitUpperBound(
  block: Pick<BlockTextFitInput, "autoFitText" | "lineHeight" | "renderDirection">,
  preferredFontSize: number,
  innerWidth: number,
  innerHeight: number
): number {
  if (!(block.autoFitText ?? false)) {
    return preferredFontSize;
  }

  const { minFontSizePx, maxAutofitFontSizePx, verticalColumnWidthRatio } = BLOCK_TEXT_LAYOUT_CONFIG;
  const heightBound = Math.floor(innerHeight / Math.max(1, block.lineHeight || 1));
  const widthBound =
    block.renderDirection === "vertical" ? Math.floor(innerWidth / verticalColumnWidthRatio) : maxAutofitFontSizePx;
  return clamp(Math.max(minFontSizePx, heightBound, widthBound), minFontSizePx, maxAutofitFontSizePx);
}

export function applyAutoFitRoom(fontSize: number): number {
  const { minFontSizePx, autofitRoomRatio } = BLOCK_TEXT_LAYOUT_CONFIG;
  if (fontSize <= minFontSizePx) {
    return minFontSizePx;
  }
  return Math.max(minFontSizePx, Math.floor(fontSize * autofitRoomRatio));
}

export function resolveBlockTextFontSizePx(
  block: BlockTextFitInput,
  text: string,
  maxFontSize: number,
  innerWidth: number,
  innerHeight: number,
  measurer: TextMeasurer,
  resolveFontFamily: (fontFamily?: string) => string
): number {
  const capped = Math.max(BLOCK_TEXT_LAYOUT_CONFIG.minFontSizePx, Math.floor(maxFontSize));
  if (!(block.autoFitText ?? false) || !text.trim()) {
    return capped;
  }

  let low = BLOCK_TEXT_LAYOUT_CONFIG.minFontSizePx;
  let high = capped;
  let best = BLOCK_TEXT_LAYOUT_CONFIG.minFontSizePx;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (doesBlockTextFit(block, text, mid, innerWidth, innerHeight, measurer, resolveFontFamily)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return applyAutoFitRoom(Math.min(best, capped));
}

export function formatBlockTextWithWordAwareLineBreaks(
  measurer: TextMeasurer,
  block: Pick<BlockTextFitInput, "fontFamily" | "bold" | "italic">,
  text: string,
  maxWidth: number,
  fontSizePx: number,
  resolveFontFamily: (fontFamily?: string) => string
): string {
  if (!text.trim() || maxWidth <= 0 || fontSizePx <= 0) {
    return text;
  }

  measurer.setFont(buildBlockTextFontCss(fontSizePx, resolveFontFamily(block.fontFamily), block.bold, block.italic));
  return wrapTextToWidthWordAware(measurer, text, maxWidth).join("\n");
}
