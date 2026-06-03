import { BrowserWindow, nativeImage } from "electron";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";
import { bboxToPixels, clamp, resolveBlockRenderBbox } from "../shared/geometry";
import { resolveBlockCornerRadiusPx } from "../shared/blockVisuals";
import type { CustomFont, MangaPage, TranslationBlock } from "../shared/types";
import { getAppPaths } from "./appPaths";
import { listCustomFonts } from "./customFonts";
import type { ImageDecodeFallback } from "./regionCrop";

const MAX_EXPORT_CANVAS_HEIGHT = 12_000;

export async function renderPageWithTranslationBlocksForExport(
  page: MangaPage,
  options: {
    dataRoot: string;
    decodeFallback: ImageDecodeFallback;
    showTextBlocks?: boolean;
    showBlockChrome?: boolean;
  }
): Promise<Buffer> {
  const sourcePath = page.inpaintedImagePath || page.imagePath;
  const image = await loadImageForPngExport(sourcePath, options.decodeFallback);
  const size = image.getSize();
  const width = Math.max(1, size.width || page.width);
  const height = Math.max(1, size.height || page.height);
  const imageDataUrl = `data:image/png;base64,${image.toPNG().toString("base64")}`;
  if (height > MAX_EXPORT_CANVAS_HEIGHT) {
    return renderTallPageWithTranslationBlocksForExport(page, imageDataUrl, width, height, options);
  }
  const html = buildPageExportHtml(page, imageDataUrl, width, height, {
    showTextBlocks: options.showTextBlocks ?? true,
    showBlockChrome: options.showBlockChrome ?? true,
    tileY: 0,
    tileHeight: height
  });
  const renderDir = join(options.dataRoot, "tmp", "png-export-render");
  await mkdir(renderDir, { recursive: true });
  const htmlPath = join(renderDir, `${page.id}-${randomUUID()}.html`);
  const win = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(1000, height),
    show: false,
    useContentSize: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  });

  try {
    await writeFile(htmlPath, html, "utf8");
    await win.loadFile(htmlPath);
    await waitForExportRenderReady(win);
    const pngDataUrl = await win.webContents.executeJavaScript("window.__exportPngDataUrl", true);
    if (typeof pngDataUrl !== "string" || !pngDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error(`출력 PNG 데이터를 만들지 못했습니다: ${page.name}`);
    }
    const png = Buffer.from(pngDataUrl.slice("data:image/png;base64,".length), "base64");
    if (!png.length) {
      throw new Error(`출력 PNG를 만들지 못했습니다: ${page.name}`);
    }
    return png;
  } finally {
    win.destroy();
    await rm(htmlPath, { force: true }).catch(() => {});
  }
}

async function renderTallPageWithTranslationBlocksForExport(
  page: MangaPage,
  imageDataUrl: string,
  width: number,
  height: number,
  options: {
    dataRoot: string;
    showTextBlocks?: boolean;
    showBlockChrome?: boolean;
  }
): Promise<Buffer> {
  const tiles: Array<{ y: number; height: number; bitmap: Buffer }> = [];
  for (let y = 0; y < height; y += MAX_EXPORT_CANVAS_HEIGHT) {
    const tileHeight = Math.min(MAX_EXPORT_CANVAS_HEIGHT, height - y);
    const png = await renderPageExportTile(page, imageDataUrl, width, height, y, tileHeight, {
      dataRoot: options.dataRoot,
      showTextBlocks: options.showTextBlocks ?? true,
      showBlockChrome: options.showBlockChrome ?? true
    });
    const tileImage = nativeImage.createFromBuffer(png);
    if (tileImage.isEmpty()) {
      throw new Error(`출력 PNG 타일을 읽지 못했습니다: ${page.name}`);
    }
    const tileSize = tileImage.getSize();
    if (tileSize.width !== width || tileSize.height !== tileHeight) {
      throw new Error(`출력 PNG 타일 크기가 올바르지 않습니다: ${page.name}`);
    }
    tiles.push({ y, height: tileHeight, bitmap: tileImage.toBitmap() });
  }
  return stitchExportTilesToPng(tiles, width, height);
}

