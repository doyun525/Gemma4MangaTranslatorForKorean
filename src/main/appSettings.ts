import { join } from "node:path";
import type {
  AppSettings,
  CodexReasoningEffort,
  GemmaCustomModelPreset,
  GemmaVramMode,
  JobPhase,
  ModelProvider,
  ModelSource,
  OcrDevice,
  OcrEngine,
  StorageSettings,
  TranslationMode
} from "../shared/types";
import type { DetectedGpuInfo } from "./gpuInfo";

export const DEFAULT_GEMMA_MODEL_REPO =
  "mradermacher/gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking-i1-GGUF";
export const DEFAULT_GEMMA_MODEL_FILE_IQ3_S =
  "gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking.i1-IQ3_S.gguf";
export const DEFAULT_GEMMA_MODEL_FILE = DEFAULT_GEMMA_MODEL_FILE_IQ3_S;
export const DEFAULT_GEMMA_MMPROJ_REPO =
  "mradermacher/gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking-GGUF";
export const DEFAULT_GEMMA_MMPROJ_FILE =
  "gemma-4-31B-it-The-DECKARD-HERETIC-UNCENSORED-Thinking.mmproj-f16.gguf";
export const DEFAULT_GEMMA_DRAFT_MODEL_REPO = "Anbeeld/gemma-4-31B-it-DFlash-GGUF";
export const DEFAULT_GEMMA_DRAFT_MODEL_FILE = "gemma4-31b-it-dflash-IQ4_XS.gguf";
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

type GemmaRuntimePreset = {
  ctx: number;
  batch: number;
  ubatch: number;
  fitTargetMb: number;
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
};

const GEMMA_RUNTIME_PRESETS: Record<GemmaVramMode, GemmaRuntimePreset> = {
  full: {
    ctx: 16384,
    batch: 2048,
    ubatch: 1536,
    fitTargetMb: 4096,
    cacheTypeK: "q4_0",
    cacheTypeV: "q4_0",
    ctxCheckpoints: 0,
    mmprojOffload: false,
    enableMetrics: true,
    enablePerf: true,
    draftModelRepo: DEFAULT_GEMMA_DRAFT_MODEL_REPO,
    draftModelFile: DEFAULT_GEMMA_DRAFT_MODEL_FILE,
    useDraft: true
  },
  economy: {
    ctx: 8192,
    batch: 1024,
    ubatch: 1024,
    fitTargetMb: 1024,
    cacheTypeK: "q4_0",
    cacheTypeV: "q4_0",
    ctxCheckpoints: 0,
    kvOffload: true,
    mmprojOffload: false,
    enableMetrics: true,
    enablePerf: true,
    useDraft: false
  }
};

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
  label: string;
  abortSignal?: AbortSignal;
};

export type TranslationOptionPaths = {
  dataRoot: string;
  toolsDir: string;
  ocrRuntimeDir?: string;
  llamaServerPath: string;
  hfHomeDir?: string;
  hfHubCacheDir?: string;
};

