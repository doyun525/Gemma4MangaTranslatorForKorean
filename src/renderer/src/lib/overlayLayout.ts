import type { TranslationBlock } from "../../../shared/types";
import { bboxToPixels, clamp, MIN_READABLE_FONT_SIZE_PX, resolveBlockRenderBbox } from "../../../shared/geometry";
import { resolveBlockFontFamily } from "./fonts";

const MIN_FONT_SIZE_PX = 1;
const MAX_AUTOFIT_FONT_SIZE_PX = 256;
const AUTOFIT_ROOM_RATIO = 0.9;
const MIN_BLOCK_PADDING_PX = 0;
const MIN_INNER_SIZE_PX = 1;
const BLOCK_BORDER_PX = 1;
const MAX_VERTICAL_COLUMNS = 2;

let measureCanvas: HTMLCanvasElement | null = null;

export type ViewportSize = {
  width: number;
  height: number;
};

export type PixelRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type BlockTextLayout = {
  rect: PixelRect;
  paddingPx: number;
  innerWidth: number;
  innerHeight: number;
  fitInnerWidth: number;
  fitInnerHeight: number;
  fontSizePx: number;
  overflow: boolean;
};

export function resolveOverlayFontSizePx(block: TranslationBlock, text: string, pageSize: ViewportSize, stageSize: ViewportSize): number {
  return resolveBlockTextLayout(block, text, pageSize, stageSize).fontSizePx;
}

export function resolveBlockPaddingPx(rect: PixelRect): number {
  void rect;
  return 0;
}

export function resolveBlockTextLayout(
  block: TranslationBlock,
  text: string,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): BlockTextLayout {
  const rect = resolveBlockRectPx(block, pageSize, stageSize, text);
  const paddingPx = resolveBlockPaddingPx(rect);
  const borderInsetPx = BLOCK_BORDER_PX * 2;
  const innerWidth = Math.max(MIN_INNER_SIZE_PX, rect.width - paddingPx * 2 - borderInsetPx);
  const innerHeight = Math.max(MIN_INNER_SIZE_PX, rect.height - paddingPx * 2 - borderInsetPx);
  const fitInnerWidth = innerWidth;
  const fitInnerHeight = innerHeight;
  const scale = Math.min(stageSize.width / Math.max(1, pageSize.width), stageSize.height / Math.max(1, pageSize.height));
  const preferredFontSize = Math.max(MIN_FONT_SIZE_PX, Math.floor(block.fontSizePx * scale));
  const maxFontSize = resolveAutoFitUpperBound(block, preferredFontSize, fitInnerWidth, fitInnerHeight);
  const fontSizePx = resolveTextFontSizePx(block, text, maxFontSize, fitInnerWidth, fitInnerHeight);

  return {
    rect,
    paddingPx,
    innerWidth,
    innerHeight,
    fitInnerWidth,
    fitInnerHeight,
    fontSizePx,
    overflow: text.trim() ? !doesTextFit(block, text, fontSizePx, fitInnerWidth, fitInnerHeight) : false
  };
}