async function renderPageExportTile(
  page: MangaPage,
  imageDataUrl: string,
  width: number,
  height: number,
  tileY: number,
  tileHeight: number,
  options: {
    dataRoot: string;
    showTextBlocks: boolean;
    showBlockChrome: boolean;
  }
): Promise<Buffer> {
  const html = buildPageExportHtml(page, imageDataUrl, width, height, {
    showTextBlocks: options.showTextBlocks,
    showBlockChrome: options.showBlockChrome,
    tileY,
    tileHeight
  });
  const renderDir = join(options.dataRoot, "tmp", "png-export-render");
  await mkdir(renderDir, { recursive: true });
  const htmlPath = join(renderDir, `${page.id}-${randomUUID()}-${tileY}.html`);
  const win = new BrowserWindow({
    width: Math.min(1200, width),
    height: Math.min(1000, tileHeight),
    show: false,
    useContentSize: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      offscreen: true,
      backgroundThrottling: false
    }
  });

  try {
    await writeFile(htmlPath, html, "utf8");
    await win.loadFile(htmlPath);
    await waitForExportRenderReady(win);
    const pngDataUrl = await win.webContents.executeJavaScript("window.__exportPngDataUrl", true);
    if (typeof pngDataUrl !== "string" || !pngDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error(`출력 PNG 타일 데이터를 만들지 못했습니다: ${page.name}`);
    }
    const png = Buffer.from(pngDataUrl.slice("data:image/png;base64,".length), "base64");
    if (!png.length) {
      throw new Error(`출력 PNG 타일을 만들지 못했습니다: ${page.name}`);
    }
    return png;
  } finally {
    win.destroy();
    await rm(htmlPath, { force: true }).catch(() => {});
  }
}

export function sanitizeOutputBaseName(value: string): string {
  const raw = basename(value, extname(value)) || "page";
  const cleaned = raw.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return cleaned || "page";
}

async function loadImageForPngExport(imagePath: string, decodeFallback: ImageDecodeFallback): Promise<Electron.NativeImage> {
  const direct = nativeImage.createFromPath(imagePath);
  if (!direct.isEmpty()) {
    return direct;
  }

  const pngBuffer = await decodeFallback(imagePath);
  if (pngBuffer) {
    const converted = nativeImage.createFromBuffer(pngBuffer);
    if (!converted.isEmpty()) {
      return converted;
    }
  }

  throw new Error(`출력할 이미지를 읽지 못했습니다: ${imagePath}`);
}

