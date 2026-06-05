import { join } from "node:path";
import type {
  AppSettings,
  CodexReasoningEffort,
  GemmaCustomModelPreset,
  GemmaModelPresetId,
  GemmaSettings,
  GemmaLlamaRuntimeChoice,
  GemmaRuntimeOverrides,
  GemmaVramMode,
  JobPhase,
  ModelProvider,
  ModelSource,
  OcrDevice,
  OcrEngine,
  OcrVlServerMode,
  StorageSettings,
  TranslationMode
} from "../shared/types";
import type { DetectedGpuInfo } from "./gpuInfo";

export const GEMMA_31B_MODEL_REPO =
  "mradermacher/gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking-i1-GGUF";
export const GEMMA_31B_MODEL_FILE_IQ3_S =
  "gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking.i1-IQ3_S.gguf";
export const GEMMA_31B_MMPROJ_REPO =
  "mradermacher/gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking-GGUF";
export const GEMMA_31B_MMPROJ_FILE =
  "gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking.mmproj-f16.gguf";
export const GEMMA_26B_MODEL_REPO = "mradermacher/gemma-4-26B-A4B-it-ultra-uncensored-heretic-i1-GGUF";
export const GEMMA_26B_MODEL_FILE_IQ3_S = "gemma-4-26B-A4B-it-ultra-uncensored-heretic.i1-IQ3_S.gguf";
export const GEMMA_26B_MMPROJ_REPO = "mradermacher/gemma-4-26B-A4B-it-ultra-uncensored-heretic-GGUF";
export const GEMMA_26B_MMPROJ_FILE = "gemma-4-26B-A4B-it-ultra-uncensored-heretic.mmproj-Q8_0.gguf";
const BEELLAMA_LLAMA_RUNTIME_DIR_CUDA12 = "beellama-v0.2.0-cuda12.4";
const BEELLAMA_LLAMA_RUNTIME_DIR_CUDA13 = "beellama-v0.2.0-cuda13.1";
const MAINLINE_LLAMA_RUNTIME_DIR_CUDA12 = "llama-b8833-cuda12.4";
const MAINLINE_LLAMA_RUNTIME_DIR_CUDA13 = "llama-b9490-cuda13.3";
export const DEFAULT_GEMMA_MODEL_REPO = GEMMA_31B_MODEL_REPO;
export const DEFAULT_GEMMA_MODEL_FILE_IQ3_S = GEMMA_31B_MODEL_FILE_IQ3_S;
export const DEFAULT_GEMMA_MODEL_FILE = DEFAULT_GEMMA_MODEL_FILE_IQ3_S;
export const DEFAULT_GEMMA_MMPROJ_REPO = GEMMA_31B_MMPROJ_REPO;
export const DEFAULT_GEMMA_MMPROJ_FILE = GEMMA_31B_MMPROJ_FILE;
export {
  GEMMA_DRAFT_MODEL_REPO as DEFAULT_GEMMA_DRAFT_MODEL_REPO,
  GEMMA_DRAFT_MODEL_FILE as DEFAULT_GEMMA_DRAFT_MODEL_FILE,
  createDefaultGemmaRuntimeOverrides,
  resolveGemmaRuntimeOverrides
} from "../shared/gemmaRuntimeSettings";
import {
  GEMMA_DRAFT_MODEL_FILE,
  GEMMA_DRAFT_MODEL_REPO,
  createDefaultGemmaRuntimeOverrides,
  resolveGemmaRuntimeOverrides
} from "../shared/gemmaRuntimeSettings";
export const DEFAULT_GEMMA_VRAM_MODE: GemmaVramMode = "full";
export const DEFAULT_MODEL_PROVIDER: ModelProvider = "gemma";
export const DEFAULT_CODEX_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_REASONING_EFFORT: CodexReasoningEffort = "low";
export const DEFAULT_CODEX_OAUTH_PORT = 10531;
export const DEFAULT_MODEL_SOURCE: ModelSource = "huggingface";
export const DEFAULT_MAX_TOKENS = 12000;
export const MIN_MAX_TOKENS = 300;
export const MAX_MAX_TOKENS = 12000;
export const DEFAULT_OCR_DEVICE: OcrDevice = "cpu";
export const DEFAULT_OCR_ENGINE: OcrEngine = "paddleocr-v5";
export const DEFAULT_OCR_BATCH_SIZE = 1;
export const DEFAULT_OCR_VL_SERVER_MODE: OcrVlServerMode = "direct";
export const DEFAULT_OCR_VL_MAX_LONG_SIDE = 2560;
export const MIN_OCR_BATCH_SIZE = 1;
export const MAX_OCR_BATCH_SIZE = 16;
export const DEFAULT_TRANSLATION_MODE: TranslationMode = "image";
export const DEFAULT_INCLUDE_SOUND_EFFECTS = true;
export const DEFAULT_OCR_BBOX_EXPAND_X_RATIO = 0.2;
export const DEFAULT_OCR_BBOX_EXPAND_Y_RATIO = 0.1;
export const MIN_OCR_BBOX_EXPAND_RATIO = 0;
export const MAX_OCR_BBOX_EXPAND_RATIO = 1;
export const DEFAULT_TEXT_OUTLINE_WIDTH_PX = 1.4;
export const MIN_TEXT_OUTLINE_WIDTH_PX = 0;
export const MAX_TEXT_OUTLINE_WIDTH_PX = 8;
export const DEFAULT_OCR_GPU_CUDA_TAG = "cu126";
export const RTX_50_OCR_GPU_CUDA_TAG = "cu129";

const DEFAULT_IMAGE_TOKENS = 1024;
export const MIN_VISION_TRANSLATION_CTX = 8192;

export function resolveEffectiveTranslationCtx(
  ctx: number,
  translationMode: TranslationMode,
  imageMaxTokens: number
): number {
  if (translationMode === "ocr-text") {
    return ctx;
  }
  return Math.max(ctx, MIN_VISION_TRANSLATION_CTX, imageMaxTokens + 4096);
}

export type GemmaRuntimePreset = {
  ctx: number;
  batch: number;
  ubatch: number;
  fitTargetMb: number;
  gpuLayers?: number | "fit" | "all";
  cacheTypeK?: string;
  cacheTypeV?: string;
  ctxCheckpoints?: number;
  kvOffload?: boolean;
  mmprojOffload?: boolean;
  threads?: number;
  threadsBatch?: number;
  poll?: number;
  pollBatch?: boolean;
  prioBatch?: number;
  cacheIdleSlots?: boolean;
  cacheReuse?: number;
  enableMetrics?: boolean;
  enablePerf?: boolean;
  draftModelRepo?: string;
  draftModelFile?: string;
  useDraft?: boolean;
  llamaRuntime?: GemmaLlamaRuntimeChoice;
};

export const DEFAULT_GEMMA_RUNTIME_PRESETS: Record<GemmaVramMode, GemmaRuntimePreset> = {
  full: {
    ctx: 8192,
    batch: 1024,
    ubatch: 1024,
    fitTargetMb: 1024,
    cacheTypeK: "q4_0",
    cacheTypeV: "q4_0",
    ctxCheckpoints: 0,
    kvOffload: true,
    mmprojOffload: true,
    enableMetrics: true,
    enablePerf: true,
    draftModelRepo: GEMMA_DRAFT_MODEL_REPO,
    draftModelFile: GEMMA_DRAFT_MODEL_FILE,
    useDraft: true
  },
  economy: {
    ctx: 8192,
    batch: 1024,
    ubatch: 1024,
    fitTargetMb: 2048,
    cacheTypeK: "q4_0",
    cacheTypeV: "q4_0",
    ctxCheckpoints: 0,
    kvOffload: true,
    mmprojOffload: true,
    gpuLayers: "fit",
    enableMetrics: true,
    enablePerf: true,
    useDraft: false
  }
};

