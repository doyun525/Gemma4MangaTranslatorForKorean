import type { BBox, BlockType, ChapterSnapshot, RenderTextDirection, TranslationBlock } from "./types";

type PageSize = {
  width: number;
  height: number;
};

type BBoxSpace = NonNullable<TranslationBlock["bboxSpace"]>;
type RenderBboxBlock = Pick<TranslationBlock, "bbox" | "renderBbox"> &
  Partial<Pick<TranslationBlock, "bboxSpace" | "renderBboxSpace" | "renderDirection" | "lineHeight" | "fontSizePx" | "autoFitText">>;

export const MIN_READABLE_FONT_SIZE_PX = 10;
export const MIN_NORMALIZED_BBOX_SIZE = 0.01;

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

export function clampBbox(bbox: BBox): BBox {
  const x = clamp(bbox.x, 0, 1000 - MIN_NORMALIZED_BBOX_SIZE);
  const y = clamp(bbox.y, 0, 1000 - MIN_NORMALIZED_BBOX_SIZE);
  const w = clamp(bbox.w, MIN_NORMALIZED_BBOX_SIZE, 1000 - x);
  const h = clamp(bbox.h, MIN_NORMALIZED_BBOX_SIZE, 1000 - y);
  return { x: roundBboxValue(x), y: roundBboxValue(y), w: roundBboxValue(w), h: roundBboxValue(h) };
}

function roundBboxValue(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function sanitizeChapterBboxes(chapter: ChapterSnapshot): ChapterSnapshot {
  return {
    ...chapter,
    pages: chapter.pages.map((page) => ({
      ...page,
      blocks: page.blocks.map((block) => sanitizeBlockBboxes(block, { width: page.width, height: page.height }))
    }))
  };
}

export function sanitizeBlockBboxes(block: TranslationBlock, pageSize?: PageSize | null): TranslationBlock {
  const renderBbox = block.renderBbox ? normalizeBboxTo1000(block.renderBbox, pageSize, block.renderBboxSpace) : undefined;
  return {
    ...block,
    bbox: normalizeBboxTo1000(block.bbox, pageSize, block.bboxSpace),
    bboxSpace: "normalized_1000",
    renderBbox,
    renderBboxSpace: renderBbox ? "normalized_1000" : undefined
  };
}

export function bboxToPixels(bbox: BBox, width: number, height: number): BBox {
  return {
    x: (bbox.x / 1000) * width,
    y: (bbox.y / 1000) * height,
    w: (bbox.w / 1000) * width,
    h: (bbox.h / 1000) * height
  };
}

export function pixelsToBbox(bbox: BBox, width: number, height: number): BBox {
  return clampBbox({
    x: (bbox.x / Math.max(1, width)) * 1000,
    y: (bbox.y / Math.max(1, height)) * 1000,
    w: (bbox.w / Math.max(1, width)) * 1000,
    h: (bbox.h / Math.max(1, height)) * 1000
  });
}

export function normalizeBboxTo1000(bbox: BBox, pageSize?: PageSize | null, bboxSpace?: BBoxSpace): BBox {
  if (bboxSpace === "pixels" && pageSize) {
    return pixelsToBbox(bbox, pageSize.width, pageSize.height);
  }

  return clampBbox(bbox);
}

export function resolveBlockRenderBbox(
  block: RenderBboxBlock,
  pageSize?: PageSize | null
): BBox {
  if (block.renderBbox) {
    return normalizeBboxTo1000(block.renderBbox, pageSize, block.renderBboxSpace);
  }

  return normalizeBboxTo1000(block.bbox, pageSize, block.bboxSpace);
}

export function resolveEffectiveRenderBbox(block: RenderBboxBlock, pageSize: PageSize, text: string): BBox {
  void text;
  return resolveBlockRenderBbox(block, pageSize);
}

export function estimateBlockFontSizePx(
  text: string,
  block: RenderBboxBlock,
  pageSize: PageSize
): number {
  return estimateFontSizePx(text, resolveEffectiveRenderBbox(block, pageSize, text), pageSize);
}

export function resolveEditableBlockBbox(
  block: RenderBboxBlock,
  pageSize?: PageSize | null,
  text = ""
): { key: "bbox" | "renderBbox"; bbox: BBox } {
  void text;
  if (block.renderBbox) {
    return { key: "renderBbox", bbox: normalizeBboxTo1000(block.renderBbox, pageSize, block.renderBboxSpace) };
  }

  return { key: "bbox", bbox: normalizeBboxTo1000(block.bbox, pageSize, block.bboxSpace) };
}

export function applyEditableBlockBbox(block: TranslationBlock, nextBbox: BBox, pageSize?: PageSize | null, text = ""): TranslationBlock {
  const target = resolveEditableBlockBbox(block, pageSize, text);
  const clamped = clampBbox(nextBbox);
  return target.key === "renderBbox"
    ? { ...block, renderBbox: clamped, renderBboxSpace: "normalized_1000" }
    : { ...block, bbox: clamped, bboxSpace: "normalized_1000" };
}

export function offsetBlockBboxes(block: TranslationBlock, dx: number, dy: number, pageSize?: PageSize | null): TranslationBlock {
  const bbox = normalizeBboxTo1000(block.bbox, pageSize, block.bboxSpace);
  const renderBbox = block.renderBbox ? normalizeBboxTo1000(block.renderBbox, pageSize, block.renderBboxSpace) : undefined;

  return {
    ...block,
    bbox: offsetBbox(bbox, dx, dy),
    bboxSpace: "normalized_1000",
    renderBbox: renderBbox ? offsetBbox(renderBbox, dx, dy) : undefined,
    renderBboxSpace: renderBbox ? "normalized_1000" : undefined
  };
}

export function enforceRenderDirection(type: BlockType, direction: RenderTextDirection): RenderTextDirection {
  void type;
  return direction === "vertical" || direction === "rotated" || direction === "hidden" ? direction : "horizontal";
}

export function enforceRotationDeg(type: BlockType, value: unknown): number {
  void type;
  return normalizeRotationDeg(value);
}

export function normalizeRotationDeg(value: unknown): number {
  return clamp(Math.round(Number(value) || 0), -30, 30);
}

export function normalizeBlockType(value: unknown): BlockType {
  void value;
  return "nonsolid";
}

export function normalizeRenderDirection(value: unknown, fallback: RenderTextDirection): RenderTextDirection {
  const text = String(value ?? "").trim().toLowerCase();
  return text === "horizontal" || text === "vertical" || text === "rotated" || text === "hidden" ? text : fallback;
}

export function estimateFontSizePx(text: string, bbox: BBox, pageSize: { width: number; height: number }): number {
  const px = bboxToPixels(bbox, pageSize.width, pageSize.height);
  const compactLength = Math.max(1, text.replace(/\s+/g, "").length);
  const approxCharsPerLine = Math.max(4, Math.floor(px.w / 20));
  const lineCount = Math.max(1, Math.ceil(compactLength / approxCharsPerLine));
  const heightLimited = Math.floor(px.h / (lineCount * 1.2));
  const widthLimited = Math.floor(px.w / Math.min(12, Math.max(4, compactLength)));
  return clamp(Math.min(heightLimited, widthLimited, 40), 12, 72);
}

function offsetBbox(bbox: BBox, dx: number, dy: number): BBox {
  return clampBbox({
    ...bbox,
    x: bbox.x + dx,
    y: bbox.y + dy
  });
}