function buildPageExportHtml(
  page: MangaPage,
  imageDataUrl: string,
  width: number,
  height: number,
  options: { showTextBlocks: boolean; showBlockChrome: boolean; tileY: number; tileHeight: number }
): string {
  const rendererCssHref = findRendererCssHref();
  const customFonts = listCustomFonts();
  const customFamilyById = new Map(customFonts.map((font) => [font.id, font.family]));
  const customFontFaces = buildCustomFontFaces(customFonts);
  const tileY = Math.max(0, Math.floor(options.tileY));
  const tileHeight = Math.max(1, Math.floor(options.tileHeight));
  const blocks = options.showTextBlocks
    ? buildPageExportBlocks(page, width, height, tileY, tileHeight, customFamilyById, options.showBlockChrome)
    : [];
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: file:; font-src data: file:; style-src 'unsafe-inline' file:; script-src 'unsafe-inline';" />
${rendererCssHref ? `<link rel="stylesheet" href="${escapeHtml(rendererCssHref)}" />` : ""}
<style>
${customFontFaces}
html, body {
  margin: 0;
  width: ${width}px;
  height: ${tileHeight}px;
  overflow: hidden;
  background: #fff;
}
body {
  font-family: "Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif;
}
.page-export-stage {
  position: relative;
  width: ${width}px;
  height: ${tileHeight}px;
  overflow: hidden;
  background: #fff;
}
.page-export-image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.page-export-block {
  position: absolute;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
  white-space: normal;
  font-weight: 600;
  transform-origin: center center;
}
.page-export-content {
  display: inline-block;
  box-sizing: border-box;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-break: keep-all;
}
.page-export-content.vertical {
  writing-mode: vertical-rl;
  text-orientation: upright;
  white-space: normal;
  word-break: normal;
}
</style>
</head>
<body>
<div class="page-export-stage" id="stage">
  <canvas id="exportCanvas" width="${width}" height="${tileHeight}" style="display:block;width:${width}px;height:${tileHeight}px"></canvas>
</div>
<script>
const EXPORT_BLOCKS = ${safeScriptJson(blocks)};
const EXPORT_IMAGE_DATA_URL = ${safeScriptJson(imageDataUrl)};
const EXPORT_FULL_WIDTH = ${width};
const EXPORT_FULL_HEIGHT = ${height};
const EXPORT_TILE_Y = ${tileY};
const MIN_FONT_SIZE = 10;
const MAX_AUTOFIT_FONT_SIZE = 256;
const AUTOFIT_ROOM_RATIO = 0.9;
const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function escapeText(value) {
  return String(value).replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[char]));
}

function buildFont(size, family, weight, italic) {
  return (italic ? "italic " : "") + (weight || 600) + " " + size + "px " + family;
}

function wrapTextToWidth(text, maxWidth, fontSize, fontFamily) {
  context.font = buildFont(fontSize, fontFamily);
  const paragraphs = String(text).replace(/\\r/g, "").split("\\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    const normalized = paragraph.replace(/\\s+/g, " ").trim();
    if (!normalized) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const char of Array.from(normalized)) {
      const candidate = current + char;
      if (!current || context.measureText(candidate).width <= maxWidth) {
        current = candidate;
        continue;
      }
      lines.push(current.trimEnd());
      current = /\\s/u.test(char) ? "" : char;
    }
    if (current) {
      lines.push(current.trimEnd());
    }
  }
  return lines.length ? lines : [String(text)];
}

function measureHorizontal(block, fontSize, innerWidth) {
  const lines = wrapTextToWidth(block.text, innerWidth, fontSize, block.fontFamily);
  context.font = buildFont(fontSize, block.fontFamily);
  return {
    lines,
    totalHeight: lines.length * fontSize * block.lineHeight,
    maxLineWidth: lines.reduce((widest, line) => Math.max(widest, context.measureText(line).width), 0)
  };
}

function fits(block, fontSize, innerWidth, innerHeight) {
  if (block.renderDirection === "vertical") {
    const compact = block.text.replace(/\\r/g, "").replace(/\\s+/g, "");
    if (!compact) return true;
    const charsPerColumn = Math.max(1, Math.floor(innerHeight / Math.max(fontSize, fontSize * block.lineHeight)));
    const columnCount = Math.max(1, Math.ceil(Array.from(compact).length / charsPerColumn));
    return columnCount <= 2 && columnCount * fontSize * 1.15 <= innerWidth;
  }
  const measured = measureHorizontal(block, fontSize, innerWidth);
  return measured.totalHeight <= innerHeight && measured.maxLineWidth <= innerWidth;
}

