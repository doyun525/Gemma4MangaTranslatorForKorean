import { nativeImage } from "electron";
import {
  FLAT_BACKGROUND_OPACITY,
  sampleBlockBackgroundsFromBitmap,
  type BlockBackgroundSampleInput,
  type BlockBackgroundSampleResult
} from "../../shared/blockBackground";
import { logInfo } from "../logger";
import type { MangaPage, TranslationBlock } from "../../shared/types";

export async function applySampledBackgroundColors(blocks: TranslationBlock[], page: MangaPage): Promise<TranslationBlock[]> {
  if (blocks.length === 0) {
    return blocks;
  }

  const bitmapData = await loadPageBitmap(page.imagePath);
  if (!bitmapData) {
    return blocks;
  }

  const samples = sampleBlockBackgroundsFromBitmap(
    bitmapData.bitmap,
    bitmapData.width,
    bitmapData.height,
    page.width,
    page.height,
    blocks.map((block) => ({ id: block.id, bbox: block.bbox }))
  );
  logBackgroundSampleSummary("pipeline", page.imagePath, page.width, page.height, samples);
  const sampleById = new Map(samples.map((sample) => [sample.id, sample]));

  return blocks.map((block) => applySampleToBlock(block, sampleById.get(block.id)));
}

export async function sampleBlockBackgrounds(
  imagePath: string,
  pageWidth: number,
  pageHeight: number,
  blocks: BlockBackgroundSampleInput[]
): Promise<BlockBackgroundSampleResult[]> {
  if (blocks.length === 0) {
    return [];
  }

  const bitmapData = await loadPageBitmap(imagePath);
  if (!bitmapData) {
    return blocks.map((block) => ({ id: block.id, flat: false }));
  }

  const results = sampleBlockBackgroundsFromBitmap(
    bitmapData.bitmap,
    bitmapData.width,
    bitmapData.height,
    pageWidth,
    pageHeight,
    blocks
  );
  logBackgroundSampleSummary("manual", imagePath, pageWidth, pageHeight, results);
  return results;
}

function applySampleToBlock(block: TranslationBlock, sample: BlockBackgroundSampleResult | undefined): TranslationBlock {
  if (!sample?.flat || !sample.backgroundColor) {
    return block;
  }

  return {
    ...block,
    backgroundColor: sample.backgroundColor,
    opacity: Math.max(block.opacity, FLAT_BACKGROUND_OPACITY)
  };
}

async function loadPageBitmap(imagePath: string): Promise<{ bitmap: Buffer; width: number; height: number } | null> {
  const image = nativeImage.createFromPath(imagePath);
  if (image.isEmpty()) {
    return null;
  }

  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length === 0 || size.width <= 0 || size.height <= 0) {
    return null;
  }

  return { bitmap, width: size.width, height: size.height };
}

function logBackgroundSampleSummary(
  source: "pipeline" | "manual",
  imagePath: string,
  pageWidth: number,
  pageHeight: number,
  samples: BlockBackgroundSampleResult[]
): void {
  const flatCount = samples.filter((sample) => sample.flat).length;
  const failed = samples.filter((sample) => !sample.flat).slice(0, 12);
  logInfo("Block background sampling completed", {
    source,
    imagePath,
    pageWidth,
    pageHeight,
    blockCount: samples.length,
    flatCount,
    failedCount: samples.length - flatCount,
    failed
  });
}