const GEMMA_RUNTIME_PRESETS = DEFAULT_GEMMA_RUNTIME_PRESETS;

export function resolveGemmaRuntimePreset(vramMode: GemmaVramMode, gemma?: Pick<GemmaSettings, "runtimeOverrides">): GemmaRuntimePreset {
  const base = GEMMA_RUNTIME_PRESETS[vramMode];
  const override = gemma?.runtimeOverrides?.[vramMode];
  if (!override) {
    return { ...base };
  }
  return {
    ...base,
    ...(override.ctx !== undefined ? { ctx: override.ctx } : {}),
    ...(override.batch !== undefined ? { batch: override.batch } : {}),
    ...(override.ubatch !== undefined ? { ubatch: override.ubatch } : {}),
    ...(override.fitTargetMb !== undefined ? { fitTargetMb: override.fitTargetMb } : {}),
    ...(override.gpuLayers !== undefined ? { gpuLayers: override.gpuLayers } : {}),
    ...(override.useDraft !== undefined ? { useDraft: override.useDraft } : {}),
    ...(override.kvOffload !== undefined ? { kvOffload: override.kvOffload } : {}),
    ...(override.mmprojOffload !== undefined ? { mmprojOffload: override.mmprojOffload } : {}),
    ...(override.llamaRuntime !== undefined ? { llamaRuntime: override.llamaRuntime } : {})
  };
}

export type TranslationOptions = {
  imagePath: string;
  imageWidth?: number;
  imageHeight?: number;
  outputDir: string;
  modelProvider: ModelProvider;
  port: number;
  promptMode: string;
  promptOverrideText?: string;
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  ctx: number;
  batch: number;
  ubatch: number;
  gemmaVramMode: GemmaVramMode;
  fitTargetMb: number;
  gpuLayers?: number | "fit";
  cacheTypeK?: string;
  cacheTypeV?: string;
  ctxCheckpoints?: number;
  kvOffload?: boolean;
  mmprojOffload?: boolean;
  threads?: number;
  threadsBatch?: number;
  poll?: number;
  pollBatch?: boolean;
  prioBatch?: number;
  cacheIdleSlots?: boolean;
  cacheReuse?: number;
  enableMetrics?: boolean;
  enablePerf?: boolean;
  draftModelRepo?: string;
  draftModelFile?: string;
  useDraft?: boolean;
  imageMinTokens: number;
  imageMaxTokens: number;
  includeEnhancedVariant: boolean;
  enhancedMaxLongSide: number;
  enhancedContrast: number;
  imageFirst: boolean;
  reuseServer: boolean;
  llamaRuntimeProfile?: string;
  workingDir: string;
  toolsDir: string;
  ocrRuntimeDir?: string;
  serverPath: string;
  modelSource: ModelSource;
  modelRepo: string;
  modelFile: string;
  mmprojRepo?: string;
  mmprojFile?: string;
  localModelPath?: string;
  localMmprojPath?: string;
  codexModel: string;
  codexReasoningEffort: CodexReasoningEffort;
  codexOauthPort: number;
  modelCacheDir?: string;
  translationMode: TranslationMode;
  includeSoundEffects: boolean;
  ocrBboxExpandXRatio: number;
  ocrBboxExpandYRatio: number;
  textOutlineWidthPx: number;
  ocrDevice: OcrDevice;
  ocrEngine: OcrEngine;
  ocrBatchSize: number;
  ocrGpuCudaTag?: string;
  ocrVlServerMode?: OcrVlServerMode;
  ocrVlMaxLongSide?: number;
  ocrBboxProvider?: string;
  ocrBboxCommand?: string;
  ocrBboxHintsPath?: string;
  ocrBboxHints?: unknown;
  ocrBboxHintLimit?: number;
  multiPageOcrTextBatch?: boolean;
  skipOcrBboxHints?: boolean;
  regionCropMode?: boolean;
  ocrPageIndex?: number;
  ocrPageTotal?: number;
  ocrTileIndex?: number;
  ocrTileTotal?: number;
  ocrProgressDefaultToPage?: boolean;
  ocrBatchCompletedBefore?: number;
  ocrBatchTotal?: number;
  onProgress?: (event: {
    phase: JobPhase;
    progressText: string;
    detail?: string;
    progressCurrent?: number;
    progressTotal?: number;
    pageIndex?: number | null;
    pageTotal?: number | null;
    progressMode?: "determinate" | "indeterminate" | "log-only";
    progressPercent?: number;
    progressBytes?: number;
    progressTotalBytes?: number;
    progressBytesPerSecond?: number;
    installLogLine?: string;
  }) => void;
  hfHomeDir?: string;
  hfHubCacheDir?: string;
  llamaCacheDir?: string;
  label: string;
  abortSignal?: AbortSignal;
};

export type TranslationOptionPaths = {
  isPackaged?: boolean;
  dataRoot: string;
  toolsDir: string;
  ocrRuntimeDir?: string;
  llamaServerPath: string;
  hfHomeDir?: string;
  hfHubCacheDir?: string;
  llamaCacheDir?: string;
};