function resolveFontSize(block, innerWidth, innerHeight) {
  const preferred = Math.max(MIN_FONT_SIZE, Math.floor(block.fontSizePx));
  if (!block.autoFitText || !block.text.trim()) {
    return preferred;
  }
  const heightBound = Math.floor(innerHeight / Math.max(1, block.lineHeight || 1));
  const widthBound = block.renderDirection === "vertical" ? Math.floor(innerWidth / 1.15) : MAX_AUTOFIT_FONT_SIZE;
  const capped = clamp(Math.max(MIN_FONT_SIZE, heightBound, widthBound), MIN_FONT_SIZE, MAX_AUTOFIT_FONT_SIZE);
  let low = MIN_FONT_SIZE;
  let high = Math.floor(capped);
  let best = MIN_FONT_SIZE;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (fits(block, mid, innerWidth, innerHeight)) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const fitted = Math.min(best, capped);
  return fitted <= MIN_FONT_SIZE ? MIN_FONT_SIZE : Math.max(MIN_FONT_SIZE, Math.floor(fitted * AUTOFIT_ROOM_RATIO));
}

function resolveOutlineShadow(fontSize, color, scale) {
  const radius = Math.round(Math.min(4, Math.max(0.35, fontSize * 0.055)) * (scale == null ? 1 : scale) * 10) / 10;
  const half = Math.round(radius * 0.55 * 10) / 10;
  return [[0, -radius], [radius, 0], [0, radius], [-radius, 0], [radius, -radius], [radius, radius], [-radius, radius], [-radius, -radius], [half, -half], [half, half], [-half, half], [-half, -half]]
    .map(([x, y]) => x + "px " + y + "px 0 " + color)
    .join(", ");
}

function resolveOutlineWidth(fontSize) {
  return Math.round(Math.min(4, Math.max(0.35, fontSize * 0.055)) * 2 * 10) / 10;
}

function drawOutlinedText(ctx, text, x, y, block, fontSize) {
  const outlineScale = block.outlineWidthScale == null ? 1 : block.outlineWidthScale;
  const outlineWidthPx = block.outlineWidthPx == null ? resolveOutlineWidth(fontSize) * outlineScale : block.outlineWidthPx;
  ctx.fillStyle = block.textColor;
  if (outlineWidthPx > 0) {
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = outlineWidthPx;
    ctx.strokeStyle = block.outlineColor;
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
}

function drawHorizontalText(ctx, block, rect, fontSize) {
  const innerWidth = Math.max(1, rect.width - 2);
  const measured = measureHorizontal(block, fontSize, innerWidth);
  const lineHeightPx = fontSize * block.lineHeight;
  const totalHeight = measured.lines.length * lineHeightPx;
  const startY = rect.top + Math.max(0, (rect.height - totalHeight) / 2);
  const align = block.textAlign || "center";
  const x = align === "left" ? rect.left + 1 : align === "right" ? rect.left + rect.width - 1 : rect.left + rect.width / 2;
  ctx.font = buildFont(fontSize, block.fontFamily, block.bold ? 800 : 400, block.italic);
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  for (const [index, line] of measured.lines.entries()) {
    drawOutlinedText(ctx, line, x, startY + index * lineHeightPx, block, fontSize);
  }
}

function drawVerticalText(ctx, block, rect, fontSize) {
  const compact = block.text.replace(/\\r/g, "").replace(/\\s+/g, "");
  if (!compact) {
    return;
  }
  const chars = Array.from(compact);
  const lineHeightPx = fontSize * block.lineHeight;
  const charsPerColumn = Math.max(1, Math.floor(Math.max(1, rect.height - 2) / lineHeightPx));
  const columns = [];
  for (let index = 0; index < chars.length; index += charsPerColumn) {
    columns.push(chars.slice(index, index + charsPerColumn));
  }
  const columnGap = fontSize * 1.15;
  const totalWidth = Math.max(columnGap, columns.length * columnGap);
  const firstX = rect.left + rect.width / 2 + totalWidth / 2 - columnGap / 2;
  ctx.font = buildFont(fontSize, block.fontFamily, block.bold ? 800 : 400, block.italic);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const [columnIndex, column] of columns.entries()) {
    const x = firstX - columnIndex * columnGap;
    const columnHeight = column.length * lineHeightPx;
    const startY = rect.top + Math.max(0, (rect.height - columnHeight) / 2);
    for (const [rowIndex, char] of column.entries()) {
      drawOutlinedText(ctx, char, x, startY + rowIndex * lineHeightPx, block, fontSize);
    }
  }
}

