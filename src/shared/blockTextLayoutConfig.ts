import { MIN_READABLE_FONT_SIZE_PX } from "./geometry";

export type BlockTextLayoutConfig = {
  minFontSizePx: number;
  maxAutofitFontSizePx: number;
  autofitRoomRatio: number;
  minBlockPaddingPx: number;
  minInnerSizePx: number;
  blockBorderPx: number;
  maxVerticalColumns: number;
  verticalColumnWidthRatio: number;
};

export const BLOCK_TEXT_LAYOUT_CONFIG: BlockTextLayoutConfig = {
  minFontSizePx: MIN_READABLE_FONT_SIZE_PX,
  maxAutofitFontSizePx: 256,
  autofitRoomRatio: 0.95,
  minBlockPaddingPx: 0,
  minInnerSizePx: 1,
  blockBorderPx: 0.5,
  maxVerticalColumns: 2,
  verticalColumnWidthRatio: 1.15
};