export function resolveDefaultAppSettings(
  env: NodeJS.ProcessEnv = process.env,
  detectedGpu?: number | DetectedGpuInfo | null
): AppSettings {
  const hardwareDefaults = resolveHardwareDefaults(detectedGpu);
  const vramMode = resolveGemmaVramMode(env.MANGA_TRANSLATOR_GEMMA_VRAM_MODE, hardwareDefaults.gemmaVramMode);
  const defaultGemmaPreset = getDefaultGemmaPresetForVramMode(vramMode);
  return {
    modelProvider: resolveModelProvider(env.MANGA_TRANSLATOR_MODEL_PROVIDER, hardwareDefaults.modelProvider),
    gemma: {
      modelSource: DEFAULT_MODEL_SOURCE,
      modelRepo: resolveNonEmptyString(env.MANGA_TRANSLATOR_MODEL_HF, defaultGemmaPreset.modelRepo),
      modelFile: resolveNonEmptyString(env.LLAMA_ARG_HF_FILE, defaultGemmaPreset.modelFile),
      mmprojRepo: resolveOptionalString(env.MANGA_TRANSLATOR_MMPROJ_HF) ?? defaultGemmaPreset.mmprojRepo,
      mmprojFile: resolveOptionalString(env.LLAMA_ARG_MMPROJ_FILE) ?? defaultGemmaPreset.mmprojFile,
      vramMode,
      modelPreset: inferGemmaModelPreset(defaultGemmaPreset.modelRepo, defaultGemmaPreset.modelFile),
      runtimeOverrides: createDefaultGemmaRuntimeOverrides()
    },
    codex: {
      model: resolveNonEmptyString(env.MANGA_TRANSLATOR_CODEX_MODEL, DEFAULT_CODEX_MODEL),
      reasoningEffort: resolveCodexReasoningEffort(
        env.MANGA_TRANSLATOR_CODEX_REASONING_EFFORT,
        DEFAULT_CODEX_REASONING_EFFORT
      ),
      oauthPort: resolvePortNumber(env.MANGA_TRANSLATOR_CODEX_OAUTH_PORT, DEFAULT_CODEX_OAUTH_PORT)
    },
    ocr: {
      device: resolveOcrDevice(env.MANGA_TRANSLATOR_OCR_DEVICE, hardwareDefaults.ocrDevice),
      engine: resolveOcrEngine(
        env.MANGA_TRANSLATOR_OCR_ENGINE ?? env.MANGA_TRANSLATOR_OCR_BBOX_PROVIDER,
        DEFAULT_OCR_ENGINE
      ),
      batchSize: resolveOcrBatchSize(env.MANGA_TRANSLATOR_OCR_BATCH_SIZE, DEFAULT_OCR_BATCH_SIZE),
      gpuCudaTag: resolveOcrGpuCudaTag(
        env.MANGA_TRANSLATOR_OCR_GPU_CUDA_TAG ??
          env.MANGA_TRANSLATOR_PADDLEOCR_CUDA_TAG ??
          env.MANGA_TRANSLATOR_OCR_GPU_CUDA,
        hardwareDefaults.ocrGpuCudaTag
      ),
      vlServerMode: resolveOcrVlServerMode(
        env.MANGA_TRANSLATOR_PADDLEOCR_VL_SERVER_MODE ?? env.MANGA_TRANSLATOR_OCR_VL_SERVER_MODE,
        DEFAULT_OCR_VL_SERVER_MODE
      ),
      vlMaxLongSide: resolveOcrVlMaxLongSide(
        env.MANGA_TRANSLATOR_PADDLEOCR_VL_MAX_LONG_SIDE ?? env.MANGA_TRANSLATOR_OCR_VL_MAX_LONG_SIDE,
        DEFAULT_OCR_VL_MAX_LONG_SIDE
      )
    },
    translation: {
      mode: resolveTranslationMode(env.MANGA_TRANSLATOR_TRANSLATION_MODE, DEFAULT_TRANSLATION_MODE),
      includeSoundEffects:
        readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_INCLUDE_SOUND_EFFECTS") ?? DEFAULT_INCLUDE_SOUND_EFFECTS,
      ocrBboxExpandXRatio: resolveOcrBboxExpandRatio(
        env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X_RATIO ?? env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X,
        DEFAULT_OCR_BBOX_EXPAND_X_RATIO
      ),
      ocrBboxExpandYRatio: resolveOcrBboxExpandRatio(
        env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y_RATIO ?? env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y,
        DEFAULT_OCR_BBOX_EXPAND_Y_RATIO
      ),
      textOutlineWidthPx: resolveTextOutlineWidthPx(
        env.MANGA_TRANSLATOR_TEXT_OUTLINE_WIDTH_PX,
        DEFAULT_TEXT_OUTLINE_WIDTH_PX
      )
    },
    maxTokens: resolveMaxTokens(env.MANGA_TRANSLATOR_MAX_TOKENS, DEFAULT_MAX_TOKENS)
  };
}

export function resolveHardwareDefaults(
  detectedGpu?: number | DetectedGpuInfo | null
): { modelProvider: ModelProvider; gemmaVramMode: GemmaVramMode; ocrDevice: OcrDevice; ocrGpuCudaTag: string } {
  const info = normalizeDetectedGpuInfo(detectedGpu);
  const supportedRtxGeneration = (info?.rtxGeneration ?? 0) >= 30;
  const supportedComputeCapability = (info?.computeCapability ?? 0) >= 8;
  if (!info || !info.memoryMb || (!supportedRtxGeneration && !supportedComputeCapability)) {
    return {
      modelProvider: "openai-codex",
      gemmaVramMode: "economy",
      ocrDevice: "cpu",
      ocrGpuCudaTag: resolveHardwareOcrGpuCudaTag(info)
    };
  }

  const ocrDevice: OcrDevice = info.memoryMb >= 12000 ? "gpu" : "cpu";
  const ocrGpuCudaTag = resolveHardwareOcrGpuCudaTag(info);
  if (info.memoryMb >= 24000) {
    return {
      modelProvider: "gemma",
      gemmaVramMode: "full",
      ocrDevice,
      ocrGpuCudaTag
    };
  }
  if (info.memoryMb >= 16000) {
    return {
      modelProvider: "gemma",
      gemmaVramMode: "economy",
      ocrDevice,
      ocrGpuCudaTag
    };
  }
  return {
    modelProvider: "openai-codex",
    gemmaVramMode: "economy",
    ocrDevice,
    ocrGpuCudaTag
  };
}

export function normalizeAppSettings(raw: unknown, defaults = resolveDefaultAppSettings()): AppSettings {
  const record = asRecord(raw);
  const gemma = record?.gemma;
  const codex = record?.codex;
  const ocr = record?.ocr;
  const translation = record?.translation;
  const storage = record?.storage;
  const modelSource = resolveModelSource(asRecord(gemma)?.modelSource, defaults.gemma.modelSource);
  const resolvedVramMode = resolveGemmaVramMode(asRecord(gemma)?.vramMode, defaults.gemma.vramMode);
  const modeAwareGemmaDefaults = getModeAwareGemmaDefaults(defaults, resolvedVramMode);
  const modeDefaults = {
    ...defaults,
    gemma: {
      ...defaults.gemma,
      ...modeAwareGemmaDefaults
    }
  };
  const resolvedModel = resolveStoredGemmaModel(asRecord(gemma), modeDefaults, resolvedVramMode);
  const resolvedMmproj =
    modelSource === "huggingface" ? resolveStoredGemmaMmproj(asRecord(gemma), resolvedModel, modeDefaults) : {};
  const localModelPath = resolveOptionalString(asRecord(gemma)?.localModelPath);
  const localMmprojPath = resolveOptionalString(asRecord(gemma)?.localMmprojPath);
  const customModelPresets = ensureCurrentGemmaModelPreset(
    normalizeGemmaCustomModelPresets(asRecord(gemma)?.customModelPresets),
    {
      ...resolvedModel,
      ...(resolvedMmproj.mmprojRepo ? { mmprojRepo: resolvedMmproj.mmprojRepo } : {}),
      ...(resolvedMmproj.mmprojFile ? { mmprojFile: resolvedMmproj.mmprojFile } : {})
    },
    modelSource
  );
  const storageSettings = normalizeStorageSettings(storage);
  const resolvedOcr = asRecord(ocr);
  return {
    modelProvider: resolveModelProvider(record?.modelProvider, defaults.modelProvider),
    gemma: {
      modelSource,
      modelRepo: resolvedModel.modelRepo,
      modelFile: resolvedModel.modelFile,
      ...(resolvedMmproj.mmprojRepo ? { mmprojRepo: resolvedMmproj.mmprojRepo } : {}),
      ...(resolvedMmproj.mmprojFile ? { mmprojFile: resolvedMmproj.mmprojFile } : {}),
      ...(localModelPath ? { localModelPath } : {}),
      ...(localMmprojPath ? { localMmprojPath } : {}),
      ...(customModelPresets.length > 0 ? { customModelPresets } : {}),
      modelPreset: resolveGemmaModelPreset(asRecord(gemma)?.modelPreset, resolvedModel.modelRepo, resolvedModel.modelFile),
      vramMode: resolvedVramMode,
      runtimeOverrides: resolveGemmaRuntimeOverrides(asRecord(gemma)?.runtimeOverrides)
    },
    codex: {
      model: resolveNonEmptyString(asRecord(codex)?.model, defaults.codex.model),
      reasoningEffort: resolveCodexReasoningEffort(asRecord(codex)?.reasoningEffort, defaults.codex.reasoningEffort),
      oauthPort: resolvePortNumber(asRecord(codex)?.oauthPort, defaults.codex.oauthPort)
    },
    ocr: {
      device: resolveOcrDevice(resolvedOcr?.device, defaults.ocr.device),
      engine: resolveOcrEngine(
        resolvedOcr?.engine ?? resolvedOcr?.bboxProvider ?? record?.ocrBboxProvider,
        defaults.ocr.engine
      ),
      batchSize: resolveOcrBatchSize(resolvedOcr?.batchSize ?? record?.ocrBatchSize, defaults.ocr.batchSize),
      gpuCudaTag: resolveStoredOcrGpuCudaTag(resolvedOcr, defaults),
      vlServerMode: resolveOcrVlServerMode(
        resolvedOcr?.vlServerMode ?? record?.ocrVlServerMode,
        defaults.ocr.vlServerMode ?? DEFAULT_OCR_VL_SERVER_MODE
      ),
      vlMaxLongSide: resolveOcrVlMaxLongSide(
        resolvedOcr?.vlMaxLongSide ?? record?.ocrVlMaxLongSide,
        defaults.ocr.vlMaxLongSide ?? DEFAULT_OCR_VL_MAX_LONG_SIDE
      )
    },
    translation: {
      mode: resolveTranslationMode(asRecord(translation)?.mode ?? record?.translationMode, defaults.translation.mode),
      includeSoundEffects:
        resolveOptionalBoolean(asRecord(translation)?.includeSoundEffects) ??
        resolveOptionalBoolean(record?.includeSoundEffects) ??
        defaults.translation.includeSoundEffects,
      ocrBboxExpandXRatio: resolveOcrBboxExpandRatio(
        asRecord(translation)?.ocrBboxExpandXRatio ?? record?.ocrBboxExpandXRatio,
        defaults.translation.ocrBboxExpandXRatio
      ),
      ocrBboxExpandYRatio: resolveOcrBboxExpandRatio(
        asRecord(translation)?.ocrBboxExpandYRatio ?? record?.ocrBboxExpandYRatio,
        defaults.translation.ocrBboxExpandYRatio
      ),
      textOutlineWidthPx: resolveTextOutlineWidthPx(
        asRecord(translation)?.textOutlineWidthPx ?? record?.textOutlineWidthPx,
        defaults.translation.textOutlineWidthPx
      )
    },
    ...(storageSettings ? { storage: storageSettings } : {}),
    maxTokens: resolveMaxTokens(record?.maxTokens, defaults.maxTokens)
  };
}