function drawExportBlock(ctx, block) {
  const rect = block.rect;
  const innerWidth = Math.max(1, rect.width - 2);
  const innerHeight = Math.max(1, rect.height - 2);
  const fontSize = resolveFontSize(block, innerWidth, innerHeight);
  ctx.save();
  let drawRect = rect;
  if (block.rotationDeg) {
    ctx.translate(rect.left + rect.width / 2, rect.top + rect.height / 2);
    ctx.rotate((block.rotationDeg * Math.PI) / 180);
    drawRect = { left: -rect.width / 2, top: -rect.height / 2, width: rect.width, height: rect.height };
  }
  if (block.showChrome) {
    ctx.fillStyle = block.backgroundRgba;
    fillRoundedRect(ctx, drawRect.left, drawRect.top, drawRect.width, drawRect.height, block.cornerRadiusPx);
  }
  if (block.renderDirection === "vertical") {
    drawVerticalText(ctx, block, drawRect, fontSize);
  } else {
    drawHorizontalText(ctx, block, drawRect, fontSize);
  }
  ctx.restore();
}

function fillRoundedRect(ctx, left, top, width, height, radius) {
  const resolvedRadius = Math.max(0, Math.min(Number(radius) || 0, width / 2, height / 2));
  if (resolvedRadius <= 0) {
    ctx.fillRect(left, top, width, height);
    return;
  }
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(left, top, width, height, resolvedRadius);
  } else {
    ctx.moveTo(left + resolvedRadius, top);
    ctx.lineTo(left + width - resolvedRadius, top);
    ctx.quadraticCurveTo(left + width, top, left + width, top + resolvedRadius);
    ctx.lineTo(left + width, top + height - resolvedRadius);
    ctx.quadraticCurveTo(left + width, top + height, left + width - resolvedRadius, top + height);
    ctx.lineTo(left + resolvedRadius, top + height);
    ctx.quadraticCurveTo(left, top + height, left, top + height - resolvedRadius);
    ctx.lineTo(left, top + resolvedRadius);
    ctx.quadraticCurveTo(left, top, left + resolvedRadius, top);
  }
  ctx.fill();
}

function loadExportImage() {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("export image load failed"));
    image.src = EXPORT_IMAGE_DATA_URL;
  });
}

async function renderCanvasPng() {
  const outputCanvas = document.getElementById("exportCanvas");
  const ctx = outputCanvas.getContext("2d");
  if (!ctx) {
    throw new Error("canvas context unavailable");
  }
  const image = await loadExportImage();
  ctx.clearRect(0, 0, outputCanvas.width, outputCanvas.height);
  ctx.drawImage(image, 0, -EXPORT_TILE_Y, EXPORT_FULL_WIDTH, EXPORT_FULL_HEIGHT);
  for (const block of EXPORT_BLOCKS) {
    drawExportBlock(ctx, block);
  }
  window.__exportPngDataUrl = outputCanvas.toDataURL("image/png");
}

