import { nativeImage } from "electron";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { DEFAULT_OCR_BBOX_EXPAND_X_RATIO, DEFAULT_OCR_BBOX_EXPAND_Y_RATIO, buildBaseTranslationOptions, type TranslationOptions } from "./appSettings";
import { logError, logInfo, logWarn } from "./logger";
import { startOpenAIOAuthEndpoint, stopOpenAIOAuthEndpoint, type OpenAIOAuthEndpoint } from "./openaiOauthEndpoint";
import { resolveBlockVisualStyle } from "../shared/blockVisuals";
import { estimateBlockFontSizePx, clamp, clampBbox, enforceRenderDirection, enforceRotationDeg, normalizeBlockType, pixelsToBbox } from "../shared/geometry";
import type { AppSettings, BBox, BlockType, JobEvent, MangaPage, RenderTextDirection, SourceTextDirection, TranslationBlock } from "../shared/types";
import { getAppPaths } from "./appPaths";
import type { ChapterRunPaths } from "./library";
import { getAppSettings } from "./settingsStore";

type PipelineOptions = {
  jobId: string;
  pages: MangaPage[];
  runPaths: ChapterRunPaths;
  emit: (event: JobEvent) => void;
  signal: AbortSignal;
  skipOcrPrepass?: boolean;
  onCleanupReady?: (cleanup: () => Promise<void>) => void;
  onPageComplete?: (page: MangaPage) => Promise<void>;
  onPageFailed?: (page: MangaPage, errorMessage: string) => Promise<void>;
};

type ServerHandle = {
  baseUrl: string;
  child: unknown;
  startedByScript: boolean;
};

type ModelEndpointHandle = ServerHandle | OpenAIOAuthEndpoint;

type TranslationResult = {
  outputText: string;
  rawResponse: unknown;
  requestBody: RequestSummary | unknown;
};

type OcrBboxResult = {
  hints: unknown[];
  diagnostics: unknown[];
  noTextDetected?: boolean;
  textEvidenceCount?: number;
};

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type SampledBackground = {
  color: Rgb;
  flat: boolean;
  dominance: number;
  maxStddev: number;
};

const OCR_HINT_CACHE_SCHEMA_VERSION = 2;

type OverlayItem = {
  id: number;
  type: string;
  bbox: BBox;
  jp: string;
  ko: string;
  direction?: SourceTextDirection;
  angle?: number;
  fontSize?: number | null;
  confidence?: number | null;
};

type CropRetryTarget = {
  id: number;
  type: string;
  bbox: BBox;
  cropBox: BBox;
  jp: string;
  ko: string;
  direction?: SourceTextDirection;
  angle?: number;
  fontSize?: number | null;
  confidence?: number | null;
};

type DetectedBboxSpace = "normalized_1000" | "pixels";

type RequestSummary = {
  bboxCoordinateSpace?: DetectedBboxSpace;
  bboxCoordinateFrame?: {
    width?: number;
    height?: number;
  };
  ocrBboxHints?: Array<{
    id?: number;
    label?: string;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
    ocrText?: string;
    score?: number | null;
  }>;
  noTextDetected?: boolean;
  ocrTextEvidenceCount?: number;
};

type BboxNormalizationOptions = {
  coordinateSpace?: DetectedBboxSpace;
  pixelWidth?: number;
  pixelHeight?: number;
};

type RuntimeModules = {
  simplePage: {
    collectOcrBboxHints: (options: TranslationOptions) => Promise<OcrBboxResult>;
    collectOcrBboxHintsBatch?: (options: TranslationOptions[]) => Promise<OcrBboxResult[]>;
    requestTranslation: (server: ServerHandle, options: TranslationOptions) => Promise<TranslationResult>;
    requestCropRetryTranslation?: (server: ServerHandle, options: TranslationOptions, targets: CropRetryTarget[]) => Promise<TranslationResult>;
    saveArtifacts: (options: TranslationOptions, result: TranslationResult) => Promise<void>;
    startServer: (options: TranslationOptions) => Promise<ServerHandle>;
    stopServer: (server: ServerHandle | null | undefined) => Promise<void>;
    isModelCached: (options: TranslationOptions) => boolean;
  };
  overlayTools: {
    normalizeItems: (parsed: unknown) => OverlayItem[];
    parseRetryItems?: (rawText: string) => Array<Omit<OverlayItem, "bbox">>;
    parseJsonLenient: (rawText: string) => unknown;
  };
};

type OcrPageTaskOptions = {
  runtime: RuntimeModules;
  baseOptions: TranslationOptions;
  page: MangaPage;
  index: number;
  total: number;
  runPaths: ChapterRunPaths;
  emit: (event: JobEvent) => void;
  jobId: string;
  signal: AbortSignal;
};

let cachedRuntimeDir: string | null = null;
let cachedRuntime: RuntimeModules | null = null;

function loadRuntimeModules(): RuntimeModules {
  const runtimeDir = getAppPaths().runtimeDir;
  if (cachedRuntime && cachedRuntimeDir === runtimeDir) {
    return cachedRuntime;
  }

  cachedRuntimeDir = runtimeDir;
  cachedRuntime = {
    simplePage: require(join(runtimeDir, "simple-page-translate.cjs")) as RuntimeModules["simplePage"],
    overlayTools: require(join(runtimeDir, "overlay-parser.cjs")) as RuntimeModules["overlayTools"]
  };
  return cachedRuntime;
}

const DEFAULT_TEXT_COLOR = "#111111";
const DEFAULT_OUTLINE_COLOR = "#ffffff";
const CROP_RETRY_CONFIDENCE_THRESHOLD = 0.72;
const CROP_RETRY_MAX_ITEMS_PER_PAGE = 8;
const CROP_RETRY_MIN_SIDE_PX = 192;
const CROP_RETRY_MIN_MARGIN_PX = 64;
const CROP_RETRY_MARGIN_RATIO = 0.5;