export function parseStoredAppSettings(rawText: string | null | undefined, defaults = resolveDefaultAppSettings()): AppSettings {
  if (!rawText?.trim()) {
    return defaults;
  }

  return normalizeAppSettings(JSON.parse(rawText), defaults);
}

export function buildBaseTranslationOptions({
  jobId,
  runDir,
  paths,
  settings,
  env = process.env
}: {
  jobId: string;
  runDir: string;
  paths: TranslationOptionPaths;
  settings: AppSettings;
  env?: NodeJS.ProcessEnv;
}): TranslationOptions {
  const runtimeEnv = filterPackagedRuntimeEnv(env, paths);
  const gemmaVramMode = resolveGemmaVramMode(runtimeEnv.MANGA_TRANSLATOR_GEMMA_VRAM_MODE, settings.gemma.vramMode);
  const gemmaRuntimePreset = resolveGemmaRuntimePreset(gemmaVramMode, settings.gemma);
  const modelCacheDir = resolveOptionalString(settings.storage?.modelCacheDir);
  const envUseDraft = readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_USE_DRAFT");
  const runtimeGemma = resolveRuntimeGemmaSettings(settings.gemma, gemmaVramMode);
  const runtimeOverride = resolveGemmaRuntimeOverrides(settings.gemma.runtimeOverrides)[gemmaVramMode];
  const defaultRuntimeOverride = createDefaultGemmaRuntimeOverrides()[gemmaVramMode];
  const llamaRuntimeChoice = gemmaRuntimePreset.llamaRuntime ?? "auto";
  const translationMode = resolveTranslationMode(runtimeEnv.MANGA_TRANSLATOR_TRANSLATION_MODE, settings.translation.mode);
  const imageMaxTokens = readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_IMAGE_MAX_TOKENS", DEFAULT_IMAGE_TOKENS);
  const useDraft = resolveTranslationUseDraft({
    envUseDraft,
    gemma: settings.gemma,
    gemmaRuntimePreset,
    runtimeOverride,
    defaultRuntimeOverride,
    runtimeGemma,
    llamaRuntimeChoice
  });
  const ocrGpuCudaTag = resolveOcrGpuCudaTag(
    runtimeEnv.MANGA_TRANSLATOR_OCR_GPU_CUDA_TAG ??
      runtimeEnv.MANGA_TRANSLATOR_PADDLEOCR_CUDA_TAG ??
      runtimeEnv.MANGA_TRANSLATOR_OCR_GPU_CUDA,
    settings.ocr.gpuCudaTag ?? DEFAULT_OCR_GPU_CUDA_TAG
  );
  const llamaRuntimeProfile = resolveLlamaRuntimeProfile(runtimeEnv, ocrGpuCudaTag);
  return {
    imagePath: "",
    outputDir: runDir,
    modelProvider: settings.modelProvider,
    port: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_LLAMA_PORT", 18180),
    promptMode: "ko_bbox_lines_multiview",
    temperature: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_TEMPERATURE", 0.2),
    topP: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_TOP_P", 0.95),
    topK: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_TOP_K", 64),
    maxTokens: resolveMaxTokens(runtimeEnv.MANGA_TRANSLATOR_MAX_TOKENS, settings.maxTokens),
    ctx: resolveEffectiveTranslationCtx(
      readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_CTX", gemmaRuntimePreset.ctx),
      translationMode,
      imageMaxTokens
    ),
    batch: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_BATCH", gemmaRuntimePreset.batch),
    ubatch: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_UBATCH", gemmaRuntimePreset.ubatch),
    gemmaVramMode,
    fitTargetMb: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_FIT_TARGET_MB", gemmaRuntimePreset.fitTargetMb),
    gpuLayers: resolveTranslationGpuLayers(
      readOptionalGpuLayersEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_GPU_LAYERS") ??
        readOptionalGpuLayersEnv(runtimeEnv, "MANGA_TRANSLATOR_GPU_LAYERS") ??
        gemmaRuntimePreset.gpuLayers
    ),
    cacheTypeK:
      resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_GEMMA_CACHE_TYPE_K ?? runtimeEnv.MANGA_TRANSLATOR_CACHE_TYPE_K) ??
      gemmaRuntimePreset.cacheTypeK,
    cacheTypeV:
      resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_GEMMA_CACHE_TYPE_V ?? runtimeEnv.MANGA_TRANSLATOR_CACHE_TYPE_V) ??
      gemmaRuntimePreset.cacheTypeV,
    ctxCheckpoints:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_CTX_CHECKPOINTS") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_CTX_CHECKPOINTS") ??
      gemmaRuntimePreset.ctxCheckpoints,
    kvOffload: readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_KV_OFFLOAD") ?? gemmaRuntimePreset.kvOffload,
    mmprojOffload:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_MMPROJ_OFFLOAD") ?? gemmaRuntimePreset.mmprojOffload,
    threads:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_THREADS") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_THREADS") ??
      gemmaRuntimePreset.threads,
    threadsBatch:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_THREADS_BATCH") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_THREADS_BATCH") ??
      gemmaRuntimePreset.threadsBatch,
    poll:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_POLL") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_POLL") ??
      gemmaRuntimePreset.poll,
    pollBatch:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_POLL_BATCH") ??
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_POLL_BATCH") ??
      gemmaRuntimePreset.pollBatch,
    prioBatch:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_PRIO_BATCH") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_PRIO_BATCH") ??
      gemmaRuntimePreset.prioBatch,
    cacheIdleSlots:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_CACHE_IDLE_SLOTS") ??
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_CACHE_IDLE_SLOTS") ??
      gemmaRuntimePreset.cacheIdleSlots,
    cacheReuse:
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_CACHE_REUSE") ??
      readOptionalNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_CACHE_REUSE") ??
      gemmaRuntimePreset.cacheReuse,
    enableMetrics:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_METRICS") ??
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_METRICS") ??
      gemmaRuntimePreset.enableMetrics,
    enablePerf:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_GEMMA_PERF") ??
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_PERF") ??
      gemmaRuntimePreset.enablePerf,
    draftModelRepo: useDraft
      ? resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_DRAFT_MODEL_HF) ?? GEMMA_DRAFT_MODEL_REPO
      : undefined,
    draftModelFile: useDraft
      ? resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_DRAFT_MODEL_FILE) ?? GEMMA_DRAFT_MODEL_FILE
      : undefined,
    useDraft,
    imageMinTokens: readNumberEnv(runtimeEnv, "MANGA_TRANSLATOR_IMAGE_MIN_TOKENS", DEFAULT_IMAGE_TOKENS),
    imageMaxTokens,
    includeEnhancedVariant: false,
    enhancedMaxLongSide: 1900,
    enhancedContrast: 1.35,
    imageFirst: true,
    reuseServer: true,
    llamaRuntimeProfile,
    workingDir: paths.dataRoot,
    toolsDir: paths.toolsDir,
    serverPath: resolveTranslationServerPath({
      paths,
      runtimeGemma,
      llamaRuntimeProfile,
      llamaRuntimeChoice: gemmaRuntimePreset.llamaRuntime ?? "auto",
      useDraft,
      runtimeEnv
    }),
    modelSource: runtimeGemma.modelSource,
    modelRepo: resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_MODEL_HF) ?? runtimeGemma.modelRepo,
    modelFile: resolveOptionalString(runtimeEnv.LLAMA_ARG_HF_FILE) ?? runtimeGemma.modelFile,
    mmprojRepo:
      runtimeGemma.modelSource === "huggingface"
        ? resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_MMPROJ_HF) ??
          runtimeGemma.mmprojRepo ??
          getDefaultMmprojForGemmaModel(runtimeGemma)?.mmprojRepo
        : undefined,
    mmprojFile:
      runtimeGemma.modelSource === "huggingface"
        ? resolveOptionalString(runtimeEnv.LLAMA_ARG_MMPROJ_FILE) ??
          runtimeGemma.mmprojFile ??
          getDefaultMmprojForGemmaModel(runtimeGemma)?.mmprojFile
        : undefined,
    localModelPath: runtimeGemma.localModelPath,
    localMmprojPath: runtimeGemma.localMmprojPath,
    codexModel: settings.codex.model,
    codexReasoningEffort: resolveCodexReasoningEffort(runtimeEnv.MANGA_TRANSLATOR_CODEX_REASONING_EFFORT, settings.codex.reasoningEffort),
    codexOauthPort: settings.codex.oauthPort,
    translationMode,
    includeSoundEffects:
      readOptionalBooleanEnv(runtimeEnv, "MANGA_TRANSLATOR_INCLUDE_SOUND_EFFECTS") ??
      settings.translation.includeSoundEffects,
    ocrBboxExpandXRatio: resolveOcrBboxExpandRatio(
      runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X_RATIO ?? runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X,
      settings.translation.ocrBboxExpandXRatio
    ),
    ocrBboxExpandYRatio: resolveOcrBboxExpandRatio(
      runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y_RATIO ?? runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y,
      settings.translation.ocrBboxExpandYRatio
    ),
    textOutlineWidthPx: resolveTextOutlineWidthPx(
      runtimeEnv.MANGA_TRANSLATOR_TEXT_OUTLINE_WIDTH_PX,
      settings.translation.textOutlineWidthPx
    ),
    ocrDevice: resolveOcrDevice(runtimeEnv.MANGA_TRANSLATOR_OCR_DEVICE, settings.ocr.device),
    ocrEngine: resolveOcrEngine(
      runtimeEnv.MANGA_TRANSLATOR_OCR_ENGINE ?? runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_PROVIDER,
      settings.ocr.engine
    ),
    ocrBatchSize: resolveOcrBatchSize(runtimeEnv.MANGA_TRANSLATOR_OCR_BATCH_SIZE, settings.ocr.batchSize),
    ocrGpuCudaTag: resolveOcrGpuCudaTag(
      runtimeEnv.MANGA_TRANSLATOR_OCR_GPU_CUDA_TAG ??
        runtimeEnv.MANGA_TRANSLATOR_PADDLEOCR_CUDA_TAG ??
        runtimeEnv.MANGA_TRANSLATOR_OCR_GPU_CUDA,
      settings.ocr.gpuCudaTag ?? DEFAULT_OCR_GPU_CUDA_TAG
    ),
    ocrVlServerMode: resolveOcrVlServerMode(
      runtimeEnv.MANGA_TRANSLATOR_PADDLEOCR_VL_SERVER_MODE ?? runtimeEnv.MANGA_TRANSLATOR_OCR_VL_SERVER_MODE,
      settings.ocr.vlServerMode ?? DEFAULT_OCR_VL_SERVER_MODE
    ),
    ocrVlMaxLongSide: resolveOcrVlMaxLongSide(
      runtimeEnv.MANGA_TRANSLATOR_PADDLEOCR_VL_MAX_LONG_SIDE ?? runtimeEnv.MANGA_TRANSLATOR_OCR_VL_MAX_LONG_SIDE,
      settings.ocr.vlMaxLongSide ?? DEFAULT_OCR_VL_MAX_LONG_SIDE
    ),
    ocrBboxProvider:
      resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_PROVIDER) ??
      resolveOcrEngine(runtimeEnv.MANGA_TRANSLATOR_OCR_ENGINE, settings.ocr.engine),
    ocrBboxCommand: resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_CMD),
    ocrBboxHintsPath: resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_OCR_BBOX_HINTS_PATH),
    ocrRuntimeDir: paths.ocrRuntimeDir,
    modelCacheDir,
    hfHomeDir: modelCacheDir ?? paths.hfHomeDir,
    hfHubCacheDir: modelCacheDir ? join(modelCacheDir, "hub") : paths.hfHubCacheDir,
    llamaCacheDir: paths.llamaCacheDir,
    label: `app-${jobId}`
  };
}