function renderBlocks() {
  const stage = document.getElementById("stage");
  for (const block of EXPORT_BLOCKS) {
    const root = document.createElement("div");
    root.className = "page-export-block";
    root.style.left = block.rect.left + "px";
    root.style.top = block.rect.top + "px";
    root.style.width = block.rect.width + "px";
    root.style.height = block.rect.height + "px";
    root.style.color = block.textColor;
    root.style.fontFamily = block.fontFamily;
    root.style.fontWeight = block.bold ? "800" : "400";
    root.style.fontStyle = block.italic ? "italic" : "normal";
    root.style.fontSynthesis = "weight style";
    root.style.lineHeight = String(block.lineHeight);
    root.style.textAlign = block.textAlign;
    if (block.rotationDeg) {
      root.style.transform = "rotate(" + block.rotationDeg + "deg)";
    }

    const innerWidth = Math.max(1, block.rect.width - 2);
    const innerHeight = Math.max(1, block.rect.height - 2);
    const fontSize = resolveFontSize(block, innerWidth, innerHeight);
    root.style.fontSize = fontSize + "px";

    const content = document.createElement("span");
    content.className = "page-export-content" + (block.renderDirection === "vertical" ? " vertical" : "");
    content.style.textShadow =
      block.outlineWidthScale != null && block.outlineWidthScale <= 0 ? "none" : resolveOutlineShadow(fontSize, block.outlineColor, block.outlineWidthScale);
    if (block.renderDirection === "vertical") {
      content.textContent = block.text.replace(/\\r/g, "").replace(/\\s+/g, "");
      content.style.height = Math.min(innerHeight, Math.max(1, Array.from(content.textContent).length * fontSize * block.lineHeight)) + "px";
      content.style.maxHeight = "100%";
    } else {
      const lines = measureHorizontal(block, fontSize, innerWidth).lines;
      content.innerHTML = lines.map(escapeText).join("<br>");
      content.style.width = innerWidth + "px";
      content.style.maxWidth = "100%";
    }
    root.appendChild(content);
    stage.appendChild(root);
  }
}

async function preloadExportFonts() {
  if (!document.fonts) {
    return;
  }
  const loads = [];
  for (const block of EXPORT_BLOCKS) {
    const size = Math.max(MIN_FONT_SIZE, Math.floor(block.fontSizePx || 20));
    loads.push(document.fonts.load("400 " + size + "px " + block.fontFamily));
    loads.push(document.fonts.load("600 " + size + "px " + block.fontFamily));
    loads.push(document.fonts.load("700 " + size + "px " + block.fontFamily));
    loads.push(document.fonts.load("800 " + size + "px " + block.fontFamily));
    loads.push(document.fonts.load("italic 400 " + size + "px " + block.fontFamily));
  }
  await Promise.all(loads.map((load) => load.catch(() => [])));
  await document.fonts.ready;
}

