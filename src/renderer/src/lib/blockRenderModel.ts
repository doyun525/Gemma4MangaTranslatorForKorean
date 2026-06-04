import type { TranslationBlock, WebOverlayRenderBlock } from "../../../shared/types";
import { resolveBlockVisualStyle } from "../../../shared/blockVisuals";
import { resolveBlockFontFamily } from "./fonts";
import { resolveBlockDisplayText } from "./koreanLineBreaks";
import { hexToRgba, resolveBlockTextLayout, type BlockTextLayout, type ViewportSize } from "./overlayLayout";

export type { ViewportSize };

export type OverlayBlockRenderModel = {
  displayText: string;
  layout: BlockTextLayout;
  outlineWidthPx: number;
  outlineColor: string;
  backgroundColor: string;
  fontFamily: string;
};

export function resolveOverlayBlockRenderModel(
  block: TranslationBlock,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): OverlayBlockRenderModel {
  const rawText = block.translatedText || block.sourceText || "...";
  const displayText = resolveBlockDisplayText(block, rawText, pageSize, stageSize);
  const layout = resolveBlockTextLayout(block, rawText, pageSize, stageSize);
  const visualStyle = resolveBlockVisualStyle(block.type);
  return {
    displayText,
    layout,
    outlineWidthPx: resolveTextOutlinePx(layout.fontSizePx, block.outlineWidthPx, block.outlineWidthScale),
    outlineColor: resolveCssColor(block.outlineColor, "#ffffff"),
    backgroundColor: block.backgroundColor || visualStyle.backgroundColor,
    fontFamily: resolveBlockFontFamily(block.fontFamily)
  };
}

export function resolveOverlayBlockBackground(block: TranslationBlock, model: OverlayBlockRenderModel, showChrome: boolean): string {
  return showChrome ? hexToRgba(model.backgroundColor, block.opacity) : "transparent";
}

export function toWebOverlayRenderBlock(
  block: TranslationBlock,
  model: OverlayBlockRenderModel,
  scrollX: number,
  scrollY: number,
  showChrome: boolean
): WebOverlayRenderBlock | null {
  if (block.renderDirection === "hidden") {
    return null;
  }
  const text = model.displayText.trim() ? model.displayText : "";
  if (!text) {
    return null;
  }
  return {
    id: block.id,
    x: scrollX + model.layout.rect.left,
    y: scrollY + model.layout.rect.top,
    w: Math.max(1, model.layout.rect.width),
    h: Math.max(1, model.layout.rect.height),
    text,
    textColor: resolveCssColor(block.textColor, "#111111"),
    backgroundColor: resolveCssColor(model.backgroundColor, "#ffffff"),
    opacity: showChrome ? block.opacity : 0,
    fontSizePx: model.layout.fontSizePx,
    lineHeight: block.lineHeight,
    textAlign: block.textAlign,
    fontFamily: model.fontFamily,
    outlineColor: model.outlineColor,
    outlineWidthPx: model.outlineWidthPx,
    bold: Boolean(block.bold),
    italic: Boolean(block.italic),
    vertical: block.renderDirection === "vertical",
    autoFitText: block.autoFitText
  };
}

export function resolveTextOutlinePx(fontSizePx: number, outlineWidthPx?: number, outlineWidthScale?: number): number {
  const configured = Number(outlineWidthPx);
  if (Number.isFinite(configured)) {
    return Math.round(Math.min(8, Math.max(0, configured)) * Math.max(0, outlineWidthScale ?? 1) * 10) / 10;
  }
  return Math.round(Math.min(4, Math.max(0.35, fontSizePx * 0.055)) * Math.max(0, outlineWidthScale ?? 1) * 10) / 10;
}

export function resolveCssColor(value: string | undefined, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}