export function filterPackagedRuntimeEnv(
  env: NodeJS.ProcessEnv,
  paths: Pick<TranslationOptionPaths, "isPackaged">
): NodeJS.ProcessEnv {
  if (!paths.isPackaged || readBooleanLikeEnv(env.MGT_ALLOW_EXTERNAL_RUNTIME ?? env.MANGA_TRANSLATOR_ALLOW_EXTERNAL_RUNTIME)) {
    return env;
  }
  return {};
}

function readNumberEnv(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function readOptionalNumberEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function readOptionalGpuLayersEnv(env: NodeJS.ProcessEnv, name: string): number | "fit" | "all" | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "fit") {
    return "fit";
  }
  if (normalized === "all") {
    return "all";
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function readOptionalBooleanEnv(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return readBooleanLikeEnv(raw);
}

function resolveOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function readBooleanLikeEnv(raw: unknown): boolean | undefined {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function resolveModelProvider(value: unknown, fallback: ModelProvider): ModelProvider {
  return value === "openai-codex" || value === "gemma" ? value : fallback;
}

function resolveModelSource(value: unknown, fallback: ModelSource): ModelSource {
  return value === "local" || value === "huggingface" ? value : fallback;
}

function resolveGemmaVramMode(value: unknown, fallback: GemmaVramMode): GemmaVramMode {
  return value === "economy" || value === "full" ? value : fallback;
}

function resolveGemmaModelPreset(
  value: unknown,
  modelRepo: string,
  modelFile: string
): GemmaModelPresetId {
  if (value === "economy26b" || value === "full31b" || value === "custom") {
    return value;
  }
  return inferGemmaModelPreset(modelRepo, modelFile);
}

function inferGemmaModelPreset(modelRepo: string, modelFile: string): GemmaModelPresetId {
  if (modelRepo === GEMMA_26B_MODEL_REPO && modelFile === GEMMA_26B_MODEL_FILE_IQ3_S) {
    return "economy26b";
  }
  if (modelRepo === GEMMA_31B_MODEL_REPO && modelFile === GEMMA_31B_MODEL_FILE_IQ3_S) {
    return "full31b";
  }
  return "custom";
}

function resolveOcrDevice(value: unknown, fallback: OcrDevice): OcrDevice {
  return value === "gpu" || value === "cpu" ? value : fallback;
}

function isDefaultDflashDraftCompatible(modelSource: ModelSource, modelRepo: string, modelFile: string): boolean {
  return modelSource === "huggingface" && modelRepo === DEFAULT_GEMMA_MODEL_REPO && modelFile === DEFAULT_GEMMA_MODEL_FILE;
}

function resolveOcrEngine(value: unknown, fallback: OcrEngine): OcrEngine {
  return value === "paddleocr-v5" || value === "paddleocr-vl" ? value : fallback;
}

function resolveOcrVlServerMode(value: unknown, fallback: OcrVlServerMode): OcrVlServerMode {
  return value === "external" || value === "auto-fastdeploy" || value === "direct" ? value : fallback;
}

function resolveOcrBatchSize(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, MIN_OCR_BATCH_SIZE, MAX_OCR_BATCH_SIZE);
}

function resolveOcrVlMaxLongSide(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.max(0, parsed);
}

function resolveTranslationMode(value: unknown, fallback: TranslationMode): TranslationMode {
  return value === "image" || value === "ocr-text" || value === "ocr-text-with-image-retry" ? value : fallback;
}

function resolveOcrGpuCudaTag(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim().toLowerCase();
  if (/^cu\d+$/.test(text)) {
    return text;
  }
  const digits = text.replace(/\D/g, "");
  if (digits) {
    return `cu${digits}`;
  }
  return fallback;
}

function resolveStoredOcrGpuCudaTag(ocr: Record<string, unknown> | null, defaults: AppSettings): string {
  const defaultTag = defaults.ocr.gpuCudaTag ?? DEFAULT_OCR_GPU_CUDA_TAG;
  const stored = resolveOcrGpuCudaTag(ocr?.gpuCudaTag, defaultTag);
  if (defaultTag === RTX_50_OCR_GPU_CUDA_TAG && (!ocr?.gpuCudaTag || stored === DEFAULT_OCR_GPU_CUDA_TAG)) {
    return RTX_50_OCR_GPU_CUDA_TAG;
  }
  return stored;
}

function resolveHardwareOcrGpuCudaTag(info: DetectedGpuInfo | null): string {
  if ((info?.computeCapability ?? 0) >= 12 || (info?.rtxGeneration ?? 0) >= 50) {
    return RTX_50_OCR_GPU_CUDA_TAG;
  }
  return DEFAULT_OCR_GPU_CUDA_TAG;
}

function resolveCodexReasoningEffort(value: unknown, fallback: CodexReasoningEffort): CodexReasoningEffort {
  if (value === "minimal") {
    return "low";
  }
  return value === "none" || value === "low" || value === "medium" || value === "high" || value === "xhigh"
    ? value
    : fallback;
}

function resolveNonEmptyString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function resolveOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function resolvePortNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, 1, 65535);
}

