import { clamp } from "./geometry";
import type { BBox } from "./types";

export type Rgb = { r: number; g: number; b: number };

export type SampledBackground = {
  color: Rgb;
  flat: boolean;
  dominance: number;
  maxStddev: number;
};

export type BlockBackgroundSampleInput = {
  id: string;
  bbox: BBox;
};

export type BlockBackgroundSampleResult = {
  id: string;
  flat: boolean;
  backgroundColor?: string;
};

export const FLAT_BACKGROUND_OPACITY = 0.96;

export function estimateBackgroundFromBitmap(
  bitmap: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  blockBbox: BBox,
  pageWidth: number,
  pageHeight: number
): SampledBackground | null {
  const rect = blockBboxToImageRect(blockBbox, pageWidth, pageHeight, imageWidth, imageHeight);
  if (!rect || rect.w < 3 || rect.h < 3) {
    return null;
  }

  const samples: Rgb[] = [];
  const step = Math.max(1, Math.floor(Math.max(rect.w, rect.h) / 96));
  for (let y = rect.y; y < rect.y + rect.h; y += step) {
    for (let x = rect.x; x < rect.x + rect.w; x += step) {
      samples.push(readRgb(bitmap, imageWidth, x, y));
    }
  }
  if (samples.length < 12) {
    return null;
  }

  const buckets = new Map<string, Rgb[]>();
  for (const sample of samples) {
    const key = `${Math.round(sample.r / 24)},${Math.round(sample.g / 24)},${Math.round(sample.b / 24)}`;
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(sample);
    } else {
      buckets.set(key, [sample]);
    }
  }

  const dominant = [...buckets.values()].sort((left, right) => right.length - left.length)[0] ?? [];
  if (dominant.length === 0) {
    return null;
  }

  const color = {
    r: median(dominant.map((sample) => sample.r)),
    g: median(dominant.map((sample) => sample.g)),
    b: median(dominant.map((sample) => sample.b))
  };
  const stddev = colorStddev(dominant, color);
  const maxStddev = Math.max(stddev.r, stddev.g, stddev.b);
  const dominance = dominant.length / samples.length;
  return {
    color,
    dominance,
    maxStddev,
    flat: dominance >= 0.56 && maxStddev <= 18
  };
}

export function sampleBlockBackgroundsFromBitmap(
  bitmap: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  pageWidth: number,
  pageHeight: number,
  blocks: BlockBackgroundSampleInput[]
): BlockBackgroundSampleResult[] {
  return blocks.map((block) => {
    const sampled = estimateBackgroundFromBitmap(bitmap, imageWidth, imageHeight, block.bbox, pageWidth, pageHeight);
    if (!sampled?.flat) {
      return { id: block.id, flat: false };
    }
    return {
      id: block.id,
      flat: true,
      backgroundColor: rgbToHex(sampled.color)
    };
  });
}

export function rgbToHex(color: Rgb): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function blockBboxToImageRect(blockBbox: BBox, pageWidth: number, pageHeight: number, imageWidth: number, imageHeight: number): BBox | null {
  const scaleX = imageWidth / Math.max(1, pageWidth);
  const scaleY = imageHeight / Math.max(1, pageHeight);
  const pageX = (blockBbox.x / 1000) * pageWidth;
  const pageY = (blockBbox.y / 1000) * pageHeight;
  const pageW = (blockBbox.w / 1000) * pageWidth;
  const pageH = (blockBbox.h / 1000) * pageHeight;
  const x1 = Math.max(0, Math.floor(pageX * scaleX));
  const y1 = Math.max(0, Math.floor(pageY * scaleY));
  const x2 = Math.min(imageWidth, Math.ceil((pageX + pageW) * scaleX));
  const y2 = Math.min(imageHeight, Math.ceil((pageY + pageH) * scaleY));
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function readRgb(bitmap: Uint8Array, width: number, x: number, y: number): Rgb {
  const offset = (y * width + x) * 4;
  return {
    b: bitmap[offset] ?? 0,
    g: bitmap[offset + 1] ?? 0,
    r: bitmap[offset + 2] ?? 0
  };
}

function toHex(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function colorStddev(samples: Rgb[], center: Rgb): Rgb {
  const sum = samples.reduce(
    (acc, sample) => ({
      r: acc.r + (sample.r - center.r) ** 2,
      g: acc.g + (sample.g - center.g) ** 2,
      b: acc.b + (sample.b - center.b) ** 2
    }),
    { r: 0, g: 0, b: 0 }
  );
  const count = Math.max(1, samples.length);
  return {
    r: Math.sqrt(sum.r / count),
    g: Math.sqrt(sum.g / count),
    b: Math.sqrt(sum.b / count)
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return Math.round(sorted[Math.floor(sorted.length / 2)] ?? 0);
}