export function resolveDefaultAppSettings(
  env: NodeJS.ProcessEnv = process.env,
  detectedGpu?: number | DetectedGpuInfo | null
): AppSettings {
  const hardwareDefaults = resolveHardwareDefaults(detectedGpu);
  return {
    modelProvider: resolveModelProvider(env.MANGA_TRANSLATOR_MODEL_PROVIDER, hardwareDefaults.modelProvider),
    gemma: {
      modelSource: DEFAULT_MODEL_SOURCE,
      modelRepo: resolveNonEmptyString(env.MANGA_TRANSLATOR_MODEL_HF, DEFAULT_GEMMA_MODEL_REPO),
      modelFile: resolveNonEmptyString(env.LLAMA_ARG_HF_FILE, DEFAULT_GEMMA_MODEL_FILE),
      mmprojRepo: resolveOptionalString(env.MANGA_TRANSLATOR_MMPROJ_HF) ?? DEFAULT_GEMMA_MMPROJ_REPO,
      mmprojFile: resolveOptionalString(env.LLAMA_ARG_MMPROJ_FILE) ?? DEFAULT_GEMMA_MMPROJ_FILE,
      vramMode: resolveGemmaVramMode(env.MANGA_TRANSLATOR_GEMMA_VRAM_MODE, hardwareDefaults.gemmaVramMode)
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
  const resolvedModel = resolveStoredGemmaModel(asRecord(gemma), defaults);
  const resolvedMmproj =
    modelSource === "huggingface" ? resolveStoredGemmaMmproj(asRecord(gemma), resolvedModel, defaults) : {};
  const localModelPath = resolveOptionalString(asRecord(gemma)?.localModelPath);
  const localMmprojPath = resolveOptionalString(asRecord(gemma)?.localMmprojPath);
  const customModelPresets = ensureCurrentGemmaModelPreset(
    normalizeGemmaCustomModelPresets(asRecord(gemma)?.customModelPresets),
    resolvedModel,
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
      vramMode: resolveGemmaVramMode(asRecord(gemma)?.vramMode, defaults.gemma.vramMode)
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
      gpuCudaTag: resolveStoredOcrGpuCudaTag(resolvedOcr, defaults)
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

  try {
    return normalizeAppSettings(JSON.parse(rawText), defaults);
  } catch {
    return defaults;
  }
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
  const gemmaVramMode = resolveGemmaVramMode(env.MANGA_TRANSLATOR_GEMMA_VRAM_MODE, settings.gemma.vramMode);
  const gemmaRuntimePreset = GEMMA_RUNTIME_PRESETS[gemmaVramMode];
  const modelCacheDir = resolveOptionalString(settings.storage?.modelCacheDir);
  const envUseDraft = readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_USE_DRAFT");
  const useDraft =
    envUseDraft ??
    Boolean(gemmaRuntimePreset.useDraft && isDefaultDflashDraftCompatible(settings.gemma.modelSource, settings.gemma.modelRepo, settings.gemma.modelFile));
  return {
    imagePath: "",
    outputDir: runDir,
    modelProvider: settings.modelProvider,
    port: readNumberEnv(env, "MANGA_TRANSLATOR_LLAMA_PORT", 18180),
    promptMode: "ko_bbox_lines_multiview",
    temperature: readNumberEnv(env, "MANGA_TRANSLATOR_TEMPERATURE", 0.2),
    topP: readNumberEnv(env, "MANGA_TRANSLATOR_TOP_P", 0.95),
    topK: readNumberEnv(env, "MANGA_TRANSLATOR_TOP_K", 64),
    maxTokens: resolveMaxTokens(env.MANGA_TRANSLATOR_MAX_TOKENS, settings.maxTokens),
    ctx: readNumberEnv(env, "MANGA_TRANSLATOR_CTX", gemmaRuntimePreset.ctx),
    batch: readNumberEnv(env, "MANGA_TRANSLATOR_BATCH", gemmaRuntimePreset.batch),
    ubatch: readNumberEnv(env, "MANGA_TRANSLATOR_UBATCH", gemmaRuntimePreset.ubatch),
    gemmaVramMode,
    fitTargetMb: readNumberEnv(env, "MANGA_TRANSLATOR_FIT_TARGET_MB", gemmaRuntimePreset.fitTargetMb),
    cacheTypeK:
      resolveOptionalString(env.MANGA_TRANSLATOR_GEMMA_CACHE_TYPE_K ?? env.MANGA_TRANSLATOR_CACHE_TYPE_K) ??
      gemmaRuntimePreset.cacheTypeK,
    cacheTypeV:
      resolveOptionalString(env.MANGA_TRANSLATOR_GEMMA_CACHE_TYPE_V ?? env.MANGA_TRANSLATOR_CACHE_TYPE_V) ??
      gemmaRuntimePreset.cacheTypeV,
    ctxCheckpoints:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_CTX_CHECKPOINTS") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_CTX_CHECKPOINTS") ??
      gemmaRuntimePreset.ctxCheckpoints,
    kvOffload: readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_KV_OFFLOAD") ?? gemmaRuntimePreset.kvOffload,
    mmprojOffload:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_MMPROJ_OFFLOAD") ?? gemmaRuntimePreset.mmprojOffload,
    threads:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_THREADS") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_THREADS") ??
      gemmaRuntimePreset.threads,
    threadsBatch:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_THREADS_BATCH") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_THREADS_BATCH") ??
      gemmaRuntimePreset.threadsBatch,
    poll:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_POLL") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_POLL") ??
      gemmaRuntimePreset.poll,
    pollBatch:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_GEMMA_POLL_BATCH") ??
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_POLL_BATCH") ??
      gemmaRuntimePreset.pollBatch,
    prioBatch:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_PRIO_BATCH") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_PRIO_BATCH") ??
      gemmaRuntimePreset.prioBatch,
    cacheIdleSlots:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_GEMMA_CACHE_IDLE_SLOTS") ??
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_CACHE_IDLE_SLOTS") ??
      gemmaRuntimePreset.cacheIdleSlots,
    cacheReuse:
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_GEMMA_CACHE_REUSE") ??
      readOptionalNumberEnv(env, "MANGA_TRANSLATOR_CACHE_REUSE") ??
      gemmaRuntimePreset.cacheReuse,
    enableMetrics:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_GEMMA_METRICS") ??
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_METRICS") ??
      gemmaRuntimePreset.enableMetrics,
    enablePerf:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_GEMMA_PERF") ??
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_PERF") ??
      gemmaRuntimePreset.enablePerf,
    draftModelRepo:
      resolveOptionalString(env.MANGA_TRANSLATOR_DRAFT_MODEL_HF) ?? gemmaRuntimePreset.draftModelRepo,
    draftModelFile:
      resolveOptionalString(env.MANGA_TRANSLATOR_DRAFT_MODEL_FILE) ?? gemmaRuntimePreset.draftModelFile,
    useDraft,
    imageMinTokens: readNumberEnv(env, "MANGA_TRANSLATOR_IMAGE_MIN_TOKENS", DEFAULT_IMAGE_TOKENS),
    imageMaxTokens: readNumberEnv(env, "MANGA_TRANSLATOR_IMAGE_MAX_TOKENS", DEFAULT_IMAGE_TOKENS),
    includeEnhancedVariant: false,
    enhancedMaxLongSide: 1900,
    enhancedContrast: 1.35,
    imageFirst: true,
    reuseServer: true,
    workingDir: paths.dataRoot,
    toolsDir: paths.toolsDir,
    serverPath: paths.llamaServerPath,
    modelSource: settings.gemma.modelSource,
    modelRepo: settings.gemma.modelRepo,
    modelFile: settings.gemma.modelFile,
    mmprojRepo:
      settings.gemma.modelSource === "huggingface"
        ? settings.gemma.mmprojRepo ??
          (settings.gemma.modelRepo === DEFAULT_GEMMA_MODEL_REPO ? DEFAULT_GEMMA_MMPROJ_REPO : undefined)
        : undefined,
    mmprojFile:
      settings.gemma.modelSource === "huggingface"
        ? settings.gemma.mmprojFile ??
          (settings.gemma.modelRepo === DEFAULT_GEMMA_MODEL_REPO ? DEFAULT_GEMMA_MMPROJ_FILE : undefined)
        : undefined,
    localModelPath: settings.gemma.localModelPath,
    localMmprojPath: settings.gemma.localMmprojPath,
    codexModel: settings.codex.model,
    codexReasoningEffort: resolveCodexReasoningEffort(env.MANGA_TRANSLATOR_CODEX_REASONING_EFFORT, settings.codex.reasoningEffort),
    codexOauthPort: settings.codex.oauthPort,
    translationMode: resolveTranslationMode(env.MANGA_TRANSLATOR_TRANSLATION_MODE, settings.translation.mode),
    includeSoundEffects:
      readOptionalBooleanEnv(env, "MANGA_TRANSLATOR_INCLUDE_SOUND_EFFECTS") ??
      settings.translation.includeSoundEffects,
    ocrBboxExpandXRatio: resolveOcrBboxExpandRatio(
      env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X_RATIO ?? env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_X,
      settings.translation.ocrBboxExpandXRatio
    ),
    ocrBboxExpandYRatio: resolveOcrBboxExpandRatio(
      env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y_RATIO ?? env.MANGA_TRANSLATOR_OCR_BBOX_EXPAND_Y,
      settings.translation.ocrBboxExpandYRatio
    ),
    textOutlineWidthPx: resolveTextOutlineWidthPx(
      env.MANGA_TRANSLATOR_TEXT_OUTLINE_WIDTH_PX,
      settings.translation.textOutlineWidthPx
    ),
    ocrDevice: resolveOcrDevice(env.MANGA_TRANSLATOR_OCR_DEVICE, settings.ocr.device),
    ocrEngine: resolveOcrEngine(
      env.MANGA_TRANSLATOR_OCR_ENGINE ?? env.MANGA_TRANSLATOR_OCR_BBOX_PROVIDER,
      settings.ocr.engine
    ),
    ocrBatchSize: resolveOcrBatchSize(env.MANGA_TRANSLATOR_OCR_BATCH_SIZE, settings.ocr.batchSize),
    ocrGpuCudaTag: resolveOcrGpuCudaTag(
      env.MANGA_TRANSLATOR_OCR_GPU_CUDA_TAG ??
        env.MANGA_TRANSLATOR_PADDLEOCR_CUDA_TAG ??
        env.MANGA_TRANSLATOR_OCR_GPU_CUDA,
      settings.ocr.gpuCudaTag ?? DEFAULT_OCR_GPU_CUDA_TAG
    ),
    ocrBboxProvider:
      resolveOptionalString(env.MANGA_TRANSLATOR_OCR_BBOX_PROVIDER) ??
      resolveOcrEngine(env.MANGA_TRANSLATOR_OCR_ENGINE, settings.ocr.engine),
    ocrBboxCommand: resolveOptionalString(env.MANGA_TRANSLATOR_OCR_BBOX_CMD),
    ocrBboxHintsPath: resolveOptionalString(env.MANGA_TRANSLATOR_OCR_BBOX_HINTS_PATH),
    ocrRuntimeDir: paths.ocrRuntimeDir,
    modelCacheDir,
    hfHomeDir: modelCacheDir ?? paths.hfHomeDir,
    hfHubCacheDir: modelCacheDir ? join(modelCacheDir, "hub") : paths.hfHubCacheDir,
    label: `app-${jobId}`
  };
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