function resolveMaxTokens(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, MIN_MAX_TOKENS, MAX_MAX_TOKENS);
}

function resolveOcrBboxExpandRatio(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_OCR_BBOX_EXPAND_RATIO, Math.max(MIN_OCR_BBOX_EXPAND_RATIO, parsed));
}

function resolveTextOutlineWidthPx(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(MAX_TEXT_OUTLINE_WIDTH_PX, Math.max(MIN_TEXT_OUTLINE_WIDTH_PX, parsed));
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeStorageSettings(value: unknown): StorageSettings | undefined {
  const modelCacheDir = resolveOptionalString(asRecord(value)?.modelCacheDir);
  return modelCacheDir ? { modelCacheDir } : undefined;
}

function normalizeDetectedGpuInfo(value?: number | DetectedGpuInfo | null): DetectedGpuInfo | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0
      ? {
          name: null,
          memoryMb: value,
          rtxGeneration: null,
          computeCapability: null
        }
      : null;
  }
  if (!value || typeof value !== "object") {
    return null;
  }
  const memoryMb = typeof value.memoryMb === "number" && Number.isFinite(value.memoryMb) ? value.memoryMb : null;
  const rtxGeneration =
    typeof value.rtxGeneration === "number" && Number.isFinite(value.rtxGeneration) ? value.rtxGeneration : null;
  const computeCapability =
    typeof value.computeCapability === "number" && Number.isFinite(value.computeCapability) ? value.computeCapability : null;
  return {
    name: typeof value.name === "string" ? value.name : null,
    memoryMb,
    rtxGeneration,
    computeCapability
  };
}

type GemmaModelPreset = Pick<AppSettings["gemma"], "modelRepo" | "modelFile" | "mmprojRepo" | "mmprojFile">;

function getDefaultGemmaPresetForVramMode(vramMode: GemmaVramMode): GemmaModelPreset {
  return vramMode === "economy"
    ? {
        modelRepo: GEMMA_26B_MODEL_REPO,
        modelFile: GEMMA_26B_MODEL_FILE_IQ3_S,
        mmprojRepo: GEMMA_26B_MMPROJ_REPO,
        mmprojFile: GEMMA_26B_MMPROJ_FILE
      }
    : {
        modelRepo: GEMMA_31B_MODEL_REPO,
        modelFile: GEMMA_31B_MODEL_FILE_IQ3_S,
        mmprojRepo: GEMMA_31B_MMPROJ_REPO,
        mmprojFile: GEMMA_31B_MMPROJ_FILE
      };
}

function getModeAwareGemmaDefaults(defaults: AppSettings, vramMode: GemmaVramMode): GemmaModelPreset {
  const currentDefaultModel = {
    modelRepo: defaults.gemma.modelRepo,
    modelFile: defaults.gemma.modelFile
  };
  if (!isBuiltInGemmaModel(currentDefaultModel)) {
    return {
      modelRepo: defaults.gemma.modelRepo,
      modelFile: defaults.gemma.modelFile,
      mmprojRepo: defaults.gemma.mmprojRepo,
      mmprojFile: defaults.gemma.mmprojFile
    };
  }
  return getDefaultGemmaPresetForVramMode(vramMode);
}

function resolveRuntimeGemmaSettings(
  gemma: AppSettings["gemma"],
  vramMode: GemmaVramMode
): AppSettings["gemma"] {
  if (gemma.modelPreset === "custom" || gemma.modelSource !== "huggingface" || !shouldPinGemmaModelToVramPreset(gemma)) {
    return gemma;
  }

  const model = { modelRepo: gemma.modelRepo, modelFile: gemma.modelFile };
  if (!isBuiltInGemmaModel(model)) {
    return gemma;
  }

  return {
    ...gemma,
    ...getDefaultGemmaPresetForVramMode(vramMode)
  };
}

