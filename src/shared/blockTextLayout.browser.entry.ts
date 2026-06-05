import { BLOCK_TEXT_LAYOUT_CONFIG } from "./blockTextLayoutConfig";
import {
  buildBlockTextFontCss,
  measureBlockWrappedText,
  resolveAutoFitUpperBound,
  resolveBlockTextFontSizePx,
  resolveFitInnerSize,
  type BlockTextFitInput
} from "./blockTextLayoutEngine";
import { createTextMeasurerFromCanvas } from "./textMeasurer";

type BrowserLayoutBlock = {
  text?: string;
  autoFitText?: boolean;
  fontSizePx?: number;
  lineHeight?: number;
  renderDirection?: "horizontal" | "vertical" | "rotated" | "hidden";
  vertical?: boolean;
  fontFamily?: string;
  bold?: boolean;
  italic?: boolean;
};

const DEFAULT_FONT_STACK = '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif';

function resolveFontFamily(fontFamily?: string): string {
  const id = String(fontFamily ?? "").trim();
  const stacks: Record<string, string> = {
    default: DEFAULT_FONT_STACK,
    mongtori: '"MGT Mongtori", "Malgun Gothic", sans-serif',
    "chosun-gungseo": '"MGT Chosun Gungseo", "Malgun Gothic", serif',
    "griun-pol-sensibility": '"MGT Griun Pol Sensibility", "Malgun Gothic", sans-serif',
    "nanum-gothic": '"MGT Nanum Gothic", "Malgun Gothic", sans-serif',
    "nanum-myeongjo": '"MGT Nanum Myeongjo", "Malgun Gothic", serif',
    "nanum-barun-gothic": '"MGT Nanum Barun Gothic", "Malgun Gothic", sans-serif',
    "seoul-namsan": '"MGT Seoul Namsan", "Malgun Gothic", sans-serif',
    "seoul-namsan-vertical": '"MGT Seoul Namsan Vertical", "Malgun Gothic", sans-serif',
    "seoul-hangang": '"MGT Seoul Hangang", "Malgun Gothic", serif'
  };
  if (!id || id === "default") {
    return DEFAULT_FONT_STACK;
  }
  if (stacks[id]) {
    return stacks[id];
  }
  if (id.includes(",") || /^["']/.test(id)) {
    return id;
  }
  return `"${id}", ${DEFAULT_FONT_STACK}`;
}

function normalizeBlock(block: BrowserLayoutBlock): BlockTextFitInput {
  const renderDirection = block.vertical ? "vertical" : block.renderDirection ?? "horizontal";
  return {
    text: String(block.text ?? ""),
    autoFitText: block.autoFitText,
    fontSizePx: Number(block.fontSizePx) || 16,
    lineHeight: Number(block.lineHeight) || 1.18,
    renderDirection,
    fontFamily: block.fontFamily,
    bold: Boolean(block.bold),
    italic: Boolean(block.italic)
  };
}

function getMeasureContext(): CanvasRenderingContext2D {
  const globalWindow = globalThis as typeof globalThis & {
    __mgtBlockTextLayoutCanvas?: HTMLCanvasElement;
  };
  globalWindow.__mgtBlockTextLayoutCanvas ??= document.createElement("canvas");
  const context = globalWindow.__mgtBlockTextLayoutCanvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas context is not available");
  }
  return context;
}

function blockFontWeight(block: BrowserLayoutBlock): number {
  return block.bold ? 800 : 400;
}

const api = {
  config: BLOCK_TEXT_LAYOUT_CONFIG,
  resolveFitInnerSize,
  resolveFontSize(block: BrowserLayoutBlock, innerWidth: number, innerHeight: number): number {
    const normalized = normalizeBlock(block);
    const preferred = Math.max(
      BLOCK_TEXT_LAYOUT_CONFIG.minFontSizePx,
      Math.floor(normalized.fontSizePx)
    );
    const measurer = createTextMeasurerFromCanvas(getMeasureContext());
    const maxFontSize = resolveAutoFitUpperBound(normalized, preferred, innerWidth, innerHeight);
    return resolveBlockTextFontSizePx(
      normalized,
      normalized.text,
      maxFontSize,
      innerWidth,
      innerHeight,
      measurer,
      resolveFontFamily
    );
  },
  measureHorizontal(block: BrowserLayoutBlock, fontSize: number, innerWidth: number) {
    const normalized = normalizeBlock(block);
    const measurer = createTextMeasurerFromCanvas(getMeasureContext());
    return measureBlockWrappedText(measurer, normalized, normalized.text, innerWidth, fontSize, resolveFontFamily);
  },
  buildFont(block: BrowserLayoutBlock, fontSize: number): string {
    return buildBlockTextFontCss(fontSize, resolveFontFamily(block.fontFamily), block.bold, block.italic);
  },
  blockFontWeight
};

(globalThis as typeof globalThis & { MgtBlockTextLayout?: typeof api }).MgtBlockTextLayout = api;

export default api;
