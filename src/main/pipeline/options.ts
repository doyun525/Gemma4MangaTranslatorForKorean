import { join } from "node:path";
import { buildBaseTranslationOptions, type TranslationOptions } from "../appSettings";
import { getAppPaths, type AppPaths } from "../appPaths";
import type { AppSettings, MangaPage } from "../../shared/types";

export function buildBaseOptions(
  jobId: string,
  runDir: string,
  settings: AppSettings,
  paths: AppPaths = getAppPaths(),
  env: NodeJS.ProcessEnv = process.env
): TranslationOptions {
  return buildBaseTranslationOptions({
    jobId,
    runDir,
    paths,
    settings,
    env
  });
}

export function buildPageOptions(baseOptions: TranslationOptions, page: MangaPage, index: number, attempt: number): TranslationOptions {
  return {
    ...baseOptions,
    imagePath: page.imagePath,
    imageWidth: page.width,
    imageHeight: page.height,
    outputDir: join(baseOptions.outputDir, "pages", page.id, `attempt-${attempt}`),
    label: `page-${index + 1}-attempt-${attempt}`
  };
}

export function formatGemmaVramMode(mode: TranslationOptions["gemmaVramMode"]): string {
  return mode === "economy" ? "VRAM 절약 모드" : "VRAM 풀로드 모드";
}

export const OCR_TEXT_TRANSLATION_CHUNK_SIZE_CODEX = 80;
export const OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_FULL = 50;
export const OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_ECONOMY = 20;

export function resolveOcrTextTranslationChunkSize(
  options: Pick<TranslationOptions, "modelProvider" | "gemmaVramMode">
): number {
  const provider = String(options.modelProvider ?? "").trim();
  if (provider === "openai-codex") {
    return OCR_TEXT_TRANSLATION_CHUNK_SIZE_CODEX;
  }
  if (options.gemmaVramMode === "economy") {
    return OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_ECONOMY;
  }
  return OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_FULL;
}

export function summarizeTranslationOptions(options: TranslationOptions): Record<string, unknown> {
  return {
    label: options.label,
    imagePath: options.imagePath,
    outputDir: options.outputDir,
    modelProvider: options.modelProvider,
    port: options.port,
    promptMode: options.promptMode,
    promptOverrideText: options.promptOverrideText ? summarizePreview(options.promptOverrideText, 600) : undefined,
    temperature: options.temperature,
    topP: options.topP,
    topK: options.topK,
    maxTokens: options.maxTokens,
    ctx: options.ctx,
    batch: options.batch,
    ubatch: options.ubatch,
    gemmaVramMode: options.gemmaVramMode,
    fitTargetMb: options.fitTargetMb,
    gpuLayers: options.gpuLayers,
    cacheTypeK: options.cacheTypeK,
    cacheTypeV: options.cacheTypeV,
    ctxCheckpoints: options.ctxCheckpoints,
    kvOffload: options.kvOffload,
    mmprojOffload: options.mmprojOffload,
    useDraft: options.useDraft,
    draftModelRepo: options.draftModelRepo,
    draftModelFile: options.draftModelFile,
    imageMinTokens: options.imageMinTokens,
    imageMaxTokens: options.imageMaxTokens,
    includeEnhancedVariant: options.includeEnhancedVariant,
    enhancedMaxLongSide: options.enhancedMaxLongSide,
    enhancedContrast: options.enhancedContrast,
    imageFirst: options.imageFirst,
    reuseServer: options.reuseServer,
    workingDir: options.workingDir,
    toolsDir: options.toolsDir,
    serverPath: options.serverPath,
    modelRepo: options.modelRepo,
    modelFile: options.modelFile,
    mmprojRepo: options.mmprojRepo,
    mmprojFile: options.mmprojFile,
    codexModel: options.codexModel,
    codexReasoningEffort: options.codexReasoningEffort,
    codexOauthPort: options.codexOauthPort,
    ocrDevice: options.ocrDevice,
    ocrEngine: options.ocrEngine,
    ocrGpuCudaTag: options.ocrGpuCudaTag,
    translationMode: options.translationMode,
    includeSoundEffects: options.includeSoundEffects,
    ocrBboxExpandXRatio: options.ocrBboxExpandXRatio,
    ocrBboxExpandYRatio: options.ocrBboxExpandYRatio,
    textOutlineWidthPx: options.textOutlineWidthPx,
    hfHomeDir: options.hfHomeDir ?? null,
    hfHubCacheDir: options.hfHubCacheDir ?? null
  };
}

export function summarizePreview(text: string, maxLength = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

export function readNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}