function shouldPinGemmaModelToVramPreset(
  gemma: Pick<GemmaSettings, "runtimeOverrides" | "modelRepo" | "modelFile" | "modelSource" | "modelPreset">
): boolean {
  if (gemma.modelPreset === "custom") {
    return false;
  }
  if (gemma.modelSource !== "huggingface") {
    return false;
  }
  if (hasCustomGemmaRuntimeOverrides(gemma.runtimeOverrides)) {
    return false;
  }
  return isBuiltInGemmaModel({ modelRepo: gemma.modelRepo, modelFile: gemma.modelFile });
}

function hasCustomGemmaRuntimeOverrides(overrides?: GemmaRuntimeOverrides): boolean {
  if (!overrides) {
    return false;
  }
  const defaults = createDefaultGemmaRuntimeOverrides();
  return (["full", "economy"] as GemmaVramMode[]).some(
    (mode) => JSON.stringify(overrides[mode] ?? {}) !== JSON.stringify(defaults[mode] ?? {})
  );
}

function hasCustomGemmaRuntimeDraftSettings(
  override: GemmaRuntimeOverrides[GemmaVramMode],
  defaults: GemmaRuntimeOverrides[GemmaVramMode]
): boolean {
  return override?.useDraft !== undefined && override.useDraft !== defaults?.useDraft;
}

function usesCustomGemmaRuntimeSettings(gemma: Pick<GemmaSettings, "modelPreset" | "modelSource" | "modelRepo" | "modelFile">): boolean {
  if (gemma.modelSource === "local") {
    return true;
  }
  return resolveGemmaModelPreset(gemma.modelPreset, gemma.modelRepo, gemma.modelFile) === "custom";
}

function resolveTranslationUseDraft({
  envUseDraft,
  gemma,
  gemmaRuntimePreset,
  runtimeOverride,
  defaultRuntimeOverride,
  runtimeGemma,
  llamaRuntimeChoice = "auto"
}: {
  envUseDraft: boolean | undefined;
  gemma: GemmaSettings;
  gemmaRuntimePreset: GemmaRuntimePreset;
  runtimeOverride: GemmaRuntimeOverrides[GemmaVramMode];
  defaultRuntimeOverride: GemmaRuntimeOverrides[GemmaVramMode];
  runtimeGemma: GemmaSettings;
  llamaRuntimeChoice?: GemmaLlamaRuntimeChoice;
}): boolean {
  if (envUseDraft !== undefined) {
    return envUseDraft;
  }
  const requested =
    usesCustomGemmaRuntimeSettings(gemma)
      ? Boolean(gemmaRuntimePreset.useDraft)
      : Boolean(
          gemmaRuntimePreset.useDraft &&
            (hasCustomGemmaRuntimeDraftSettings(runtimeOverride, defaultRuntimeOverride)
              ? runtimeOverride?.useDraft !== false
              : isDefaultDflashDraftCompatible(runtimeGemma.modelSource, runtimeGemma.modelRepo, runtimeGemma.modelFile))
        );
  if (requested && llamaRuntimeChoice === "mainline") {
    return false;
  }
  return requested;
}

function resolveTranslationServerPath({
  paths,
  runtimeGemma,
  llamaRuntimeProfile,
  llamaRuntimeChoice,
  useDraft,
  runtimeEnv
}: {
  paths: TranslationOptionPaths;
  runtimeGemma: GemmaSettings;
  llamaRuntimeProfile: string;
  llamaRuntimeChoice: GemmaLlamaRuntimeChoice;
  useDraft: boolean;
  runtimeEnv: NodeJS.ProcessEnv;
}): string {
  return (
    resolveOptionalString(runtimeEnv.MANGA_TRANSLATOR_LLAMA_SERVER_PATH) ??
    resolveOptionalString(runtimeEnv.LLAMA_SERVER_PATH) ??
    resolveDefaultLlamaServerPathForGemma(paths, runtimeGemma, llamaRuntimeProfile, llamaRuntimeChoice, useDraft)
  );
}

function resolveTranslationGpuLayers(value: number | "fit" | "all" | undefined): number | "fit" | undefined {
  if (value === "all") {
    return undefined;
  }
  return value;
}

function resolveDefaultLlamaServerPathForGemma(
  paths: TranslationOptionPaths,
  gemma: AppSettings["gemma"],
  llamaRuntimeProfile = "cuda12",
  llamaRuntimeChoice: GemmaLlamaRuntimeChoice = "auto",
  useDraft = false
): string {
  const binaryName = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  const useCuda13 = isRtx50LlamaRuntimeProfile(llamaRuntimeProfile);
  const forcedKind = resolveForcedLlamaRuntimeKind(llamaRuntimeChoice);
  if (forcedKind === "mainline") {
    const runtimeDir = useCuda13 ? MAINLINE_LLAMA_RUNTIME_DIR_CUDA13 : MAINLINE_LLAMA_RUNTIME_DIR_CUDA12;
    return join(paths.dataRoot, "tools", runtimeDir, binaryName);
  }
  if (forcedKind === "beellama" || useDraft) {
    const runtimeDir = useCuda13 ? BEELLAMA_LLAMA_RUNTIME_DIR_CUDA13 : BEELLAMA_LLAMA_RUNTIME_DIR_CUDA12;
    return join(paths.dataRoot, "tools", runtimeDir, binaryName);
  }

  if (gemma.modelSource !== "huggingface" || !isBuiltInGemmaModel({ modelRepo: gemma.modelRepo, modelFile: gemma.modelFile })) {
    return paths.llamaServerPath;
  }
  const runtimeDir = is26BGemmaModel({ modelRepo: gemma.modelRepo, modelFile: gemma.modelFile })
    ? useCuda13 ? MAINLINE_LLAMA_RUNTIME_DIR_CUDA13 : MAINLINE_LLAMA_RUNTIME_DIR_CUDA12
    : useCuda13 ? BEELLAMA_LLAMA_RUNTIME_DIR_CUDA13 : BEELLAMA_LLAMA_RUNTIME_DIR_CUDA12;
  return join(paths.dataRoot, "tools", runtimeDir, binaryName);
}

function resolveForcedLlamaRuntimeKind(choice: GemmaLlamaRuntimeChoice): "mainline" | "beellama" | null {
  if (choice === "mainline") {
    return "mainline";
  }
  if (choice === "beellama") {
    return "beellama";
  }
  return null;
}

function resolveLlamaRuntimeProfile(env: NodeJS.ProcessEnv, ocrGpuCudaTag: string): string {
  const explicit = resolveOptionalString(env.MANGA_TRANSLATOR_LLAMA_RUNTIME_PROFILE);
  if (explicit) {
    return explicit.toLowerCase();
  }
  return isRtx50OcrCudaTag(ocrGpuCudaTag) ? "rtx50" : "cuda12";
}

function isRtx50LlamaRuntimeProfile(profile: string): boolean {
  const normalized = String(profile ?? "").trim().toLowerCase();
  return ["rtx50", "blackwell", "cuda13", "cuda13.1", "cuda13.3"].includes(normalized);
}

function isRtx50OcrCudaTag(tag: string): boolean {
  const normalized = String(tag ?? "").trim().toLowerCase();
  return normalized === RTX_50_OCR_GPU_CUDA_TAG || normalized === "cu13" || normalized === "cu131" || normalized === "cu133";
}

function isBuiltInGemmaModel(model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">): boolean {
  return is31BGemmaModel(model) || is26BGemmaModel(model);
}

