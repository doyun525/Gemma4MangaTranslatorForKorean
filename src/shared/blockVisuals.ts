import type { BlockType } from "./types";
import { normalizeBlockType } from "./geometry";

export type BlockVisualStyle = {
  borderColor: string;
  backgroundColor: string;
  defaultOpacity: number;
};

export const DEFAULT_BLOCK_CORNER_RADIUS_PX = 12;
export const MIN_BLOCK_CORNER_RADIUS_PX = 8;
export const MAX_BLOCK_CORNER_RADIUS_PX = 32;
export const BLOCK_CORNER_RADIUS_SCALE = 0.18;

export const BLOCK_VISUAL_STYLES: Record<BlockType, BlockVisualStyle> = {
  nonsolid: {
    borderColor: "#f59e0b",
    backgroundColor: "#ffffff",
    defaultOpacity: 0.10
  }
};

export function resolveBlockVisualStyle(type: unknown): BlockVisualStyle {
  return BLOCK_VISUAL_STYLES[normalizeBlockType(type)];
}

export function resolveBlockCornerRadiusPx(width: number, height: number): number {
  const shortSide = Math.max(0, Math.min(Number(width) || 0, Number(height) || 0));
  const scaled = shortSide * BLOCK_CORNER_RADIUS_SCALE;
  return Math.round(Math.max(MIN_BLOCK_CORNER_RADIUS_PX, Math.min(MAX_BLOCK_CORNER_RADIUS_PX, scaled || DEFAULT_BLOCK_CORNER_RADIUS_PX)));
}