export async function runWholePagePipeline({
  jobId,
  emit,
  onCleanupReady,
  onPageComplete,
  onPageFailed,
  pages,
  runPaths,
  signal,
  skipOcrPrepass = false
}: PipelineOptions): Promise<{ pages: MangaPage[]; warnings: string[] }> {
  if (pages.length === 0) {
    return { pages: [], warnings: [] };
  }

  throwIfAborted(signal);

  const paths = getAppPaths();
  const appSettings = await getAppSettings(paths);
  const runtime = loadRuntimeModules();
  const baseOptions = buildBaseOptions(jobId, runPaths.runDir, appSettings, paths);
  const progressTotal = pages.length;
  const codexSelected = baseOptions.modelProvider === "openai-codex";
  const modelCached = codexSelected || runtime.simplePage.isModelCached(baseOptions);
  const localModelSelected = !codexSelected && baseOptions.modelSource === "local";
  const warnings: string[] = [];

  logInfo("Analysis pipeline initialized", {
    jobId,
    pageCount: pages.length,
    runPaths,
    modelCached,
    settings: summarizeTranslationOptions(baseOptions)
  });

  if (skipOcrPrepass) {
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "starting",
      progressText: "AI 직접 분석 준비 중",
      phase: "booting",
      progressCurrent: 0,
      progressTotal,
      pageTotal: pages.length,
      detail: "선택 영역은 Paddle OCR 선분석 없이 모델이 직접 텍스트 그룹을 찾습니다."
    });
  } else {
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "starting",
      progressText: "Paddle OCR 선분석 준비 중",
      phase: "ocr_preparing",
      progressCurrent: 0,
      progressTotal,
      pageTotal: pages.length,
      detail: "대상 페이지의 OCR 후보 좌표를 먼저 준비합니다."
    });
  }

  baseOptions.onProgress = (progress) => {
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "starting",
      progressText: progress.progressText,
      phase: progress.phase,
      progressCurrent: 0,
      progressTotal,
      pageTotal: pages.length,
      detail: progress.detail,
      progressMode: progress.progressMode,
      progressPercent: progress.progressPercent,
      progressBytes: progress.progressBytes,
      progressTotalBytes: progress.progressTotalBytes,
      progressBytesPerSecond: progress.progressBytesPerSecond,
      installLogLine: progress.installLogLine
    });
  };
  baseOptions.abortSignal = signal;

  if (skipOcrPrepass) {
    logInfo("OCR prepass skipped for analysis pipeline", {
      jobId,
      pageCount: pages.length
    });
  }

  throwIfAborted(signal);

  const serializeGpuOcrWithModel = !skipOcrPrepass && shouldSerializeGpuOcrWithModel(baseOptions);
  const precomputedOcrResults = serializeGpuOcrWithModel
    ? await prepareOcrHintsForPages({
        runtime,
        baseOptions,
        pages,
        runPaths,
        emit,
        jobId,
        signal
      })
    : new Map<string, OcrBboxResult>();

  const pageIndexById = new Map(pages.map((page, index) => [page.id, index]));
  const completedPagesById = new Map<string, MangaPage>();
  let translatedPageCount = 0;
  let nextOcrTask: Promise<OcrBboxResult> | null = skipOcrPrepass || serializeGpuOcrWithModel
    ? null
    : startOcrHintsForPage({
        runtime,
        baseOptions,
        page: pages[0],
        index: 0,
        total: pages.length,
        runPaths,
        emit,
        jobId,
        signal
      });

  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "starting",
    progressText: localModelSelected
      ? "로컬 모델/서버 준비 중"
      : codexSelected
        ? "OpenAI Codex 엔드포인트 준비 중"
        : modelCached
          ? "Gemma 4 서버 시작 중"
          : "모델 다운로드/서버 준비 중",
    phase: localModelSelected || modelCached || codexSelected ? "booting" : "model_downloading",
    progressCurrent: 0,
    progressTotal,
    pageTotal: pages.length,
    detail: localModelSelected
      ? "선택한 로컬 모델을 불러오는 중입니다. 큰 모델은 시작까지 시간이 걸릴 수 있습니다."
      : codexSelected
        ? `${baseOptions.codexModel}, thinking ${baseOptions.codexReasoningEffort}`
        : modelCached
          ? `${formatGemmaVramMode(baseOptions.gemmaVramMode)}, ${baseOptions.modelFile}`
          : "로컬 모델 자산이 없거나 부족해 다운로드/갱신이 필요할 수 있습니다."
  });

  const server = await startModelEndpoint(runtime, baseOptions);
  onCleanupReady?.(() => stopModelEndpoint(runtime, server));
  const maxAttempts = Math.max(1, readNumberEnv("MANGA_TRANSLATOR_PAGE_RETRIES", 5));

  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "running",
    progressText: "모델 준비 완료",
    phase: "ready",
    progressCurrent: 0,
    progressTotal,
    pageTotal: pages.length,
    detail: codexSelected ? `openai-oauth ready at ${server.baseUrl}` : `server ready on port ${baseOptions.port}`
  });

  const buildRequestPageOptions = (
    page: MangaPage,
    pageIndex: number,
    attempt: number,
    ocrResult?: OcrBboxResult | null
  ): TranslationOptions => {
    const pageOptions = buildPageOptions(baseOptions, page, pageIndex, attempt);
    if (skipOcrPrepass) {
      pageOptions.skipOcrBboxHints = true;
      pageOptions.regionCropMode = true;
      pageOptions.ocrBboxProvider = "none";
      delete pageOptions.ocrBboxHints;
    } else {
      pageOptions.ocrBboxHints = ocrResult?.hints ?? [];
    }
    pageOptions.abortSignal = signal;
    pageOptions.onProgress = (progress) => {
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: progress.progressText,
        phase: progress.phase,
        progressCurrent: pageIndex + 1,
        progressTotal,
        pageIndex: pageIndex + 1,
        pageTotal: pages.length,
        attempt,
        attemptTotal: maxAttempts,
        detail: progress.detail,
        progressMode: progress.progressMode,
        progressPercent: progress.progressPercent,
        progressBytes: progress.progressBytes,
        progressTotalBytes: progress.progressTotalBytes,
        progressBytesPerSecond: progress.progressBytesPerSecond,
        installLogLine: progress.installLogLine
      });
    };
    return pageOptions;
  };

  try {
    for (let translateIndex = 0; translateIndex < pages.length; translateIndex += 1) {
      const page = pages[translateIndex];
      const index = pageIndexById.get(page.id) ?? 0;
      throwIfAborted(signal);

      const currentOcrTask = nextOcrTask;
      const ocrResult = serializeGpuOcrWithModel ? precomputedOcrResults.get(page.id) ?? null : currentOcrTask ? await currentOcrTask : null;
      if (!skipOcrPrepass && !serializeGpuOcrWithModel && translateIndex + 1 < pages.length) {
        nextOcrTask = startOcrHintsForPage({
          runtime,
          baseOptions,
          page: pages[translateIndex + 1],
          index: translateIndex + 1,
          total: pages.length,
          runPaths,
          emit,
          jobId,
          signal
        });
      } else {
        nextOcrTask = null;
      }

      if (isOcrResultNoTextDetected(ocrResult)) {
        const noTextPage = buildNoTextCompletedPage(page);
        completedPagesById.set(page.id, noTextPage);
        await onPageComplete?.(noTextPage);
        emit({
          id: jobId,
          kind: "gemma-analysis",
          status: "running",
          progressText: `${page.name} 텍스트 없음`,
          phase: "page_done",
          progressCurrent: index + 1,
          progressTotal,
          pageIndex: index + 1,
          pageTotal: pages.length,
          detail: "Paddle OCR에서 번역 대상 텍스트 근거를 찾지 못해 모델 호출을 생략했습니다."
        });
        continue;
      }

      let successPage: MangaPage | null = null;
      let lastErrorMessage = "";
      let lastError: unknown;
      let lastPageOptions: TranslationOptions | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAborted(signal);

        const pageOptions = buildRequestPageOptions(page, index, attempt, ocrResult);
        lastPageOptions = pageOptions;
        emit({
          id: jobId,
          kind: "gemma-analysis",
          status: "running",
          progressText: `${page.name} 분석 중`,
          phase: "page_running",
          progressCurrent: index + 1,
          progressTotal,
          pageIndex: index + 1,
          pageTotal: pages.length,
          attempt,
          attemptTotal: maxAttempts,
          detail: `${index + 1}/${pages.length}, 시도 ${attempt}/${maxAttempts}`
        });

        try {
          const result = await runtime.simplePage.requestTranslation(server, pageOptions);
          await runtime.simplePage.saveArtifacts(pageOptions, result);

          let parsed: unknown;
          try {
            parsed = runtime.overlayTools.parseJsonLenient(result.outputText);
          } catch (error) {
            const preview = summarizePreview(result.outputText);
            const parseError = new Error(
              `${page.name}: 모델 응답을 구조화 형식으로 해석하지 못했습니다. preview=${preview} cause=${error instanceof Error ? error.message : String(error)}`
            ) as Error & { cause?: unknown };
            parseError.cause = error;
            Object.assign(parseError, {
              outputPreview: preview,
              outputDir: pageOptions.outputDir,
              responseFormat: "structured-overlay"
            });
            throw parseError;
          }

          const items = runtime.overlayTools.normalizeItems(parsed);
          const koreanOutputProblem = findKoreanOutputProblem(items);
          if (koreanOutputProblem) {
            const languageError = new Error(
              `${page.name}: ko 필드가 한국어로 번역되지 않았습니다. ${koreanOutputProblem}`
            );
            Object.assign(languageError, {
              outputDir: pageOptions.outputDir,
              outputPreview: summarizePreview(result.outputText),
              responseFormat: "korean-overlay"
            });
            throw languageError;
          }
          if (items.length === 0 && isRequestNoTextDetected(result.requestBody)) {
            successPage = buildNoTextCompletedPage(page);
            await onPageComplete?.(successPage);
            emit({
              id: jobId,
              kind: "gemma-analysis",
              status: "running",
              progressText: `${page.name} 텍스트 없음`,
              phase: "page_done",
              progressCurrent: index + 1,
              progressTotal,
              pageIndex: index + 1,
              pageTotal: pages.length,
              detail: "Paddle OCR에서 번역 대상 텍스트 근거를 찾지 못해 모델 호출을 생략했습니다."
            });
            break;
          }
          if (items.length === 0) {
            const bboxError = new Error(`${page.name}: bbox 결과를 만들지 못했습니다.`);
            Object.assign(bboxError, {
              outputDir: pageOptions.outputDir,
              outputPreview: summarizePreview(result.outputText)
            });
            throw bboxError;
          }

          const overlayItemsPath = join(pageOptions.outputDir, "overlay-items.json");
          await mkdir(pageOptions.outputDir, { recursive: true });
          await writeFile(overlayItemsPath, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");

          let normalizedItems = applyOcrCandidateGeometryLocks(
            normalizeOverlayItemBboxes(items, page, getBboxNormalizationOptions(result.requestBody)),
            page,
            getOcrBboxHints(result.requestBody),
            pageOptions
          );
          normalizedItems = await maybeRetryLowConfidenceItems({
            runtime,
            server,
            pageOptions,
            page,
            items: normalizedItems,
            emit,
            jobId,
            pageIndex: index + 1,
            pageTotal: pages.length,
            progressTotal
          });
          normalizedItems = filterIgnoredSoundEffectItems(normalizedItems, pageOptions);
          const blocks = await applySampledBackgroundColors(
            normalizedItems.map((item, itemIndex) => overlayItemToBlock(item, page, itemIndex, pageOptions)),
            page
          );
          successPage = {
            ...page,
            blocks,
            analysisStatus: "completed",
            lastError: undefined,
            updatedAt: new Date().toISOString()
          };
          warnings.push(...buildPageWarnings(page.name, normalizedItems));
          await onPageComplete?.(successPage);
          translatedPageCount += 1;
          emit({
            id: jobId,
            kind: "gemma-analysis",
            status: "running",
            progressText: `${page.name} 완료`,
            phase: "page_done",
            progressCurrent: index + 1,
            progressTotal,
            pageIndex: index + 1,
            pageTotal: pages.length,
            detail: `${items.length}개 블록`
          });
          break;
        } catch (error) {
          if (isAbortErrorLike(error)) {
            throw error;
          }
          if (isNonRetriableRuntimeError(error)) {
            throw error;
          }

          lastError = error;
          lastErrorMessage = error instanceof Error ? error.message : String(error);
          warnings.push(`${page.name}: 시도 ${attempt}/${maxAttempts} 실패 - ${lastErrorMessage}`);
          logWarn("Analysis attempt failed", {
            failureCategory: classifyFailure(error),
            jobId,
            page: summarizePage(page),
            pageIndex: index + 1,
            pageTotal: pages.length,
            attempt,
            attemptTotal: maxAttempts,
            willRetry: attempt < maxAttempts,
            runPaths,
            pageOptions: summarizeTranslationOptions(pageOptions),
            error
          });

          if (attempt < maxAttempts) {
            emit({
              id: jobId,
              kind: "gemma-analysis",
              status: "running",
              progressText: `${page.name} 재시도`,
              phase: "page_retry",
              progressCurrent: index + 1,
              progressTotal,
              pageIndex: index + 1,
              pageTotal: pages.length,
              attempt: attempt + 1,
              attemptTotal: maxAttempts,
              detail: `${attempt}/${maxAttempts} 실패, 다시 시도합니다`
            });
            continue;
          }
        }
      }

      if (successPage) {
        completedPagesById.set(page.id, successPage);
        continue;
      }

      warnings.push(`${page.name}: ${maxAttempts}회 재시도 후 실패하여 이 페이지는 건너뜁니다. 마지막 오류: ${lastErrorMessage}`);
      logError("Analysis page skipped after retries", {
        failureCategory: classifyFailure(lastError),
        jobId,
        page: summarizePage(page),
        pageIndex: index + 1,
        pageTotal: pages.length,
        attemptTotal: maxAttempts,
        runPaths,
        lastPageOptions: lastPageOptions ? summarizeTranslationOptions(lastPageOptions) : null,
        lastErrorMessage,
        error: lastError
      });
      const failedPage: MangaPage = {
        ...page,
        blocks: [],
        analysisStatus: "failed",
        lastError: lastErrorMessage,
        updatedAt: new Date().toISOString()
      };
      completedPagesById.set(page.id, failedPage);
      await onPageFailed?.(failedPage, lastErrorMessage);
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${page.name} 건너뜀`,
        phase: "page_skipped",
        progressCurrent: index + 1,
        progressTotal,
        pageIndex: index + 1,
        pageTotal: pages.length,
        detail: `${maxAttempts}회 재시도 후 실패`
      });
    }

    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: "결과 정리 중",
      phase: "finalizing",
      progressCurrent: progressTotal,
      progressTotal,
      pageTotal: pages.length,
      detail: translatedPageCount > 0 ? `${pages.length} pages ready` : `${pages.length} pages ready, 모델 호출 없음`
    });

    return {
      pages: pages.map((page) => completedPagesById.get(page.id) ?? page),
      warnings
    };
  } finally {
    if (nextOcrTask) {
      await nextOcrTask.catch((error) => {
        logWarn("Pending OCR task ended after pipeline stop", {
          jobId,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
      });
    }
    await stopModelEndpoint(runtime, server);
  }
}

export function isOcrResultNoTextDetected(result: OcrBboxResult | null | undefined): boolean {
  return Boolean(result?.noTextDetected);
}

function isRequestNoTextDetected(requestBody: TranslationResult["requestBody"]): boolean {
  return Boolean(requestBody && typeof requestBody === "object" && (requestBody as RequestSummary).noTextDetected);
}

function buildNoTextCompletedPage(page: MangaPage): MangaPage {
  return {
    ...page,
    blocks: [],
    analysisStatus: "completed",
    lastError: undefined,
    updatedAt: new Date().toISOString()
  };
}

function formatOcrHintDetail(result: OcrBboxResult): string {
  if (isOcrResultNoTextDetected(result)) {
    return `${result.hints.length}개 후보, 텍스트 근거 없음`;
  }
  if (Number.isFinite(result.textEvidenceCount)) {
    return `${result.hints.length}개 후보, 텍스트 근거 ${result.textEvidenceCount}개`;
  }
  return `${result.hints.length}개 후보`;
}

function startOcrHintsForPage(options: OcrPageTaskOptions): Promise<OcrBboxResult> {
  const task = collectOcrHintsForPage(options);
  task.catch(() => {
    // The caller awaits the same promise later; this prevents early unhandled-rejection noise while LLM translation is running.
  });
  return task;
}

async function collectOcrHintsForPage({
  runtime,
  baseOptions,
  page,
  index,
  total,
  runPaths,
  emit,
  jobId,
  signal
}: OcrPageTaskOptions): Promise<OcrBboxResult> {
  throwIfAborted(signal);
  const cachePath = getOcrHintsCachePath(runPaths, page);
  const cached = await readCachedOcrHints(cachePath, page);
  if (cached) {
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: `${page.name} OCR 재사용`,
      phase: "ocr_running",
      progressCurrent: index + 1,
      progressTotal: total,
      pageIndex: index + 1,
      pageTotal: total,
      detail: formatOcrHintDetail(cached)
    });
    return cached;
  }

  const ocrOptions = buildOcrPageOptions(baseOptions, page, runPaths, index, total);
  ocrOptions.abortSignal = signal;
  ocrOptions.onProgress = (progress) => {
    const hasExplicitPageProgress = Number.isFinite(progress.pageIndex) && Number.isFinite(progress.pageTotal);
    const suppressDefaultPageProgress = progress.pageIndex === null || progress.pageTotal === null;
    const shouldDefaultToPage = Boolean(ocrOptions.ocrProgressDefaultToPage) && !suppressDefaultPageProgress;
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: progress.progressText,
      phase: progress.phase,
      progressCurrent: progress.progressCurrent ?? (shouldDefaultToPage ? index + 1 : undefined),
      progressTotal: progress.progressTotal ?? total,
      pageIndex: hasExplicitPageProgress ? Number(progress.pageIndex) : shouldDefaultToPage ? index + 1 : undefined,
      pageTotal: hasExplicitPageProgress ? Number(progress.pageTotal) : shouldDefaultToPage ? total : undefined,
      detail: progress.detail,
      progressMode: progress.progressMode,
      progressPercent: progress.progressPercent,
      progressBytes: progress.progressBytes,
      progressTotalBytes: progress.progressTotalBytes,
      progressBytesPerSecond: progress.progressBytesPerSecond,
      installLogLine: progress.installLogLine
    });
  };

  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "running",
    progressText: `${page.name} OCR 분석 중`,
    phase: "ocr_running",
    progressCurrent: index + 1,
    progressTotal: total,
    pageIndex: index + 1,
    pageTotal: total,
    detail: "페이지 OCR이 끝나면 해당 페이지 번역과 다음 페이지 OCR을 겹쳐 진행합니다."
  });

  const result = await runtime.simplePage.collectOcrBboxHints(ocrOptions);
  throwIfAborted(signal);
  await writeCachedOcrHints(cachePath, page, result);
  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "running",
    progressText: `${page.name} OCR 완료`,
    phase: "ocr_running",
    progressCurrent: index + 1,
    progressTotal: total,
    pageIndex: index + 1,
    pageTotal: total,
    detail: formatOcrHintDetail(result)
  });
  return result;
}

function shouldSerializeGpuOcrWithModel(options: TranslationOptions): boolean {
  if (options.modelProvider !== "gemma") {
    return false;
  }
  if (process.env.MANGA_TRANSLATOR_ALLOW_GPU_OCR_MODEL_OVERLAP === "1") {
    return false;
  }
  const device = String(process.env.MANGA_TRANSLATOR_OCR_DEVICE ?? options.ocrDevice ?? "").trim().toLowerCase();
  return device === "gpu" || device.startsWith("gpu:") || device === "cuda" || device.startsWith("cuda:");
}

async function prepareOcrHintsForPages({
  runtime,
  baseOptions,
  pages,
  runPaths,
  emit,
  jobId,
  signal
}: {
  runtime: RuntimeModules;
  baseOptions: TranslationOptions;
  pages: MangaPage[];
  runPaths: ChapterRunPaths;
  emit: (event: JobEvent) => void;
  jobId: string;
  signal: AbortSignal;
}): Promise<Map<string, OcrBboxResult>> {
  const results = new Map<string, OcrBboxResult>();
  const total = pages.length;
  const pendingPages: Array<{ page: MangaPage; index: number; options: TranslationOptions; cachePath: string }> = [];

  for (const [index, page] of pages.entries()) {
    throwIfAborted(signal);
    const cachePath = getOcrHintsCachePath(runPaths, page);
    const cached = await readCachedOcrHints(cachePath, page);
    if (cached) {
      results.set(page.id, cached);
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${page.name} OCR 재사용`,
        phase: "ocr_running",
        progressCurrent: index + 1,
        progressTotal: total,
        pageIndex: index + 1,
        pageTotal: total,
        detail: formatOcrHintDetail(cached)
      });
      continue;
    }

    const ocrOptions = buildOcrPageOptions(baseOptions, page, runPaths, index, total);
    ocrOptions.abortSignal = signal;
    ocrOptions.onProgress = (progress) => {
      const hasExplicitPageProgress = Number.isFinite(progress.pageIndex) && Number.isFinite(progress.pageTotal);
      const suppressDefaultPageProgress = progress.pageIndex === null || progress.pageTotal === null;
      const shouldDefaultToPage = Boolean(ocrOptions.ocrProgressDefaultToPage) && !suppressDefaultPageProgress;
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: progress.progressText,
        phase: progress.phase,
        progressCurrent: progress.progressCurrent ?? (shouldDefaultToPage ? index + 1 : results.size),
        progressTotal: progress.progressTotal ?? total,
        pageIndex: hasExplicitPageProgress ? Number(progress.pageIndex) : shouldDefaultToPage ? index + 1 : undefined,
        pageTotal: hasExplicitPageProgress ? Number(progress.pageTotal) : shouldDefaultToPage ? total : undefined,
        detail: progress.detail,
        progressMode: progress.progressMode,
        progressPercent: progress.progressPercent,
        progressBytes: progress.progressBytes,
        progressTotalBytes: progress.progressTotalBytes,
        progressBytesPerSecond: progress.progressBytesPerSecond,
        installLogLine: progress.installLogLine
      });
    };
    pendingPages.push({ page, index, options: ocrOptions, cachePath });
  }

  if (pendingPages.length > 0) {
    pendingPages.forEach((entry) => {
      entry.options.ocrBatchCompletedBefore = results.size;
      entry.options.ocrBatchTotal = total;
    });
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: "Paddle OCR 배치 선분석 중",
      phase: "ocr_running",
      progressCurrent: 0,
      progressTotal: pendingPages.length,
      pageTotal: total,
      detail: `${pendingPages.length}페이지를 한 번에 처리합니다. OCR 프로세스는 이 구간 끝에서 종료됩니다.`
    });

    const batchResults = runtime.simplePage.collectOcrBboxHintsBatch
      ? await runtime.simplePage.collectOcrBboxHintsBatch(pendingPages.map((entry) => entry.options))
      : await collectOcrHintsSequentially(runtime, pendingPages);

    for (const [batchIndex, result] of batchResults.entries()) {
      throwIfAborted(signal);
      const entry = pendingPages[batchIndex];
      if (!entry) {
        continue;
      }
      await writeCachedOcrHints(entry.cachePath, entry.page, result);
      results.set(entry.page.id, result);
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${entry.page.name} OCR 완료`,
        phase: "ocr_running",
        progressCurrent: batchIndex + 1,
        progressTotal: pendingPages.length,
        pageIndex: entry.index + 1,
        pageTotal: total,
        detail: formatOcrHintDetail(result)
      });
    }
  }

  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "running",
    progressText: "Paddle OCR 선분석 완료",
    phase: "ocr_running",
    progressCurrent: total,
    progressTotal: total,
    pageTotal: total,
    detail: "OCR 프로세스를 종료하고 AI 번역 단계로 넘어갑니다."
  });

  return results;
}

async function collectOcrHintsSequentially(
  runtime: RuntimeModules,
  entries: Array<{ options: TranslationOptions }>
): Promise<OcrBboxResult[]> {
  const results: OcrBboxResult[] = [];
  for (const entry of entries) {
    results.push(await runtime.simplePage.collectOcrBboxHints(entry.options));
  }
  return results;
}

function buildOcrPageOptions(baseOptions: TranslationOptions, page: MangaPage, runPaths: ChapterRunPaths, index: number, total: number): TranslationOptions {
  const outputDir = getOcrHintsOutputDir(runPaths, page);
  return {
    ...baseOptions,
    imagePath: page.imagePath,
    imageWidth: page.width,
    imageHeight: page.height,
    outputDir,
    label: `ocr-page-${index + 1}`,
    ocrPageIndex: index + 1,
    ocrPageTotal: total,
    ocrProgressDefaultToPage: true
  };
}

function getOcrHintsOutputDir(runPaths: ChapterRunPaths, page: MangaPage): string {
  return join(runPaths.chapterDir, "ocr-hints", page.id);
}

function getOcrHintsCachePath(runPaths: ChapterRunPaths, page: MangaPage): string {
  return join(getOcrHintsOutputDir(runPaths, page), "result.json");
}

async function readCachedOcrHints(cachePath: string, page: MangaPage): Promise<OcrBboxResult | null> {
  try {
    const raw = JSON.parse(await readFile(cachePath, "utf8")) as {
      schemaVersion?: number;
      imagePath?: string;
      width?: number;
      height?: number;
      hints?: unknown[];
      diagnostics?: unknown[];
      noTextDetected?: boolean;
      textEvidenceCount?: number;
    };
    if (
      raw.schemaVersion !== OCR_HINT_CACHE_SCHEMA_VERSION ||
      raw.imagePath !== page.imagePath ||
      raw.width !== page.width ||
      raw.height !== page.height ||
      !Array.isArray(raw.hints)
    ) {
      return null;
    }
    return {
      hints: raw.hints,
      diagnostics: Array.isArray(raw.diagnostics) ? raw.diagnostics : [],
      noTextDetected: Boolean(raw.noTextDetected),
      textEvidenceCount: Number.isFinite(raw.textEvidenceCount) ? Number(raw.textEvidenceCount) : undefined
    };
  } catch {
    return null;
  }
}

async function writeCachedOcrHints(cachePath: string, page: MangaPage, result: OcrBboxResult): Promise<void> {
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(
    cachePath,
    `${JSON.stringify({
      imagePath: page.imagePath,
      width: page.width,
      height: page.height,
      schemaVersion: OCR_HINT_CACHE_SCHEMA_VERSION,
      hints: result.hints,
      diagnostics: result.diagnostics,
      noTextDetected: Boolean(result.noTextDetected),
      textEvidenceCount: Number.isFinite(result.textEvidenceCount) ? result.textEvidenceCount : undefined,
      updatedAt: new Date().toISOString()
    }, null, 2)}\n`,
    "utf8"
  );
}

export function buildBaseOptions(
  jobId: string,
  runDir: string,
  settings: AppSettings,
  paths = getAppPaths(),
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

function buildPageOptions(baseOptions: TranslationOptions, page: MangaPage, index: number, attempt: number): TranslationOptions {
  return {
    ...baseOptions,
    imagePath: page.imagePath,
    imageWidth: page.width,
    imageHeight: page.height,
    outputDir: join(baseOptions.outputDir, "pages", page.id, `attempt-${attempt}`),
    label: `page-${index + 1}-attempt-${attempt}`
  };
}

type CropRetryContext = {
  runtime: RuntimeModules;
  server: ModelEndpointHandle;
  pageOptions: TranslationOptions;
  page: MangaPage;
  items: OverlayItem[];
  emit: PipelineOptions["emit"];
  jobId: string;
  pageIndex: number;
  pageTotal: number;
  progressTotal: number;
};

async function maybeRetryLowConfidenceItems({
  runtime,
  server,
  pageOptions,
  page,
  items,
  emit,
  jobId,
  pageIndex,
  pageTotal,
  progressTotal
}: CropRetryContext): Promise<OverlayItem[]> {
  if (!runtime.simplePage.requestCropRetryTranslation || !runtime.overlayTools.parseRetryItems) {
    return items;
  }

  const targets = selectCropRetryTargets(items, page);
  if (targets.length === 0 || pageOptions.translationMode === "ocr-text") {
    return items;
  }

  const retryOptions = {
    ...pageOptions,
    label: `${pageOptions.label}-crop-retry`,
    outputDir: join(pageOptions.outputDir, "crop-retry")
  };

  emit({
    id: jobId,
    kind: "gemma-analysis",
    status: "running",
    progressText: `${page.name} 낮은 신뢰도 crop 재확인 중`,
    phase: "model_requesting",
    progressCurrent: pageIndex,
    progressTotal,
    pageIndex,
    pageTotal,
    detail: `${targets.length}개 항목`
  });

  try {
    const result = await runtime.simplePage.requestCropRetryTranslation(server as ServerHandle, retryOptions, targets);
    if (!result.outputText.trim()) {
      return items;
    }

    await runtime.simplePage.saveArtifacts(retryOptions, result);
    const retryItems = runtime.overlayTools.parseRetryItems(result.outputText);
    await mkdir(retryOptions.outputDir, { recursive: true });
    await writeFile(join(retryOptions.outputDir, "crop-retry-items.json"), `${JSON.stringify({ items: retryItems }, null, 2)}\n`, "utf8");
    return mergeCropRetryItems(items, retryItems);
  } catch (error) {
    logWarn("Crop retry failed; keeping first-pass overlay items", {
      pageId: page.id,
      pageName: page.name,
      targetCount: targets.length,
      errorMessage: error instanceof Error ? error.message : String(error)
    });
    return items;
  }
}

function selectCropRetryTargets(
  items: OverlayItem[],
  page: MangaPage
): CropRetryTarget[] {
  return items
    .filter((item) => shouldRetryCropItem(item))
    .slice(0, CROP_RETRY_MAX_ITEMS_PER_PAGE)
    .map((item) => ({
      id: item.id,
      type: item.type,
      bbox: item.bbox,
      cropBox: buildExpandedCropBox(item.bbox, page),
      jp: item.jp,
      ko: item.ko,
      direction: item.direction,
      angle: item.angle,
      fontSize: item.fontSize,
      confidence: item.confidence
    }));
}

function shouldRetryCropItem(item: OverlayItem): boolean {
  const confidence = normalizeConfidence(item.confidence, Number.NaN);
  if (Number.isFinite(confidence) && confidence < CROP_RETRY_CONFIDENCE_THRESHOLD) {
    return true;
  }

  if (hasUncertaintyMarker(item.jp) || hasUncertaintyMarker(item.ko) || containsJapaneseKana(item.ko)) {
    return true;
  }

  return false;
}

function buildExpandedCropBox(bbox: BBox, page: MangaPage): BBox {
  const pageWidth = Math.max(1, page.width);
  const pageHeight = Math.max(1, page.height);
  const left = (bbox.x / 1000) * pageWidth;
  const top = (bbox.y / 1000) * pageHeight;
  const width = Math.max(1, (bbox.w / 1000) * pageWidth);
  const height = Math.max(1, (bbox.h / 1000) * pageHeight);
  const marginX = Math.max(CROP_RETRY_MIN_MARGIN_PX, width * CROP_RETRY_MARGIN_RATIO);
  const marginY = Math.max(CROP_RETRY_MIN_MARGIN_PX, height * CROP_RETRY_MARGIN_RATIO);
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const expandedWidth = Math.max(CROP_RETRY_MIN_SIDE_PX, width + marginX * 2);
  const expandedHeight = Math.max(CROP_RETRY_MIN_SIDE_PX, height + marginY * 2);
  const cropLeft = clamp(centerX - expandedWidth / 2, 0, Math.max(0, pageWidth - 1));
  const cropTop = clamp(centerY - expandedHeight / 2, 0, Math.max(0, pageHeight - 1));
  const cropRight = clamp(centerX + expandedWidth / 2, cropLeft + 1, pageWidth);
  const cropBottom = clamp(centerY + expandedHeight / 2, cropTop + 1, pageHeight);
  return {
    x: Math.round(cropLeft),
    y: Math.round(cropTop),
    w: Math.round(cropRight - cropLeft),
    h: Math.round(cropBottom - cropTop)
  };
}

function mergeCropRetryItems(
  items: OverlayItem[],
  retryItems: Array<Omit<OverlayItem, "bbox">>
): OverlayItem[] {
  const retryById = new Map(retryItems.map((item) => [item.id, item]));

  const merged: OverlayItem[] = [];
  for (const item of items) {
    const retry = retryById.get(item.id);
    if (!retry) {
      merged.push(item);
      continue;
    }

    if (isRejectRetryItem(retry)) {
      continue;
    }

    if (!isUsableRetryItem(retry)) {
      merged.push(item);
      continue;
    }

    const baseHadProblem = shouldRetryCropItem(item);
    const retryConfidence = normalizeConfidence(retry.confidence, Number.NaN);
    const baseConfidence = normalizeConfidence(item.confidence, Number.NaN);
    if (!baseHadProblem && Number.isFinite(retryConfidence) && Number.isFinite(baseConfidence) && retryConfidence + 0.02 < baseConfidence) {
      merged.push(item);
      continue;
    }

    merged.push({
      ...item,
      type: retry.type || item.type,
      jp: retry.jp || item.jp,
      ko: retry.ko || item.ko,
      direction: retry.direction ?? item.direction,
      angle: retry.angle ?? item.angle,
      fontSize: retry.fontSize ?? item.fontSize,
      confidence: Number.isFinite(retryConfidence) ? retryConfidence : item.confidence
    });
  }
  return merged;
}

function isRejectRetryItem(item: Omit<OverlayItem, "bbox">): boolean {
  const type = String(item.type ?? "").trim().toLowerCase();
  return type === "reject" || isNonTextMarker(item.jp) || isNonTextMarker(item.ko);
}

function isUsableRetryItem(item: Omit<OverlayItem, "bbox">): boolean {
  return Boolean(String(item.ko ?? "").trim()) && !hasUncertaintyMarker(item.ko);
}

function isNonTextMarker(value: string | undefined): boolean {
  return /^\s*\[(?:non-?text|not text|reject)\]\s*$/i.test(String(value ?? ""));
}

function hasUncertaintyMarker(value: string | undefined): boolean {
  return String(value ?? "").includes("[?]");
}

function containsJapaneseKana(value: string | undefined): boolean {
  return /[\u3040-\u30ff]/u.test(String(value ?? ""));
}

function findKoreanOutputProblem(items: OverlayItem[]): string | null {
  const candidates = items.filter((item) => shouldRequireKoreanKo(item));
  if (candidates.length === 0) {
    return null;
  }

  const badItems = candidates.filter((item) => !containsHangul(item.ko));
  if (badItems.length === 0) {
    return null;
  }
  if (badItems.length >= Math.max(1, Math.ceil(candidates.length * 0.35))) {
    const ids = badItems.slice(0, 5).map((item) => item.id).join(", ");
    return `한국어가 아닌 ko 항목 ${badItems.length}/${candidates.length}개, ids=${ids}`;
  }
  return null;
}

function shouldRequireKoreanKo(item: OverlayItem): boolean {
  const source = String(item.jp ?? "").trim();
  const ko = String(item.ko ?? "").trim();
  if (!source || !ko || isNonTextMarker(source) || isNonTextMarker(ko)) {
    return false;
  }
  if (/^[\d\s.,:;!?！？。、…~〜ー―\-－♡♥]+$/u.test(source)) {
    return false;
  }
  return /[A-Za-z\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/u.test(source);
}

function containsHangul(value: string | undefined): boolean {
  return /[\uac00-\ud7a3]/u.test(String(value ?? ""));
}

function filterIgnoredSoundEffectItems(
  items: OverlayItem[],
  options: Pick<TranslationOptions, "includeSoundEffects">
): OverlayItem[] {
  if (options.includeSoundEffects !== false) {
    return items;
  }
  return items.filter((item) => !isLikelySoundEffectOverlayItem(item));
}

function isLikelySoundEffectOverlayItem(item: OverlayItem): boolean {
  const type = String(item.type ?? "").trim().toLowerCase();
  if (/\b(?:sfx|sound|effect|onomatopoeia|reaction)\b/.test(type)) {
    return true;
  }

  const source = compactTextForSoundEffectCheck(item.jp);
  if (!source) {
    return false;
  }
  const normalizedType = mapOverlayType(item.type);
  const confidence = normalizeConfidence(item.confidence, Number.NaN);
  const lowTrust = Number.isFinite(confidence) ? confidence < 0.82 : true;

  if (normalizedType === "nonsolid" && isKatakanaLikeSoundEffectText(source)) {
    return true;
  }
  if (normalizedType === "nonsolid" && lowTrust && isShortKanaReactionText(source)) {
    return true;
  }
  return false;
}

function compactTextForSoundEffectCheck(value: string | undefined): string {
  return String(value ?? "")
    .replace(/\s+/g, "")
    .replace(/[「」『』（）()\[\]【】"'“”‘’]/g, "")
    .trim();
}

function isKatakanaLikeSoundEffectText(text: string): boolean {
  const chars = [...text].filter((char) => /[A-Za-z0-9一-龯ぁ-ゖァ-ヺー]/u.test(char));
  if (chars.length === 0 || chars.length > 14) {
    return false;
  }
  const katakanaCount = chars.filter((char) => /[ァ-ヺー]/u.test(char)).length;
  const kanaCount = chars.filter((char) => /[ぁ-ゖァ-ヺー]/u.test(char)).length;
  const kanjiCount = chars.filter((char) => /[一-龯]/u.test(char)).length;
  if (kanjiCount > 0) {
    return false;
  }
  return katakanaCount >= Math.max(2, chars.length * 0.65) || (chars.length <= 5 && kanaCount === chars.length && /[ッっーァ-ヺ]/u.test(text));
}

function isShortKanaReactionText(text: string): boolean {
  const chars = [...text].filter((char) => /[ぁ-ゖァ-ヺー]/u.test(char));
  if (chars.length === 0 || chars.length > 8 || /[一-龯A-Za-z0-9]/u.test(text)) {
    return false;
  }
  return chars.length / Math.max(1, [...text].length) > 0.6;
}

export function overlayItemToBlock(
  item: OverlayItem,
  page: MangaPage,
  index: number,
  options: Pick<TranslationOptions, "textOutlineWidthPx"> = { textOutlineWidthPx: 1.4 }
): TranslationBlock {
  const type = mapOverlayType(item.type);
  const rawBbox = clampBbox(item.bbox);
  const rawTranslatedText = item.ko.trim();
  const sourceText = item.jp.trim();
  const textForSizing = rawTranslatedText || sourceText || "...";
  const lineHeight = 1.18;
  const fontSizePx = resolveOverlayFontSizePx(item, rawBbox, page, textForSizing);
  const sourceDirection = item.direction === "vertical" ? "vertical" : "horizontal";
  const bbox = rawBbox;
  const renderDirection = resolveInitialRenderDirection(type, sourceDirection, item, bbox, page, fontSizePx);
  const translatedText = applyBboxAwareKoreanLineBreaks(rawTranslatedText, bbox, page, fontSizePx, lineHeight, renderDirection);
  const rotationDeg = enforceRotationDeg(type, item.angle ?? 0);
  const visualStyle = resolveBlockVisualStyle(type);
  return {
    id: `${page.id}-block-${index + 1}`,
    type,
    bbox,
    bboxSpace: "normalized_1000",
    sourceText,
    translatedText,
    confidence: normalizeConfidence(item.confidence, sourceText ? 0.92 : 0.75),
    sourceDirection,
    renderDirection,
    rotationDeg,
    fontSizePx,
    lineHeight,
    textAlign: "center",
    textColor: DEFAULT_TEXT_COLOR,
    outlineColor: DEFAULT_OUTLINE_COLOR,
    outlineWidthPx: normalizeTextOutlineWidthPx(undefined, options.textOutlineWidthPx),
    backgroundColor: visualStyle.backgroundColor,
    opacity: visualStyle.defaultOpacity,
    autoFitText: true
  };
}

function applyBboxAwareKoreanLineBreaks(
  text: string,
  bbox: BBox,
  page: MangaPage,
  fontSizePx: number,
  lineHeight: number,
  renderDirection: RenderTextDirection
): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("\n") || renderDirection !== "horizontal") {
    return trimmed;
  }

  const compactLength = [...trimmed.replace(/\s+/g, "")].length;
  if (compactLength < 8) {
    return trimmed;
  }

  const widthPx = Math.max(1, (bbox.w / 1000) * page.width);
  const heightPx = Math.max(1, (bbox.h / 1000) * page.height);
  const safeFontSize = Math.max(8, fontSizePx);
  const averageKoreanCharWidth = safeFontSize * 0.98;
  const maxCharsPerLine = clamp(Math.floor(widthPx / averageKoreanCharWidth), 3, 14);
  const lineHeightPx = Math.max(1, safeFontSize * lineHeight);
  const maxLines = clamp(Math.floor(heightPx / (lineHeightPx * 0.78)), 1, 4);

  if (maxLines < 2 || compactLength <= maxCharsPerLine) {
    return trimmed;
  }

  return wrapKoreanTextForBbox(trimmed, maxCharsPerLine, maxLines);
}

function wrapKoreanTextForBbox(text: string, maxCharsPerLine: number, maxLines: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  let remaining = normalized;

  while (remaining && lines.length < maxLines - 1) {
    if ([...remaining.replace(/\s+/g, "")].length <= maxCharsPerLine) {
      break;
    }

    const breakIndex = findNaturalKoreanBreakIndex(remaining, maxCharsPerLine);
    const line = remaining.slice(0, breakIndex).trim();
    const next = remaining.slice(breakIndex).trim();
    if (!line || !next) {
      break;
    }
    lines.push(line);
    remaining = next;
  }

  if (remaining) {
    lines.push(remaining.trim());
  }

  return lines.join("\n");
}

function findNaturalKoreanBreakIndex(text: string, maxCharsPerLine: number): number {
  let charCount = 0;
  let hardLimitIndex = text.length;

  for (let index = 0; index < text.length; index += 1) {
    if (!/\s/u.test(text[index] ?? "")) {
      charCount += 1;
    }
    if (charCount > maxCharsPerLine) {
      hardLimitIndex = index;
      break;
    }
  }

  const windowStart = Math.max(1, hardLimitIndex - 10);
  const preferred = text.slice(windowStart, hardLimitIndex + 1).search(/[,.!?…。！？]\s*|\s+/u);
  if (preferred >= 0) {
    return windowStart + preferred + 1;
  }

  return Math.max(1, hardLimitIndex);
}

function normalizeConfidence(value: unknown, fallback: number): number {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  const normalized = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed;
  return clamp(normalized, 0, 1);
}

function normalizeTextOutlineWidthPx(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  const fallbackNumber = Number.isFinite(fallback) ? fallback : 1.4;
  if (!Number.isFinite(parsed)) {
    return clamp(fallbackNumber, 0, 8);
  }
  return clamp(parsed, 0, 8);
}

async function applySampledBackgroundColors(blocks: TranslationBlock[], page: MangaPage): Promise<TranslationBlock[]> {
  if (blocks.length === 0) {
    return blocks;
  }

  const image = nativeImage.createFromPath(page.imagePath);
  if (image.isEmpty()) {
    return blocks;
  }

  const size = image.getSize();
  const bitmap = image.toBitmap();
  if (bitmap.length === 0 || size.width <= 0 || size.height <= 0) {
    return blocks;
  }

  return blocks.map((block) => {
    const sampled = estimateBlockBackground(bitmap, size.width, size.height, block, page);
    if (!sampled?.flat) {
      return block.type === "solid"
        ? {
            ...block,
            type: "nonsolid",
            backgroundColor: resolveBlockVisualStyle("nonsolid").backgroundColor,
            opacity: resolveBlockVisualStyle("nonsolid").defaultOpacity
          }
        : block;
    }

    const color = rgbToHex(sampled.color);
    if (block.type === "solid") {
      return {
        ...block,
        backgroundColor: color
      };
    }

    return {
      ...block,
      type: "solid",
      backgroundColor: color,
      opacity: resolveBlockVisualStyle("solid").defaultOpacity
    };
  });
}

function estimateBlockBackground(
  bitmap: Buffer,
  imageWidth: number,
  imageHeight: number,
  block: TranslationBlock,
  page: MangaPage
): SampledBackground | null {
  const rect = blockBboxToImageRect(block.bbox, page, imageWidth, imageHeight);
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

function blockBboxToImageRect(blockBbox: BBox, page: MangaPage, imageWidth: number, imageHeight: number): BBox | null {
  const scaleX = imageWidth / Math.max(1, page.width);
  const scaleY = imageHeight / Math.max(1, page.height);
  const pageX = (blockBbox.x / 1000) * page.width;
  const pageY = (blockBbox.y / 1000) * page.height;
  const pageW = (blockBbox.w / 1000) * page.width;
  const pageH = (blockBbox.h / 1000) * page.height;
  const x1 = Math.max(0, Math.floor(pageX * scaleX));
  const y1 = Math.max(0, Math.floor(pageY * scaleY));
  const x2 = Math.min(imageWidth, Math.ceil((pageX + pageW) * scaleX));
  const y2 = Math.min(imageHeight, Math.ceil((pageY + pageH) * scaleY));
  if (x2 <= x1 || y2 <= y1) {
    return null;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function readRgb(bitmap: Buffer, width: number, x: number, y: number): Rgb {
  const offset = (y * width + x) * 4;
  return {
    b: bitmap[offset] ?? 0,
    g: bitmap[offset + 1] ?? 0,
    r: bitmap[offset + 2] ?? 0
  };
}

function rgbToHex(color: Rgb): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
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

function resolveOverlayFontSizePx(item: OverlayItem, bbox: BBox, page: MangaPage, textForSizing: string): number {
  if (typeof item.fontSize === "number" && Number.isFinite(item.fontSize)) {
    return Math.round(clamp(item.fontSize, 6, 160));
  }

  return estimateBlockFontSizePx(textForSizing, { bbox }, { width: page.width, height: page.height });
}

function resolveInitialRenderDirection(
  type: BlockType,
  sourceDirection: SourceTextDirection,
  item: OverlayItem,
  bbox: BBox,
  page: MangaPage,
  fontSizePx: number
): RenderTextDirection {
  if (type === "solid") {
    return "horizontal";
  }

  if (type === "nonsolid" && sourceDirection === "vertical" && shouldKeepVerticalRendering(bbox, page, fontSizePx)) {
    return "vertical";
  }

  if (Math.abs(enforceRotationDeg(type, item.angle ?? 0)) > 0) {
    return "rotated";
  }

  return enforceRenderDirection(type, "horizontal");
}

function shouldKeepVerticalRendering(bbox: BBox, page: MangaPage, fontSizePx: number): boolean {
  const widthPx = (bbox.w / 1000) * page.width;
  const estimatedColumns = Math.max(1, Math.round(widthPx / Math.max(1, fontSizePx * 1.15)));
  return estimatedColumns <= 2;
}

export function normalizeOverlayItemBboxes(items: OverlayItem[], page: MangaPage, options: BboxNormalizationOptions = {}): OverlayItem[] {
  const bboxSpace = options.coordinateSpace ?? inferDetectedBboxSpace(items, page);
  const pixelWidth = options.pixelWidth && options.pixelWidth > 0 ? options.pixelWidth : page.width;
  const pixelHeight = options.pixelHeight && options.pixelHeight > 0 ? options.pixelHeight : page.height;
  const fontSizeScale = bboxSpace === "pixels" ? Math.max(page.width / pixelWidth, page.height / pixelHeight) : 1;
  return items.map((item) => ({
    ...item,
    bbox: bboxSpace === "pixels" ? pixelsToBbox(item.bbox, pixelWidth, pixelHeight) : clampBbox(item.bbox),
    fontSize:
      bboxSpace === "pixels" && typeof item.fontSize === "number" && Number.isFinite(item.fontSize)
        ? Math.max(1, Math.round(item.fontSize * fontSizeScale))
        : item.fontSize
  }));
}

function getBboxNormalizationOptions(requestBody: TranslationResult["requestBody"]): BboxNormalizationOptions {
  if (!requestBody || typeof requestBody !== "object") {
    return {};
  }

  const summary = requestBody as RequestSummary;
  if (summary.bboxCoordinateSpace !== "pixels") {
    return {};
  }

  return {
    coordinateSpace: "pixels",
    pixelWidth: Number(summary.bboxCoordinateFrame?.width),
    pixelHeight: Number(summary.bboxCoordinateFrame?.height)
  };
}

function getOcrBboxHints(requestBody: TranslationResult["requestBody"]): NonNullable<RequestSummary["ocrBboxHints"]> {
  if (!requestBody || typeof requestBody !== "object") {
    return [];
  }
  const hints = (requestBody as RequestSummary).ocrBboxHints;
  return Array.isArray(hints) ? hints : [];
}

export function applyOcrCandidateGeometryLocks(
  items: OverlayItem[],
  page: MangaPage,
  hints: NonNullable<RequestSummary["ocrBboxHints"]>,
  options: Pick<TranslationOptions, "ocrBboxExpandXRatio" | "ocrBboxExpandYRatio"> = {
    ocrBboxExpandXRatio: DEFAULT_OCR_BBOX_EXPAND_X_RATIO,
    ocrBboxExpandYRatio: DEFAULT_OCR_BBOX_EXPAND_Y_RATIO
  }
): OverlayItem[] {
  if (hints.length === 0) {
    return items;
  }

  const hintMap = new Map<number, { bbox: BBox; label: string }>();
  for (const hint of hints) {
    const id = Number(hint.id);
    const x1 = Number(hint.x1);
    const y1 = Number(hint.y1);
    const x2 = Number(hint.x2);
    const y2 = Number(hint.y2);
    if (!Number.isInteger(id) || id <= 0 || ![x1, y1, x2, y2].every(Number.isFinite)) {
      continue;
    }
    hintMap.set(id, {
      bbox: pixelsToBbox({
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1)
      }, page.width, page.height),
      label: String(hint.label ?? "")
    });
  }

  if (hintMap.size === 0) {
    return items;
  }

  const usedHintIds = new Set<number>();
  const firstPass = items.map((item) => {
    const lockedHint = hintMap.get(item.id);
    if (!lockedHint || !isNearOcrHint(item.bbox, lockedHint.bbox, page)) {
      return item;
    }
    usedHintIds.add(item.id);
    return {
      ...item,
      bbox: expandLockedOcrBbox(lockedHint.bbox, options)
    };
  });

  return firstPass;
}

function expandLockedOcrBbox(
  bbox: BBox,
  options: Pick<TranslationOptions, "ocrBboxExpandXRatio" | "ocrBboxExpandYRatio">
): BBox {
  const expandX = bbox.w * resolveOcrBboxExpandRatio(options.ocrBboxExpandXRatio, DEFAULT_OCR_BBOX_EXPAND_X_RATIO);
  const expandY = bbox.h * resolveOcrBboxExpandRatio(options.ocrBboxExpandYRatio, DEFAULT_OCR_BBOX_EXPAND_Y_RATIO);
  return clampBbox({
    x: bbox.x - expandX,
    y: bbox.y - expandY,
    w: bbox.w + expandX * 2,
    h: bbox.h + expandY * 2
  });
}

function resolveOcrBboxExpandRatio(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, parsed));
}

function isNearOcrHint(modelBbox: BBox, hintBbox: BBox, page: MangaPage): boolean {
  const modelPx = normalizedBboxToPixels(modelBbox, page);
  const hintPx = normalizedBboxToPixels(hintBbox, page);
  const modelCenterX = modelPx.x + modelPx.w / 2;
  const modelCenterY = modelPx.y + modelPx.h / 2;
  const hintCenterX = hintPx.x + hintPx.w / 2;
  const hintCenterY = hintPx.y + hintPx.h / 2;
  const distance = Math.hypot(modelCenterX - hintCenterX, modelCenterY - hintCenterY);
  const tolerance = Math.max(150, Math.max(hintPx.w, hintPx.h) * 1.35);
  return distance <= tolerance || bboxOverlapRatio(modelPx, hintPx) > 0.1;
}

function normalizedBboxToPixels(bbox: BBox, page: MangaPage): BBox {
  return {
    x: (bbox.x / 1000) * page.width,
    y: (bbox.y / 1000) * page.height,
    w: (bbox.w / 1000) * page.width,
    h: (bbox.h / 1000) * page.height
  };
}

function bboxOverlapRatio(a: BBox, b: BBox): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  const minArea = Math.max(1, Math.min(a.w * a.h, b.w * b.h));
  return overlap / minArea;
}

function inferDetectedBboxSpace(items: OverlayItem[], page: Pick<MangaPage, "width" | "height">): DetectedBboxSpace {
  const coordinatePixelEvidence = items.filter((item) => hasPixelCoordinateEvidence(item.bbox, page)).length;
  if (coordinatePixelEvidence > 0) {
    return "pixels";
  }

  const overflowPixelEvidence = items.filter((item) => hasPixelOverflowEvidence(item.bbox, page)).length;
  return overflowPixelEvidence >= Math.max(2, Math.ceil(items.length * 0.2)) ? "pixels" : "normalized_1000";
}

function hasPixelCoordinateEvidence(bbox: BBox, page: Pick<MangaPage, "width" | "height">): boolean {
  return fitsPagePixels(bbox, page) && (bbox.x > 1000 || bbox.y > 1000 || bbox.w > 1000 || bbox.h > 1000);
}

function hasPixelOverflowEvidence(bbox: BBox, page: Pick<MangaPage, "width" | "height">): boolean {
  const right = bbox.x + bbox.w;
  const bottom = bbox.y + bbox.h;
  const normalizedTolerance = 80;
  return fitsPagePixels(bbox, page) && (right > 1000 + normalizedTolerance || bottom > 1000 + normalizedTolerance);
}

function fitsPagePixels(bbox: BBox, page: Pick<MangaPage, "width" | "height">): boolean {
  const right = bbox.x + bbox.w;
  const bottom = bbox.y + bbox.h;
  const pixelBoundsTolerance = 1.06;
  return (
    bbox.x >= 0 &&
    bbox.y >= 0 &&
    bbox.w > 0 &&
    bbox.h > 0 &&
    right <= page.width * pixelBoundsTolerance &&
    bottom <= page.height * pixelBoundsTolerance
  );
}

function mapOverlayType(value: string): BlockType {
  return normalizeBlockType(value);
}

function buildPageWarnings(pageName: string, items: OverlayItem[]): string[] {
  const warnings: string[] = [];
  const uncertainCount = items.filter((item) => item.jp.includes("[?]") || item.ko.includes("[?]")).length;
  if (uncertainCount > 0) {
    warnings.push(`${pageName}: 불확실한 OCR 조각이 ${uncertainCount}개 있습니다.`);
  }
  return warnings;
}

function readNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function summarizePreview(text: string, maxLength = 240): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1)}…`;
}