function is31BGemmaModel(model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">): boolean {
  return model.modelRepo === GEMMA_31B_MODEL_REPO && model.modelFile === GEMMA_31B_MODEL_FILE_IQ3_S;
}

function is26BGemmaModel(model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">): boolean {
  return model.modelRepo === GEMMA_26B_MODEL_REPO && model.modelFile === GEMMA_26B_MODEL_FILE_IQ3_S;
}

function getDefaultMmprojForGemmaModel(
  model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">
): Pick<AppSettings["gemma"], "mmprojRepo" | "mmprojFile"> | undefined {
  if (is26BGemmaModel(model)) {
    return {
      mmprojRepo: GEMMA_26B_MMPROJ_REPO,
      mmprojFile: GEMMA_26B_MMPROJ_FILE
    };
  }
  if (is31BGemmaModel(model)) {
    return {
      mmprojRepo: GEMMA_31B_MMPROJ_REPO,
      mmprojFile: GEMMA_31B_MMPROJ_FILE
    };
  }
  return undefined;
}

function isBuiltInGemmaMmproj(mmprojRepo?: string, mmprojFile?: string): boolean {
  return (
    (mmprojRepo === GEMMA_31B_MMPROJ_REPO && mmprojFile === GEMMA_31B_MMPROJ_FILE) ||
    (mmprojRepo === GEMMA_26B_MMPROJ_REPO && mmprojFile === GEMMA_26B_MMPROJ_FILE)
  );
}

const LEGACY_GEMMA_MODEL_REPO = "unsloth/gemma-4-26B-A4B-it-GGUF";
const LEGACY_GEMMA_MODEL_FILES = new Set([
  "gemma-4-26B-A4B-it-UD-Q3_K_XL.gguf",
  "gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf",
  "gemma-4-26B-A4B-it-UD-Q6_K_XL.gguf"
]);

function resolveStoredGemmaModel(
  gemma: Record<string, unknown> | null,
  defaults: AppSettings,
  vramMode: GemmaVramMode = defaults.gemma.vramMode
): Pick<AppSettings["gemma"], "modelRepo" | "modelFile"> {
  const modelRepo = resolveNonEmptyString(gemma?.modelRepo, defaults.gemma.modelRepo);
  const modelFile = resolveNonEmptyString(gemma?.modelFile, defaults.gemma.modelFile);
  if (modelRepo === LEGACY_GEMMA_MODEL_REPO && LEGACY_GEMMA_MODEL_FILES.has(modelFile)) {
    return {
      modelRepo: defaults.gemma.modelRepo,
      modelFile: defaults.gemma.modelFile
    };
  }
  const resolvedModel = { modelRepo, modelFile };
  const modelSource = resolveModelSource(gemma?.modelSource, defaults.gemma.modelSource);
  const storedModelPreset = resolveGemmaModelPreset(asRecord(gemma)?.modelPreset, resolvedModel.modelRepo, resolvedModel.modelFile);
  const runtimeOverrides = resolveGemmaRuntimeOverrides(asRecord(gemma)?.runtimeOverrides);
  if (
    shouldPinGemmaModelToVramPreset({
      modelSource,
      ...resolvedModel,
      runtimeOverrides,
      modelPreset: storedModelPreset
    })
  ) {
    const preset = getDefaultGemmaPresetForVramMode(vramMode);
    return {
      modelRepo: preset.modelRepo,
      modelFile: preset.modelFile
    };
  }
  return resolvedModel;
}

function resolveStoredGemmaMmproj(
  gemma: Record<string, unknown> | null,
  model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">,
  defaults: AppSettings
): Pick<AppSettings["gemma"], "mmprojRepo" | "mmprojFile"> {
  const storedMmprojRepo = resolveOptionalString(gemma?.mmprojRepo);
  const storedMmprojFile = resolveOptionalString(gemma?.mmprojFile);
  const builtInMmproj = getDefaultMmprojForGemmaModel(model);
  if (
    builtInMmproj &&
    (!storedMmprojRepo || !storedMmprojFile || isBuiltInGemmaMmproj(storedMmprojRepo, storedMmprojFile))
  ) {
    return builtInMmproj;
  }
  if (storedMmprojRepo || storedMmprojFile) {
    return {
      mmprojRepo:
        storedMmprojRepo ??
        (storedMmprojFile ? model.modelRepo : undefined) ??
        defaults.gemma.mmprojRepo ??
        builtInMmproj?.mmprojRepo ??
        DEFAULT_GEMMA_MMPROJ_REPO,
      mmprojFile:
        storedMmprojFile ?? defaults.gemma.mmprojFile ?? builtInMmproj?.mmprojFile ?? DEFAULT_GEMMA_MMPROJ_FILE
    };
  }
  if (builtInMmproj) {
    return builtInMmproj;
  }
  return {};
}

function normalizeGemmaCustomModelPresets(value: unknown): GemmaCustomModelPreset[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const presets: GemmaCustomModelPreset[] = [];
  const seen = new Set<string>();
  value.slice(0, 40).forEach((item, index) => {
    const record = asRecord(item);
    const modelRepo = resolveOptionalString(record?.modelRepo);
    const modelFile = resolveOptionalString(record?.modelFile);
    if (!record || !modelRepo || !modelFile) {
      return;
    }

    const id = sanitizePresetId(resolveOptionalString(record.id) ?? `custom-${index + 1}`);
    const dedupeKey = id || `${modelRepo}\n${modelFile}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);

    const label = resolveOptionalString(record.label) ?? buildCustomPresetFallbackLabel(modelRepo, modelFile);
    const mmprojRepo = resolveOptionalString(record.mmprojRepo);
    const mmprojFile = resolveOptionalString(record.mmprojFile);
    presets.push({
      id: id || `custom-${presets.length + 1}`,
      label,
      modelRepo,
      modelFile,
      ...(mmprojRepo ? { mmprojRepo } : {}),
      ...(mmprojFile ? { mmprojFile } : {})
    });
  });
  return presets;
}

function ensureCurrentGemmaModelPreset(
  presets: GemmaCustomModelPreset[],
  model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile" | "mmprojRepo" | "mmprojFile">,
  modelSource: ModelSource
): GemmaCustomModelPreset[] {
  if (modelSource !== "huggingface") {
    return presets;
  }
  if (isBuiltInGemmaModel(model)) {
    return presets;
  }
  if (presets.some((preset) => preset.modelRepo === model.modelRepo && preset.modelFile === model.modelFile)) {
    return presets;
  }

  const usedIds = new Set(presets.map((preset) => preset.id));
  const baseId = sanitizePresetId(`${model.modelRepo}-${model.modelFile}`) || `custom-${presets.length + 1}`;
  let id = baseId;
  for (let suffix = 2; usedIds.has(id); suffix += 1) {
    id = `${baseId}-${suffix}`;
  }

  const mmprojRepo = resolveOptionalString(model.mmprojRepo);
  const mmprojFile = resolveOptionalString(model.mmprojFile);
  return [
    ...presets,
    {
      id,
      label: buildCustomPresetFallbackLabel(model.modelRepo, model.modelFile),
      modelRepo: model.modelRepo,
      modelFile: model.modelFile,
      ...(mmprojRepo ? { mmprojRepo } : {}),
      ...(mmprojFile ? { mmprojFile } : {})
    }
  ];
}

function sanitizePresetId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildCustomPresetFallbackLabel(modelRepo: string, modelFile: string): string {
  const repoName = modelRepo.split("/").filter(Boolean).pop() ?? modelRepo;
  const fileName = modelFile.replace(/\.gguf$/i, "");
  return `${repoName} / ${fileName}`.slice(0, 120);
}
