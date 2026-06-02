import { nativeImage } from "electron";
import {
  FLAT_BACKGROUND_OPACITY,
  sampleBlockBackgroundsFromBitmap,
  type BlockBackgroundSampleInput,
  type BlockBackgroundSampleResult
} from "../../shared/blockBackground";
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

  return sampleBlockBackgroundsFromBitmap(
    bitmapData.bitmap,
    bitmapData.width,
    bitmapData.height,
    pageWidth,
    pageHeight,
    blocks
  );
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