function summarizeTranslationOptions(options: TranslationOptions): Record<string, unknown> {
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
    modelCacheDir: options.modelCacheDir ?? null,
    translationMode: options.translationMode,
    includeSoundEffects: options.includeSoundEffects,
    ocrBboxExpandXRatio: options.ocrBboxExpandXRatio,
    ocrBboxExpandYRatio: options.ocrBboxExpandYRatio,
    textOutlineWidthPx: options.textOutlineWidthPx,
    ocrDevice: options.ocrDevice,
    ocrEngine: options.ocrEngine,
    ocrBboxProvider: options.ocrBboxProvider,
    hfHomeDir: options.hfHomeDir ?? null,
    hfHubCacheDir: options.hfHubCacheDir ?? null
  };
}

function formatGemmaVramMode(mode: TranslationOptions["gemmaVramMode"]): string {
  return mode === "economy" ? "VRAM 절약 모드" : "VRAM 풀로드 모드";
}

async function startModelEndpoint(runtime: RuntimeModules, options: TranslationOptions): Promise<ModelEndpointHandle> {
  if (options.modelProvider === "openai-codex") {
    return startOpenAIOAuthEndpoint(options);
  }
  return runtime.simplePage.startServer(options);
}

async function stopModelEndpoint(runtime: RuntimeModules, endpoint: ModelEndpointHandle | null | undefined): Promise<void> {
  if (isOpenAIOAuthEndpoint(endpoint)) {
    await stopOpenAIOAuthEndpoint(endpoint);
    return;
  }
  await runtime.simplePage.stopServer(endpoint);
}