function readOptionalBooleanEnv(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const raw = env[name];
  if (raw === undefined || raw === "") {
    return undefined;
  }
  return resolveOptionalBoolean(raw);
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

function resolveModelProvider(value: unknown, fallback: ModelProvider): ModelProvider {
  return value === "openai-codex" || value === "gemma" ? value : fallback;
}

function resolveModelSource(value: unknown, fallback: ModelSource): ModelSource {
  return value === "local" || value === "huggingface" ? value : fallback;
}

function resolveGemmaVramMode(value: unknown, fallback: GemmaVramMode): GemmaVramMode {
  return value === "economy" || value === "full" ? value : fallback;
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

function resolveOcrBatchSize(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }
  return clampInteger(parsed, MIN_OCR_BATCH_SIZE, MAX_OCR_BATCH_SIZE);
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
  return clampInteger(parsed, 0, 65535);
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

const LEGACY_GEMMA_MODEL_REPO = "unsloth/gemma-4-26B-A4B-it-GGUF";
const LEGACY_GEMMA_MODEL_FILES = new Set([
  "gemma-4-26B-A4B-it-UD-Q3_K_XL.gguf",
  "gemma-4-26B-A4B-it-UD-Q4_K_XL.gguf",
  "gemma-4-26B-A4B-it-UD-Q6_K_XL.gguf"
]);

function resolveStoredGemmaModel(
  gemma: Record<string, unknown> | null,
  defaults: AppSettings
): Pick<AppSettings["gemma"], "modelRepo" | "modelFile"> {
  const modelRepo = resolveNonEmptyString(gemma?.modelRepo, defaults.gemma.modelRepo);
  const modelFile = resolveNonEmptyString(gemma?.modelFile, defaults.gemma.modelFile);
  if (modelRepo === LEGACY_GEMMA_MODEL_REPO && LEGACY_GEMMA_MODEL_FILES.has(modelFile)) {
    return {
      modelRepo: defaults.gemma.modelRepo,
      modelFile: defaults.gemma.modelFile
    };
  }
  return { modelRepo, modelFile };
}

function resolveStoredGemmaMmproj(
  gemma: Record<string, unknown> | null,
  model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">,
  defaults: AppSettings
): Pick<AppSettings["gemma"], "mmprojRepo" | "mmprojFile"> {
  const storedMmprojRepo = resolveOptionalString(gemma?.mmprojRepo);
  const storedMmprojFile = resolveOptionalString(gemma?.mmprojFile);
  if (storedMmprojRepo || storedMmprojFile) {
    return {
      mmprojRepo: storedMmprojRepo ?? defaults.gemma.mmprojRepo ?? DEFAULT_GEMMA_MMPROJ_REPO,
      mmprojFile: storedMmprojFile ?? defaults.gemma.mmprojFile ?? DEFAULT_GEMMA_MMPROJ_FILE
    };
  }
  if (model.modelRepo === DEFAULT_GEMMA_MODEL_REPO) {
    return {
      mmprojRepo: defaults.gemma.mmprojRepo ?? DEFAULT_GEMMA_MMPROJ_REPO,
      mmprojFile: defaults.gemma.mmprojFile ?? DEFAULT_GEMMA_MMPROJ_FILE
    };
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
  model: Pick<AppSettings["gemma"], "modelRepo" | "modelFile">,
  modelSource: ModelSource
): GemmaCustomModelPreset[] {
  if (modelSource !== "huggingface") {
    return presets;
  }
  if (model.modelRepo === DEFAULT_GEMMA_MODEL_REPO && model.modelFile === DEFAULT_GEMMA_MODEL_FILE) {
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

  return [
    ...presets,
    {
      id,
      label: buildCustomPresetFallbackLabel(model.modelRepo, model.modelFile),
      modelRepo: model.modelRepo,
      modelFile: model.modelFile
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