window.addEventListener("load", async () => {
  await preloadExportFonts();
  await renderCanvasPng();
  if (document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.dataset.ready = "1";
  }));
});
</script>
</body>
</html>`;
}

function buildCustomFontFaces(fonts: CustomFont[]): string {
  const fontsDir = getAppPaths().fontsDir;
  return fonts
    .map((font) => {
      const fileUrl = pathToFileURL(join(fontsDir, font.fileName)).toString();
      return `@font-face { font-family: "${font.family}"; src: url("${fileUrl}"); font-display: swap; }`;
    })
    .join("\n");
}

function buildPageExportBlocks(
  page: MangaPage,
  outputWidth: number,
  outputHeight: number,
  tileY: number,
  tileHeight: number,
  customFamilyById: Map<string, string>,
  showChrome: boolean
): PageExportBlock[] {
  const pageWidth = Math.max(1, page.width || outputWidth);
  const pageHeight = Math.max(1, page.height || outputHeight);
  const scaleX = outputWidth / pageWidth;
  const scaleY = outputHeight / pageHeight;
  const fontScale = Math.min(scaleX, scaleY);
  return page.blocks
    .map((block) =>
      buildPageExportBlock(
        block,
        { width: pageWidth, height: pageHeight },
        scaleX,
        scaleY,
        fontScale,
        tileY,
        tileHeight,
        customFamilyById,
        showChrome
      )
    )
    .filter((block): block is PageExportBlock => Boolean(block));
}

type PageExportBlock = {
  text: string;
  rect: { left: number; top: number; width: number; height: number };
  renderDirection: "horizontal" | "vertical" | "rotated";
  rotationDeg: number;
  fontFamily: string;
  fontSizePx: number;
  lineHeight: number;
  textAlign: "left" | "center" | "right";
  textColor: string;
  outlineColor: string;
  bold: boolean;
  italic: boolean;
  outlineWidthPx?: number;
  outlineWidthScale: number;
  autoFitText: boolean;
  showChrome: boolean;
  backgroundRgba: string;
  cornerRadiusPx: number;
};

function buildPageExportBlock(
  block: TranslationBlock,
  pageSize: { width: number; height: number },
  scaleX: number,
  scaleY: number,
  fontScale: number,
  tileY: number,
  tileHeight: number,
  customFamilyById: Map<string, string>,
  showChrome: boolean
): PageExportBlock | null {
  if (block.renderDirection === "hidden") {
    return null;
  }
  const text = block.translatedText || block.sourceText || "";
  if (!text.trim()) {
    return null;
  }
  const renderBbox = resolveBlockRenderBbox(block, pageSize);
  const rect = bboxToPixels(renderBbox, pageSize.width, pageSize.height);
  const scaledTop = rect.y * scaleY;
  const scaledHeight = Math.max(1, rect.h * scaleY);
  if (scaledTop + scaledHeight < tileY || scaledTop > tileY + tileHeight) {
    return null;
  }
  return {
    text,
    rect: {
      left: rect.x * scaleX,
      top: scaledTop - tileY,
      width: Math.max(1, rect.w * scaleX),
      height: scaledHeight
    },
    renderDirection: block.renderDirection === "vertical" ? "vertical" : block.renderDirection === "rotated" ? "rotated" : "horizontal",
    rotationDeg: block.rotationDeg ? clamp(Math.round(block.rotationDeg), -30, 30) : 0,
    fontFamily: resolveExportBlockFontFamily(block.fontFamily, customFamilyById),
    fontSizePx: Math.max(10, Math.round((block.fontSizePx || 20) * fontScale)),
    lineHeight: Math.max(1, block.lineHeight || 1.18),
    textAlign: block.textAlign || "center",
    textColor: normalizeExportColor(block.textColor, "#000000"),
    outlineColor: normalizeExportColor(block.outlineColor, "#ffffff"),
    bold: Boolean(block.bold),
    italic: Boolean(block.italic),
    outlineWidthPx: block.outlineWidthPx == null ? undefined : Math.max(0, block.outlineWidthPx * fontScale),
    outlineWidthScale: block.outlineWidthScale == null ? 1 : Math.max(0, block.outlineWidthScale),
    autoFitText: block.autoFitText ?? false,
    showChrome,
    backgroundRgba: buildRgbaColor(normalizeExportColor(block.backgroundColor, "#ffffff"), clamp(block.opacity ?? 1, 0, 1)),
    cornerRadiusPx: resolveBlockCornerRadiusPx(rect.w * scaleX, scaledHeight)
  };
}

function resolveExportBlockFontFamily(value: string | undefined, customFamilyById?: Map<string, string>): string {
  if (value && customFamilyById?.has(value)) {
    return `"${customFamilyById.get(value)}", "Malgun Gothic", sans-serif`;
  }
  switch (value) {
    case "mongtori":
      return '"MGT Mongtori", "Malgun Gothic", sans-serif';
    case "chosun-gungseo":
      return '"MGT Chosun Gungseo", "Malgun Gothic", serif';
    case "griun-pol-sensibility":
      return '"MGT Griun Pol Sensibility", "Malgun Gothic", sans-serif';
    case "nanum-gothic":
      return '"MGT Nanum Gothic", "Malgun Gothic", sans-serif';
    case "nanum-myeongjo":
      return '"MGT Nanum Myeongjo", "Malgun Gothic", serif';
    case "nanum-barun-gothic":
      return '"MGT Nanum Barun Gothic", "Malgun Gothic", sans-serif';
    case "seoul-namsan":
      return '"MGT Seoul Namsan", "Malgun Gothic", sans-serif';
    case "seoul-namsan-vertical":
      return '"MGT Seoul Namsan Vertical", "Malgun Gothic", sans-serif';
    case "seoul-hangang":
      return '"MGT Seoul Hangang", "Malgun Gothic", serif';
    default:
      return '"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif';
  }
}

function normalizeExportColor(value: string | undefined, fallback: string): string {
  const text = String(value ?? "").trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function buildRgbaColor(hex: string, alpha: number): string {
  const normalized = normalizeExportColor(hex, "#ffffff");
  const r = Number.parseInt(normalized.slice(1, 3), 16);
  const g = Number.parseInt(normalized.slice(3, 5), 16);
  const b = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function findRendererCssHref(): string | null {
  const rendererDir = join(__dirname, "../renderer");
  const rendererIndexPath = join(rendererDir, "index.html");
  if (existsSync(rendererIndexPath)) {
    const html = readFileSync(rendererIndexPath, "utf8");
    const match = html.match(/<link[^>]+href=["']([^"']+index-[^"']+\.css)["']/i);
    if (match?.[1]) {
      const cssPath = join(rendererDir, match[1].replace(/^\.\//, ""));
      if (existsSync(cssPath)) {
        return pathToFileURL(cssPath).toString();
      }
    }
  }

  const assetDir = join(__dirname, "../renderer/assets");
  if (existsSync(assetDir)) {
    const cssFile = readdirSync(assetDir)
      .filter((file) => /^index-.*\.css$/i.test(file))
      .sort()
      .at(-1);
    if (cssFile) {
      return pathToFileURL(join(assetDir, cssFile)).toString();
    }
  }

  const sourceCssPath = join(process.cwd(), "src", "renderer", "src", "styles.css");
  return existsSync(sourceCssPath) ? pathToFileURL(sourceCssPath).toString() : null;
}

async function waitForExportRenderReady(win: BrowserWindow): Promise<void> {
  await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        if (document.body && document.body.dataset.ready === "1") {
          resolve(true);
          return;
        }
        if (Date.now() - startedAt > 15000) {
          reject(new Error("PNG export render timeout"));
          return;
        }
        setTimeout(tick, 40);
      };
      tick();
    })
  `);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return char;
    }
  });
}

function safeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function stitchExportTilesToPng(
  tiles: Array<{ y: number; height: number; bitmap: Buffer }>,
  width: number,
  height: number
): Buffer {
  const rowBytes = width * 4;
  const filtered = Buffer.alloc((rowBytes + 1) * height);
  for (const tile of tiles) {
    for (let y = 0; y < tile.height; y += 1) {
      const targetY = tile.y + y;
      if (targetY < 0 || targetY >= height) {
        continue;
      }
      const sourceStart = y * rowBytes;
      const targetStart = targetY * (rowBytes + 1);
      filtered[targetStart] = 0;
      copyBitmapBgraToPngRgba(tile.bitmap, filtered, sourceStart, targetStart + 1, width);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(filtered)),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
}

function copyBitmapBgraToPngRgba(source: Buffer, target: Buffer, sourceStart: number, targetStart: number, width: number): void {
  for (let x = 0; x < width; x += 1) {
    const sourceOffset = sourceStart + x * 4;
    const targetOffset = targetStart + x * 4;
    target[targetOffset] = source[sourceOffset + 2] ?? 255;
    target[targetOffset + 1] = source[sourceOffset + 1] ?? 255;
    target[targetOffset + 2] = source[sourceOffset] ?? 255;
    target[targetOffset + 3] = source[sourceOffset + 3] ?? 255;
  }
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  const checksum = crc32(Buffer.concat([typeBuffer, data]));
  chunk.writeUInt32BE(checksum >>> 0, 8 + data.length);
  return chunk;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
