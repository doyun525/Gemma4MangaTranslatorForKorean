import type { TranslationOptions } from "./appSettings";
import {
  DEFAULT_LLM_VRAM_HEADROOM_MB,
  buildLlmVramFingerprint,
  parseLlmCudaModelBufferMbFromLogLine,
  parseLlmProjectedVramMbFromLogLine,
  resolveEstimatedLlmVramMb,
  resolveRequiredFreeVramMb,
  shouldReleaseOcrBeforeLlm,
  type GpuVramSnapshotLike
} from "../shared/llmVramBudget";
import { loadLlmVramProjection, saveLlmVramProjection } from "./llmVramProjectionCache";
import { readNumberEnv } from "./pipeline/options";

export type LlmVramBudget = {
  fingerprint: string;
  estimatedLlmMb: number;
  headroomMb: number;
  legacyMinFreeMb: number;
  requiredFreeMb: number;
  cachedProjectedMb: number | null;
  cachedModelBufferMb: number | null;
};

export type LlmVramLogCapture = {
  projectedMb: number | null;
  modelBufferMb: number | null;
};

export function resolveLlmVramHeadroomMb(): number {
  return readNumberEnv("MANGA_TRANSLATOR_LLM_VRAM_HEADROOM_MB", DEFAULT_LLM_VRAM_HEADROOM_MB);
}

export function buildLlmVramFingerprintFromOptions(options: TranslationOptions): string {
  return buildLlmVramFingerprint({
    modelRepo: options.modelRepo,
    modelFile: options.modelFile,
    gemmaVramMode: options.gemmaVramMode,
    ctx: options.ctx,
    batch: options.batch,
    ubatch: options.ubatch,
    fitTargetMb: options.fitTargetMb,
    kvOffload: options.kvOffload,
    mmprojOffload: options.mmprojOffload,
    useDraft: options.useDraft,
    gpuLayers: options.gpuLayers
  });
}

export async function resolveLlmVramBudgetForOptions(options: TranslationOptions): Promise<LlmVramBudget> {
  const fingerprint = buildLlmVramFingerprintFromOptions(options);
  const cached = await loadLlmVramProjection(fingerprint);
  const headroomMb = resolveLlmVramHeadroomMb();
  const legacyMinFreeMb = readNumberEnv("MANGA_TRANSLATOR_GPU_KEEP_BOTH_MIN_FREE_MB", 0);
  const estimatedLlmMb = resolveEstimatedLlmVramMb({
    cachedProjectedMb: cached?.projectedMb,
    cachedModelBufferMb: cached?.modelBufferMb
  });
  return {
    fingerprint,
    estimatedLlmMb,
    headroomMb,
    legacyMinFreeMb,
    requiredFreeMb: resolveRequiredFreeVramMb(estimatedLlmMb, headroomMb, legacyMinFreeMb),
    cachedProjectedMb: cached?.projectedMb ?? null,
    cachedModelBufferMb: cached?.modelBufferMb ?? null
  };
}

export function captureLlmVramLogLine(line: string | undefined, capture: LlmVramLogCapture): void {
  const projectedMb = parseLlmProjectedVramMbFromLogLine(line ?? "");
  if (projectedMb !== null) {
    capture.projectedMb = projectedMb;
  }
  const modelBufferMb = parseLlmCudaModelBufferMbFromLogLine(line ?? "");
  if (modelBufferMb !== null) {
    capture.modelBufferMb = modelBufferMb;
  }
}

export function shouldReleaseOcrForLlmBudget(
  snapshot: GpuVramSnapshotLike | null,
  budget: LlmVramBudget
): boolean {
  return shouldReleaseOcrBeforeLlm(
    snapshot,
    budget.estimatedLlmMb,
    budget.headroomMb,
    budget.legacyMinFreeMb
  );
}

export async function persistLlmVramProjection(
  fingerprint: string,
  capture: LlmVramLogCapture
): Promise<void> {
  if (capture.projectedMb === null && capture.modelBufferMb === null) {
    return;
  }
  await saveLlmVramProjection(fingerprint, {
    projectedMb: capture.projectedMb,
    modelBufferMb: capture.modelBufferMb
  });
}

export function resolveGpuReleaseWaitMs(): number {
  return readNumberEnv("MANGA_TRANSLATOR_GPU_RELEASE_WAIT_MS", 1000);
}

export async function waitForGpuMemoryRelease(): Promise<void> {
  const waitMs = resolveGpuReleaseWaitMs();
  if (waitMs <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}
