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
  reason?: string;
  dominance?: number;
  maxStddev?: number;
  sampleCount?: number;
  sampledColor?: Rgb;
  sampledHex?: string;
  luminance?: number;
  imageRect?: BBox;
  candidates?: BackgroundCandidateDiagnostic[];
};

export const FLAT_BACKGROUND_OPACITY = 0.96;
export const DOMINANT_BACKGROUND_MIN_RATIO = 0.5;
export const BRIGHT_PAPER_BACKGROUND_MIN_RATIO = 0.7;

export type BackgroundCandidateDiagnostic = {
  kind: "bucket" | "bright-paper";
  color: Rgb;
  hex: string;
  dominance: number;
  maxStddev: number;
  luminance: number;
  accepted: boolean;
};

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
    flat: dominance >= DOMINANT_BACKGROUND_MIN_RATIO && maxStddev <= 18
  };
}

function estimateBackgroundWithReason(
  bitmap: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  blockBbox: BBox,
  pageWidth: number,
  pageHeight: number
): (SampledBackground & {
  sampleCount: number;
  reason?: string;
  imageRect: BBox;
  candidates: BackgroundCandidateDiagnostic[];
}) | { reason: string; sampleCount?: number; imageRect?: BBox; candidates?: BackgroundCandidateDiagnostic[] } {
  const rect = blockBboxToImageRect(blockBbox, pageWidth, pageHeight, imageWidth, imageHeight);
  if (!rect || rect.w < 3 || rect.h < 3) {
    return { reason: "bbox-too-small" };
  }

  const samples: Rgb[] = [];
  const step = Math.max(1, Math.floor(Math.max(rect.w, rect.h) / 96));
  for (let y = rect.y; y < rect.y + rect.h; y += step) {
    for (let x = rect.x; x < rect.x + rect.w; x += step) {
      samples.push(readRgb(bitmap, imageWidth, x, y));
    }
  }
  if (samples.length < 12) {
    return { reason: "too-few-samples", sampleCount: samples.length };
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

  const candidates = buildBackgroundCandidates([...buckets.values()], samples.length);
  const dominant = chooseBackgroundBucket([...buckets.values()], samples.length);
  if (!dominant) {
    return { reason: "no-dominant-bucket", sampleCount: samples.length, imageRect: rect, candidates: candidates.slice(0, 5) };
  }

  const dominantSamples = dominant.samples;
  const color = {
    r: median(dominantSamples.map((sample) => sample.r)),
    g: median(dominantSamples.map((sample) => sample.g)),
    b: median(dominantSamples.map((sample) => sample.b))
  };
  const stddev = colorStddev(dominantSamples, color);
  const maxStddev = Math.max(stddev.r, stddev.g, stddev.b);
  const dominance = dominantSamples.length / samples.length;
  const flat = dominant.accepted;
  return {
    color,
    dominance,
    maxStddev,
    flat,
    sampleCount: samples.length,
    imageRect: rect,
    candidates: candidates.slice(0, 5),
    reason: flat ? undefined : dominance < DOMINANT_BACKGROUND_MIN_RATIO ? "low-dominance" : "high-variance"
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
    const sampled = estimateBackgroundWithReason(bitmap, imageWidth, imageHeight, block.bbox, pageWidth, pageHeight);
    if (!("flat" in sampled) || !sampled.flat) {
      return {
        id: block.id,
        flat: false,
        reason: sampled.reason,
        dominance: "dominance" in sampled ? sampled.dominance : undefined,
        maxStddev: "maxStddev" in sampled ? sampled.maxStddev : undefined,
        sampleCount: sampled.sampleCount,
        sampledColor: "color" in sampled ? sampled.color : undefined,
        sampledHex: "color" in sampled ? rgbToHex(sampled.color) : undefined,
        luminance: "color" in sampled ? rgbLuminance(sampled.color) : undefined,
        imageRect: sampled.imageRect,
        candidates: sampled.candidates
      };
    }
    return {
      id: block.id,
      flat: true,
      dominance: sampled.dominance,
      maxStddev: sampled.maxStddev,
      sampleCount: sampled.sampleCount,
      sampledColor: sampled.color,
      sampledHex: rgbToHex(sampled.color),
      luminance: rgbLuminance(sampled.color),
      imageRect: sampled.imageRect,
      candidates: sampled.candidates,
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

function chooseBackgroundBucket(buckets: Rgb[][], sampleCount: number): { samples: Rgb[]; accepted: boolean } | null {
  const candidates = buildBackgroundCandidates(buckets, sampleCount);
  const best = candidates[0];
  return best ? { samples: best.samples, accepted: best.accepted } : null;
}

function buildBackgroundCandidates(buckets: Rgb[][], sampleCount: number): Array<BackgroundCandidateDiagnostic & { samples: Rgb[] }> {
  const candidates: Array<BackgroundCandidateDiagnostic & { samples: Rgb[] }> = buckets
    .filter((bucket) => bucket.length > 0)
    .map((bucket) => {
      const color = {
        r: median(bucket.map((sample) => sample.r)),
        g: median(bucket.map((sample) => sample.g)),
        b: median(bucket.map((sample) => sample.b))
      };
      const stddev = colorStddev(bucket, color);
      const maxStddev = Math.max(stddev.r, stddev.g, stddev.b);
      const dominance = bucket.length / Math.max(1, sampleCount);
      const luminance = rgbLuminance(color);
      const accepted =
        (dominance >= DOMINANT_BACKGROUND_MIN_RATIO && maxStddev <= 18) ||
        (luminance >= 190 && dominance >= BRIGHT_PAPER_BACKGROUND_MIN_RATIO && maxStddev <= 24);
      return { kind: "bucket" as const, samples: bucket, color, hex: rgbToHex(color), dominance, maxStddev, luminance, accepted };
    });

  const brightPaperSamples = collectBrightPaperSamples(buckets.flat());
  if (brightPaperSamples.length > 0) {
    const color = {
      r: median(brightPaperSamples.map((sample) => sample.r)),
      g: median(brightPaperSamples.map((sample) => sample.g)),
      b: median(brightPaperSamples.map((sample) => sample.b))
    };
    const stddev = colorStddev(brightPaperSamples, color);
    const maxStddev = Math.max(stddev.r, stddev.g, stddev.b);
    const dominance = brightPaperSamples.length / Math.max(1, sampleCount);
    const luminance = rgbLuminance(color);
    candidates.push({
      kind: "bright-paper",
      samples: brightPaperSamples,
      color,
      hex: rgbToHex(color),
      dominance,
      maxStddev,
      luminance,
      accepted: luminance >= 185 && dominance >= BRIGHT_PAPER_BACKGROUND_MIN_RATIO && maxStddev <= 32
    });
  }

  const sorted = candidates
    .sort((left, right) => {
      if (left.accepted !== right.accepted) {
        return left.accepted ? -1 : 1;
      }
      return right.dominance - left.dominance || right.luminance - left.luminance;
    });
  return sorted;
}

function collectBrightPaperSamples(samples: Rgb[]): Rgb[] {
  return samples.filter((sample) => {
    const max = Math.max(sample.r, sample.g, sample.b);
    const min = Math.min(sample.r, sample.g, sample.b);
    const luminance = rgbLuminance(sample);
    return luminance >= 175 && max - min <= 58;
  });
}

function rgbLuminance(color: Rgb): number {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
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
