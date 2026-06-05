import type { GemmaGpuLayersSetting, GemmaRuntimeOverrides, GemmaRuntimePresetOverride, GemmaVramMode } from "./types";

export const GEMMA_DRAFT_MODEL_REPO = "Anbeeld/gemma-4-31B-it-DFlash-GGUF";
export const GEMMA_DRAFT_MODEL_FILE = "gemma4-31b-it-dflash-IQ4_XS.gguf";

/** settings.json `gemma.runtimeOverrides` 기본값 (VRAM 모드별 편집 가능 필드) */
export const DEFAULT_GEMMA_RUNTIME_OVERRIDE_PRESETS: Record<GemmaVramMode, GemmaRuntimePresetOverride> = {
  full: {
    ctx: 8192,
    batch: 1024,
    ubatch: 1024,
    fitTargetMb: 1024,
    gpuLayers: "all",
    useDraft: true,
    kvOffload: true,
    mmprojOffload: true,
    llamaRuntime: "auto"
  },
  economy: {
    ctx: 8192,
    batch: 1024,
    ubatch: 1024,
    fitTargetMb: 2048,
    gpuLayers: "fit",
    useDraft: false,
    kvOffload: true,
    mmprojOffload: true,
    llamaRuntime: "auto"
  }
};

const GEMMA_VRAM_MODES: GemmaVramMode[] = ["full", "economy"];

export function createDefaultGemmaRuntimeOverrides(): GemmaRuntimeOverrides {
  return {
    full: { ...DEFAULT_GEMMA_RUNTIME_OVERRIDE_PRESETS.full },
    economy: { ...DEFAULT_GEMMA_RUNTIME_OVERRIDE_PRESETS.economy }
  };
}

/** 저장/로드 시 기본값과 병합해 settings.json에 항상 economy·full 블록을 유지합니다. */
export function resolveGemmaRuntimeOverrides(stored?: GemmaRuntimeOverrides | unknown): GemmaRuntimeOverrides {
  const defaults = createDefaultGemmaRuntimeOverrides();
  const parsed = parseStoredGemmaRuntimeOverrides(stored);
  return {
    full: { ...defaults.full, ...parsed.full },
    economy: { ...defaults.economy, ...parsed.economy }
  };
}

function parseStoredGemmaRuntimeOverrides(stored?: GemmaRuntimeOverrides | unknown): GemmaRuntimeOverrides {
  const record = asRecord(stored);
  if (!record) {
    return {};
  }
  return {
    ...(parseModeOverride(record.full) ? { full: parseModeOverride(record.full) } : {}),
    ...(parseModeOverride(record.economy) ? { economy: parseModeOverride(record.economy) } : {})
  };
}

function parseModeOverride(raw: unknown): GemmaRuntimePresetOverride | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const ctx = readOptionalPositiveInt(record.ctx);
  const batch = readOptionalPositiveInt(record.batch);
  const ubatch = readOptionalPositiveInt(record.ubatch);
  const fitTargetMb = readOptionalPositiveInt(record.fitTargetMb);
  const gpuLayers = resolveGpuLayersSetting(record.gpuLayers);
  const useDraft = readOptionalBooleanValue(record.useDraft);
  const kvOffload = readOptionalBooleanValue(record.kvOffload);
  const mmprojOffload = readOptionalBooleanValue(record.mmprojOffload);
  const llamaRuntime = resolveLlamaRuntimeChoice(record.llamaRuntime);

  if (
    ctx === undefined &&
    batch === undefined &&
    ubatch === undefined &&
    fitTargetMb === undefined &&
    gpuLayers === undefined &&
    useDraft === undefined &&
    kvOffload === undefined &&
    mmprojOffload === undefined &&
    !llamaRuntime
  ) {
    return undefined;
  }

  return {
    ...(ctx !== undefined ? { ctx } : {}),
    ...(batch !== undefined ? { batch } : {}),
    ...(ubatch !== undefined ? { ubatch } : {}),
    ...(fitTargetMb !== undefined ? { fitTargetMb } : {}),
    ...(gpuLayers !== undefined ? { gpuLayers } : {}),
    ...(useDraft !== undefined ? { useDraft } : {}),
    ...(kvOffload !== undefined ? { kvOffload } : {}),
    ...(mmprojOffload !== undefined ? { mmprojOffload } : {}),
    ...(llamaRuntime ? { llamaRuntime } : {})
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function resolveOptionalString(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function readOptionalPositiveInt(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function readOptionalBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return undefined;
}

function resolveGpuLayersSetting(value: unknown): GemmaGpuLayersSetting | undefined {
  if (value === "fit" || value === "all") {
    return value;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return undefined;
}

function resolveLlamaRuntimeChoice(value: unknown): GemmaRuntimePresetOverride["llamaRuntime"] | undefined {
  const text = String(value ?? "").trim().toLowerCase();
  if (text === "auto" || text === "mainline" || text === "beellama") {
    return text;
  }
  return undefined;
}

export function isCompleteGemmaRuntimeOverrides(value: GemmaRuntimeOverrides | undefined): boolean {
  return GEMMA_VRAM_MODES.every((mode) => Boolean(value?.[mode]));
}
