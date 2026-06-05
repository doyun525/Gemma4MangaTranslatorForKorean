import type { TranslationBlock } from "../../../shared/types";
import { bboxToPixels, clamp, resolveEffectiveRenderBbox } from "../../../shared/geometry";
import { BLOCK_TEXT_LAYOUT_CONFIG } from "../../../shared/blockTextLayoutConfig";
import {
  doesBlockTextFit,
  formatBlockTextWithWordAwareLineBreaks as formatBlockTextWithWordAwareLineBreaksShared,
  resolveAutoFitUpperBound,
  resolveBlockTextFontSizePx,
  resolveFitInnerSize,
  type BlockTextFitInput
} from "../../../shared/blockTextLayoutEngine";
import { createTextMeasurerFromCanvas } from "../../../shared/textMeasurer";
import { wrapTextToWidthWordAware as wrapTextToWidthWordAwareShared } from "../../../shared/wordAwareTextWrap";
import { resolveBlockFontFamily } from "./fonts";

export { BLOCK_TEXT_LAYOUT_CONFIG };

const MIN_FONT_SIZE_PX = BLOCK_TEXT_LAYOUT_CONFIG.minFontSizePx;

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

export function resolveBlockPaddingPx(_rect: PixelRect): number {
  return BLOCK_TEXT_LAYOUT_CONFIG.minBlockPaddingPx;
}

export function resolveBlockTextLayout(
  block: TranslationBlock,
  text: string,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): BlockTextLayout {
  const rect = resolveBlockRectPx(block, pageSize, stageSize, text);
  const paddingPx = resolveBlockPaddingPx(rect);
  const { innerWidth, innerHeight } = resolveFitInnerSize(rect.width, rect.height, paddingPx);
  const fitInnerWidth = innerWidth;
  const fitInnerHeight = innerHeight;
  const scale = Math.min(stageSize.width / Math.max(1, pageSize.width), stageSize.height / Math.max(1, pageSize.height));
  const preferredFontSize = Math.max(MIN_FONT_SIZE_PX, Math.floor(block.fontSizePx * scale));
  const fitBlock = toBlockTextFitInput(block, text);
  const measurer = createTextMeasurerFromCanvas(getMeasureContext());
  const maxFontSize = resolveAutoFitUpperBound(fitBlock, preferredFontSize, fitInnerWidth, fitInnerHeight);
  const fontSizePx = resolveBlockTextFontSizePx(
    fitBlock,
    text,
    maxFontSize,
    fitInnerWidth,
    fitInnerHeight,
    measurer,
    resolveBlockFontFamily
  );

  return {
    rect,
    paddingPx,
    innerWidth,
    innerHeight,
    fitInnerWidth,
    fitInnerHeight,
    fontSizePx,
    overflow: text.trim()
      ? !doesBlockTextFit(fitBlock, text, fontSizePx, fitInnerWidth, fitInnerHeight, measurer, resolveBlockFontFamily)
      : false
  };
}

export function resolveBlockRectPx(block: TranslationBlock, pageSize: ViewportSize, stageSize: ViewportSize, text = ""): PixelRect {
  const renderBbox = resolveEffectiveRenderBbox(block, pageSize, text);
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

export function formatBlockTextWithWordAwareLineBreaks(
  block: Pick<TranslationBlock, "fontFamily" | "bold" | "italic">,
  text: string,
  maxWidth: number,
  fontSizePx: number
): string {
  return formatBlockTextWithWordAwareLineBreaksShared(
    createTextMeasurerFromCanvas(getMeasureContext()),
    block,
    text,
    maxWidth,
    fontSizePx,
    resolveBlockFontFamily
  );
}

export function wrapTextToWidthWordAware(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  return wrapTextToWidthWordAwareShared(createTextMeasurerFromCanvas(context), text, maxWidth);
}

function toBlockTextFitInput(block: TranslationBlock, text: string): BlockTextFitInput {
  return {
    text,
    autoFitText: block.autoFitText,
    fontSizePx: block.fontSizePx,
    lineHeight: block.lineHeight,
    renderDirection: block.renderDirection,
    fontFamily: block.fontFamily,
    bold: block.bold,
    italic: block.italic
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