function isOpenAIOAuthEndpoint(endpoint: ModelEndpointHandle | null | undefined): endpoint is OpenAIOAuthEndpoint {
  return Boolean(endpoint && "provider" in endpoint && endpoint.provider === "openai-codex");
}

function summarizePage(page: MangaPage): Record<string, unknown> {
  return {
    id: page.id,
    name: page.name,
    imagePath: page.imagePath,
    width: page.width,
    height: page.height,
    analysisStatus: page.analysisStatus
  };
}

function classifyFailure(error: unknown): string {
  if (isNonRetriableRuntimeError(error)) {
    return "runtime";
  }
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (message.includes("build-page-variant")) {
    return "image-preprocessing";
  }
  if (message.includes("llama-server") || message.includes("bundled llama-server") || message.includes("timed out while waiting")) {
    return "server-startup";
  }
  if (
    message.includes("gemma request failed") ||
    message.includes("openai codex request failed") ||
    message.includes("request transport failed") ||
    message.includes("openai-oauth")
  ) {
    return "model-request";
  }
  if (message.includes("json parse failed")) {
    return "response-json-parse";
  }
  if (message.includes("구조화 형식으로 해석하지 못했습니다") || message.includes("parseable structured payload")) {
    return "overlay-parse";
  }
  if (message.includes("empty response")) {
    return "empty-model-response";
  }
  if (message.includes("bbox 결과를 만들지 못했습니다")) {
    return "empty-overlay-items";
  }
  return "unknown";
}

function isNonRetriableRuntimeError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "nonRetriable" in error && (error as { nonRetriable?: unknown }).nonRetriable);
}

function isAbortErrorLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