export function resolveBlockRectPx(block: TranslationBlock, pageSize: ViewportSize, stageSize: ViewportSize, text = ""): PixelRect {
  void text;
  const renderBbox = resolveBlockRenderBbox(block, pageSize);
  const pixelRect = bboxToPixels(renderBbox, pageSize.width, pageSize.height);
  const scaleX = stageSize.width / Math.max(1, pageSize.width);
  const scaleY = stageSize.height / Math.max(1, pageSize.height);

  return {
    left: pixelRect.x * scaleX,
    top: pixelRect.y * scaleY,
    width: pixelRect.w * scaleX,
    height: pixelRect.h * scaleY
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function resolveTextFontSizePx(
  block: TranslationBlock,
  text: string,
  maxFontSize: number,
  innerWidth: number,
  innerHeight: number
): number {
  const capped = Math.max(MIN_FONT_SIZE_PX, Math.floor(maxFontSize));
  if (!(block.autoFitText ?? false) || !text.trim()) {
    return capped;
  }

  let low = MIN_FONT_SIZE_PX;
  let high = capped;
  let best = MIN_FONT_SIZE_PX;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (doesTextFit(block, text, mid, innerWidth, innerHeight)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return applyAutoFitRoom(Math.min(best, capped));
}

function doesTextFit(block: TranslationBlock, text: string, fontSize: number, innerWidth: number, innerHeight: number): boolean {
  if (block.renderDirection === "vertical") {
    return measureVerticalText(text, fontSize, innerWidth, innerHeight, fontSize * block.lineHeight).fits;
  }

  const context = getMeasureContext();
  context.font = buildFont(fontSize, block.fontFamily, block.bold, block.italic);
  const measured = measureWrappedText(context, text, innerWidth, fontSize * block.lineHeight);
  return measured.totalHeight <= innerHeight && measured.maxLineWidth <= innerWidth;
}

export function formatBlockTextWithWordAwareLineBreaks(
  block: Pick<TranslationBlock, "fontFamily" | "bold" | "italic">,
  text: string,
  maxWidth: number,
  fontSizePx: number
): string {
  if (!text.trim() || maxWidth <= 0 || fontSizePx <= 0) {
    return text;
  }

  const context = getMeasureContext();
  context.font = buildFont(fontSizePx, block.fontFamily, block.bold, block.italic);
  return wrapTextToWidthWordAware(context, text, maxWidth).join("\n");
}

export function wrapTextToWidthWordAware(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    lines.push(...wrapParagraphWordAware(context, paragraph, maxWidth));
  }

  return lines.length > 0 ? lines : [text];
}

/** 말줄임·문장부호 등 단어 뒤에 붙는 기호 — 단어 본문과 분리해 줄바꿈할 수 있음 */
const TRAILING_WRAP_SUFFIX_PATTERN = /(?:\.{2,3}|…+|[?!]+|[」』"'’”]+)$/u;

type WordCoreSuffix = {
  core: string;
  suffix: string;
};

function splitWordCoreAndSuffix(word: string): WordCoreSuffix {
  const match = word.match(TRAILING_WRAP_SUFFIX_PATTERN);
  if (!match || match.index === undefined || match.index === 0) {
    return { core: word, suffix: "" };
  }
  return {
    core: word.slice(0, match.index),
    suffix: match[0]
  };
}

/** 따옴표 등 뒤에 붙은 마지막 한글 음절 덩어리 (예: 부활을"이라니 → 이라니) */
function splitCoreHangulTail(core: string): { prefix: string; tail: string } {
  const match = core.match(/([\uAC00-\uD7A3]+)$/u);
  if (!match || match.index === undefined || match[1].length === 0) {
    return { prefix: core, tail: "" };
  }
  return {
    prefix: core.slice(0, match.index),
    tail: match[1]
  };
}

function wrapParagraphWordAware(context: CanvasRenderingContext2D, paragraph: string, maxWidth: number): string[] {
  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      lines.push(trimmed);
    }
  };

  for (const word of words) {
    current = placeWordWithOptionalSuffixBreak(context, word, maxWidth, lines, current, pushLine);
  }

  if (current) {
    pushLine(current);
  }

  return lines.length > 0 ? lines : [paragraph.trim()];
}

function placeWordWithOptionalSuffixBreak(
  context: CanvasRenderingContext2D,
  word: string,
  maxWidth: number,
  lines: string[],
  current: string,
  pushLine: (line: string) => void
): string {
  const { core, suffix } = splitWordCoreAndSuffix(word);
  const token = suffix ? `${core}${suffix}` : word;

  const appendToLine = (line: string, chunk: string) => (line ? `${line} ${chunk}` : chunk);

  const candidate = appendToLine(current, token);
  if (context.measureText(candidate).width <= maxWidth) {
    return candidate;
  }

  pushLine(current);
  current = "";

  if (context.measureText(token).width <= maxWidth) {
    return token;
  }

  if (suffix && shouldBreakBeforeTrailingSuffix(context, core, suffix, maxWidth)) {
    pushLine(core);
    return suffix;
  }

  if (suffix) {
    const hangulTailBreak = resolveHangulTailSuffixBreak(context, core, suffix, maxWidth);
    if (hangulTailBreak) {
      current = placeCorePrefixSegment(context, hangulTailBreak.prefix, maxWidth, lines, current, pushLine);
      if (current) {
        pushLine(current);
      }
      pushLine(hangulTailBreak.tail);
      return suffix;
    }
  }

  const coreLines = wrapTokenByCharacters(context, core, maxWidth);
  if (suffix) {
    return finishCoreLinesWithSuffix(context, core, suffix, maxWidth, lines, coreLines);
  }

  if (coreLines.length > 1) {
    lines.push(...coreLines.slice(0, -1));
  }
  return coreLines[coreLines.length - 1] ?? "";
}

function shouldBreakBeforeTrailingSuffix(
  context: CanvasRenderingContext2D,
  core: string,
  suffix: string,
  maxWidth: number
): boolean {
  if (!core || !suffix) {
    return false;
  }

  const coreFits = context.measureText(core).width <= maxWidth;
  const suffixFits = context.measureText(suffix).width <= maxWidth;
  const combinedFits = context.measureText(`${core}${suffix}`).width <= maxWidth;
  return coreFits && suffixFits && !combinedFits;
}

/** core 전체가 넘칠 때 마지막 한글 덩어리와 끝 부호를 분리 (이라니 / ...) */
function shouldSplitHangulTailFromSuffix(
  context: CanvasRenderingContext2D,
  core: string,
  tail: string,
  suffix: string,
  maxWidth: number
): boolean {
  if (!tail || !suffix) {
    return false;
  }

  const tailFits = context.measureText(tail).width <= maxWidth;
  const suffixFits = context.measureText(suffix).width <= maxWidth;
  if (!tailFits || !suffixFits) {
    return false;
  }

  const coreFits = context.measureText(core).width <= maxWidth;
  if (!coreFits) {
    return true;
  }

  return shouldBreakBeforeTrailingSuffix(context, tail, suffix, maxWidth);
}

function finishCoreLinesWithSuffix(
  context: CanvasRenderingContext2D,
  core: string,
  suffix: string,
  maxWidth: number,
  lines: string[],
  coreLines: string[]
): string {
  const hangulTail = splitCoreHangulTail(core);
  if (hangulTail.tail && shouldSplitHangulTailFromSuffix(context, core, hangulTail.tail, suffix, maxWidth)) {
    if (coreLines.length > 1) {
      lines.push(...coreLines.slice(0, -1));
      const lastCore = coreLines[coreLines.length - 1] ?? "";
      if (lastCore && lastCore !== hangulTail.tail && !hangulTail.tail.endsWith(lastCore)) {
        appendLine(lines, lastCore);
      }
    } else if (coreLines.length === 1 && coreLines[0] !== hangulTail.tail) {
      appendLine(lines, coreLines[0]);
    }
    appendLine(lines, hangulTail.tail);
    return suffix;
  }

  if (coreLines.length === 0) {
    return suffix;
  }

  if (coreLines.length === 1) {
    if (shouldBreakBeforeTrailingSuffix(context, core, suffix, maxWidth)) {
      appendLine(lines, core);
      return suffix;
    }
    const combined = `${coreLines[0]}${suffix}`;
    if (context.measureText(combined).width <= maxWidth) {
      return combined;
    }
    appendLine(lines, coreLines[0]);
    return suffix;
  }

  const lastCore = coreLines[coreLines.length - 1] ?? "";
  const hangulTailAtEnd = splitCoreHangulTail(core);
  const tailBrokenBySyllables =
    hangulTailAtEnd.tail &&
    lastCore &&
    lastCore !== hangulTailAtEnd.tail &&
    hangulTailAtEnd.tail.startsWith(lastCore);

  if (!tailBrokenBySyllables) {
    const withSuffix = `${lastCore}${suffix}`;
    if (context.measureText(withSuffix).width <= maxWidth) {
      lines.push(...coreLines.slice(0, -1));
      return withSuffix;
    }
  }

  if (shouldBreakBeforeTrailingSuffix(context, core, suffix, maxWidth)) {
    lines.push(...coreLines);
    return suffix;
  }

  lines.push(...coreLines.slice(0, -1));
  appendLine(lines, lastCore);
  return suffix;
}

function resolveHangulTailSuffixBreak(
  context: CanvasRenderingContext2D,
  core: string,
  suffix: string,
  maxWidth: number
): { prefix: string; tail: string } | null {
  const { prefix, tail } = splitCoreHangulTail(core);
  if (!tail || tail === core) {
    return null;
  }
  if (!shouldSplitHangulTailFromSuffix(context, core, tail, suffix, maxWidth)) {
    return null;
  }
  return { prefix, tail };
}

function placeCorePrefixSegment(
  context: CanvasRenderingContext2D,
  prefix: string,
  maxWidth: number,
  lines: string[],
  current: string,
  pushLine: (line: string) => void
): string {
  if (!prefix) {
    return current;
  }

  const candidate = current ? `${current} ${prefix}` : prefix;
  if (context.measureText(candidate).width <= maxWidth) {
    return candidate;
  }

  pushLine(current);
  current = "";

  if (context.measureText(prefix).width <= maxWidth) {
    return prefix;
  }

  const prefixLines = wrapTokenByCharacters(context, prefix, maxWidth);
  if (prefixLines.length > 1) {
    lines.push(...prefixLines.slice(0, -1));
  }
  return prefixLines[prefixLines.length - 1] ?? "";
}

function appendLine(lines: string[], line: string) {
  const trimmed = line.trim();
  if (trimmed) {
    lines.push(trimmed);
  }
}

function wrapTokenByCharacters(context: CanvasRenderingContext2D, token: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const char of [...token]) {
    const candidate = `${current}${char}`;
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = char;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [token];
}

function wrapTextToWidth(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return wrapTextToWidthWordAware(context, text, maxWidth);
}

function measureWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  lineHeight: number
) : { lines: string[]; totalHeight: number; maxLineWidth: number } {
  const lines = wrapTextToWidth(context, text, maxWidth);
  return {
    lines,
    totalHeight: lines.length * lineHeight,
    maxLineWidth: lines.reduce((widest, line) => Math.max(widest, context.measureText(line).width), 0)
  };
}

function resolveAutoFitUpperBound(block: TranslationBlock, preferredFontSize: number, innerWidth: number, innerHeight: number): number {
  if (!(block.autoFitText ?? false)) {
    return preferredFontSize;
  }

  const heightBound = Math.floor(innerHeight / Math.max(1, block.lineHeight || 1));
  const widthBound = block.renderDirection === "vertical" ? Math.floor(innerWidth / 1.15) : MAX_AUTOFIT_FONT_SIZE_PX;
  return clamp(Math.max(MIN_FONT_SIZE_PX, heightBound, widthBound), MIN_FONT_SIZE_PX, MAX_AUTOFIT_FONT_SIZE_PX);
}

function applyAutoFitRoom(fontSize: number): number {
  if (fontSize <= MIN_FONT_SIZE_PX) {
    return MIN_FONT_SIZE_PX;
  }
  return Math.max(MIN_FONT_SIZE_PX, Math.floor(fontSize * AUTOFIT_ROOM_RATIO));
}

function measureVerticalText(
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
  const estimatedColumnWidth = fontSize * 1.15;
  return {
    columnCount,
    fits: columnCount <= MAX_VERTICAL_COLUMNS && columnCount * estimatedColumnWidth <= maxWidth
  };
}

function getMeasureContext(): CanvasRenderingContext2D {
  if (typeof document === "undefined") {
    throw new Error("Document is not available for canvas text measurement");
  }

  measureCanvas ??= document.createElement("canvas");
  const context = measureCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is not available");
  }
  return context;
}

function buildFont(fontSize: number, fontFamily: string | undefined, bold?: boolean, italic?: boolean): string {
  const weight = bold ? 800 : 600;
  const style = italic ? "italic" : "normal";
  return `${style} ${weight} ${fontSize}px ${resolveBlockFontFamily(fontFamily)}`;
}
