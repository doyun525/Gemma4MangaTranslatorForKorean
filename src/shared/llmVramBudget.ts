export type GpuVramSnapshotLike = {
  freeMb: number;
  usedMb?: number;
  totalMb?: number;
};

export type LlmVramEstimateInput = {
  modelRepo?: string | null;
  modelFile?: string | null;
  gemmaVramMode?: string | null;
  ctx?: number;
  batch?: number;
  ubatch?: number;
  fitTargetMb?: number;
  kvOffload?: boolean;
  mmprojOffload?: boolean;
  useDraft?: boolean;
  gpuLayers?: string | number | null;
};

export type LlmVramProjectionRecord = {
  projectedMb?: number;
  modelBufferMb?: number;
  updatedAt: string;
};

export const DEFAULT_LLM_VRAM_ESTIMATE_MB = 13000;
export const DEFAULT_LLM_VRAM_HEADROOM_MB = 512;
export const LLM_MODEL_BUFFER_OVERHEAD_MB = 1200;

export function buildLlmVramFingerprint(input: LlmVramEstimateInput): string {
  return [
    input.modelRepo ?? "",
    input.modelFile ?? "",
    input.gemmaVramMode ?? "",
    input.ctx ?? "",
    input.batch ?? "",
    input.ubatch ?? "",
    input.fitTargetMb ?? "",
    input.kvOffload === true ? "kv1" : input.kvOffload === false ? "kv0" : "",
    input.mmprojOffload === true ? "mm1" : input.mmprojOffload === false ? "mm0" : "",
    input.useDraft === true ? "draft1" : input.useDraft === false ? "draft0" : "",
    input.gpuLayers ?? ""
  ].join("|");
}

export function parseLlmProjectedVramMbFromLogLine(line: string): number | null {
  const match = String(line ?? "").match(/projected\s+([\d.]+)\s*MiB/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export function parseLlmCudaModelBufferMbFromLogLine(line: string): number | null {
  const match = String(line ?? "").match(/CUDA0 model buffer size\s*=\s*([\d.]+)\s*MiB/i);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

export function resolveEstimatedLlmVramMb(input: {
  cachedProjectedMb?: number | null;
  cachedModelBufferMb?: number | null;
}): number {
  if (typeof input.cachedProjectedMb === "number" && input.cachedProjectedMb > 0) {
    return Math.ceil(input.cachedProjectedMb);
  }
  if (typeof input.cachedModelBufferMb === "number" && input.cachedModelBufferMb > 0) {
    return Math.ceil(input.cachedModelBufferMb + LLM_MODEL_BUFFER_OVERHEAD_MB);
  }
  return DEFAULT_LLM_VRAM_ESTIMATE_MB;
}

export function resolveRequiredFreeVramMb(
  estimatedLlmMb: number,
  headroomMb: number,
  legacyMinFreeMb = 0
): number {
  const budget = Math.max(0, Math.ceil(estimatedLlmMb)) + Math.max(0, Math.ceil(headroomMb));
  const legacy = Math.max(0, Math.ceil(legacyMinFreeMb));
  return Math.max(budget, legacy);
}

export function shouldReleaseOcrBeforeLlm(
  snapshot: GpuVramSnapshotLike | null,
  estimatedLlmMb: number,
  headroomMb: number,
  legacyMinFreeMb = 0
): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.freeMb < resolveRequiredFreeVramMb(estimatedLlmMb, headroomMb, legacyMinFreeMb);
}
