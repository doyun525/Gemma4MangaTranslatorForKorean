import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TranslationOptions } from "./appSettings";
import { logError, logInfo, logWarn } from "./logger";
import type { MangaPage } from "../shared/types";
import { getAppPaths } from "./appPaths";
import { getAppSettings } from "./settingsStore";
import { maybeRetryLowConfidenceItems } from "./pipeline/cropRetry";
import { classifyFailure, isAbortErrorLike, isNonRetriableRuntimeError, summarizePage, throwIfAborted } from "./pipeline/failure";
import { buildNoTextCompletedPage, isOcrResultNoTextDetected, isRequestNoTextDetected } from "./pipeline/noText";
import { prepareOcrHintsForPages } from "./pipeline/ocrHints";
import { applySampledBackgroundColors } from "./pipeline/blockBackground";
import {
  applyOcrCandidateGeometryLocks,
  buildPageWarnings,
  filterRejectedOrUncertainSoundItems,
  getBboxNormalizationOptions,
  getOcrBboxHints,
  normalizeOverlayItemBboxes,
  overlayItemToBlock
} from "./pipeline/overlayItems";
import { buildBaseOptions, buildPageOptions, formatGemmaVramMode, readNumberEnv, summarizePreview, summarizeTranslationOptions } from "./pipeline/options";
import { loadTranslationRuntimePort } from "./pipeline/translationRuntimePort";
import type {
  OcrBboxResult,
  OverlayItem,
  PipelineOptions,
} from "./pipeline/types";

const OCR_TEXT_TRANSLATION_CHUNK_SIZE = 80;

export type PipelineTimingSummary = {
  totalMs: number;
  ocrMs: number;
  translationMs: number;
};

export type WholePagePipelineResult = {
  pages: MangaPage[];
  warnings: string[];
  timings: PipelineTimingSummary;
};

export async function runWholePagePipeline({
  jobId,
  emit,
  onCleanupReady,
  onPageComplete,
  onPageFailed,
  decodeImage,
  pages,
  runPaths,
  signal,
  skipOcrPrepass = false
}: PipelineOptions): Promise<WholePagePipelineResult> {
  const pipelineStartedAt = Date.now();
  let ocrMs = 0;
  let translationMs = 0;

  const buildResult = (resultPages: MangaPage[]): WholePagePipelineResult => ({
    pages: resultPages,
    warnings,
    timings: {
      totalMs: Date.now() - pipelineStartedAt,
      ocrMs,
      translationMs
    }
  });

  if (pages.length === 0) {
    return buildResult([]);
  }

  throwIfAborted(signal);

  const paths = getAppPaths();
  const appSettings = await getAppSettings(paths);
  const runtime = loadTranslationRuntimePort();
  const baseOptions = buildBaseOptions(jobId, runPaths.runDir, appSettings, paths);
  const progressTotal = pages.length;
  const codexSelected = baseOptions.modelProvider === "openai-codex";
  const modelCached = codexSelected || runtime.isModelCached(baseOptions);
  const localModelSelected = !codexSelected && baseOptions.modelSource === "local";
  const parallelOcrTextMode = codexSelected && !skipOcrPrepass && String(baseOptions.translationMode ?? "") === "ocr-text";
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

  let ocrHintsByPageId = new Map<string, OcrBboxResult>();
  if (!skipOcrPrepass && !parallelOcrTextMode) {
    const ocrStartedAt = Date.now();
    ocrHintsByPageId = await prepareOcrHintsForPages({
      runtime,
      baseOptions,
      pages,
      runPaths,
      emit,
      jobId,
      signal
    });
    ocrMs = Date.now() - ocrStartedAt;
  }

  if (skipOcrPrepass) {
    logInfo("OCR prepass skipped for analysis pipeline", {
      jobId,
      pageCount: pages.length
    });
  }

  throwIfAborted(signal);

  const pageIndexById = new Map(pages.map((page, index) => [page.id, index]));
  const completedPagesById = new Map<string, MangaPage>();
  const pagesToTranslate: MangaPage[] = [];

  for (const page of pages) {
    const ocrResult = ocrHintsByPageId.get(page.id);
    if (!isOcrResultNoTextDetected(ocrResult)) {
      pagesToTranslate.push(page);
      continue;
    }

    const pageIndex = (pageIndexById.get(page.id) ?? 0) + 1;
    const noTextPage = buildNoTextCompletedPage(page);
    completedPagesById.set(page.id, noTextPage);
    await onPageComplete?.(noTextPage);
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: `${page.name} 텍스트 없음`,
      phase: "page_done",
      progressCurrent: pageIndex,
      progressTotal,
      pageIndex,
      pageTotal: pages.length,
      detail: "Paddle OCR에서 번역 대상 텍스트 근거를 찾지 못해 모델 호출을 생략했습니다."
    });
  }

  if (pagesToTranslate.length === 0) {
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: "결과 정리 중",
      phase: "finalizing",
      progressCurrent: progressTotal,
      progressTotal,
      pageTotal: pages.length,
      detail: `${pages.length} pages ready, 모델 호출 없음`
    });

    return buildResult(pages.map((page) => completedPagesById.get(page.id) ?? page));
  }

  const translationStartedAt = Date.now();

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

  const endpointSession = await runtime.startEndpointSession(baseOptions);
  const server = endpointSession.handle;
  onCleanupReady?.(() => endpointSession.dispose());
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

  const buildRequestPageOptions = (page: MangaPage, pageIndex: number, attempt: number): TranslationOptions => {
    const pageOptions = buildPageOptions(baseOptions, page, pageIndex, attempt);
    if (skipOcrPrepass) {
      pageOptions.skipOcrBboxHints = true;
      pageOptions.regionCropMode = true;
      pageOptions.ocrBboxProvider = "none";
      delete pageOptions.ocrBboxHints;
    } else {
      pageOptions.ocrBboxHints = ocrHintsByPageId.get(page.id)?.hints ?? [];
    }
    if (page.webMeta?.ocrTiles?.length) {
      pageOptions.translationMode = "ocr-text";
      pageOptions.imageFirst = false;
      pageOptions.includeEnhancedVariant = false;
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

  const parseTranslationOverlayItems = (outputText: string, page: MangaPage, pageOptions: TranslationOptions): OverlayItem[] => {
    let parsed: unknown;
    try {
      parsed = runtime.parseJsonLenient(outputText);
    } catch (error) {
      const preview = summarizePreview(outputText);
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

    return runtime.normalizeItems(parsed);
  };

  const requestPageOverlayItems = async (
    page: MangaPage,
    pageOptions: TranslationOptions,
    pageIndex: number,
    attempt: number
  ): Promise<{
    items: OverlayItem[];
    requestBody: unknown;
    outputText: string;
    noTextDetected: boolean;
  }> => {
    const ocrHints = Array.isArray(pageOptions.ocrBboxHints) ? pageOptions.ocrBboxHints : [];
    if (shouldChunkOcrTextTranslation(pageOptions, ocrHints)) {
      return requestChunkedOcrTextTranslation(page, pageOptions, pageIndex, attempt, ocrHints);
    }

    const result = await runtime.requestTranslation(server, pageOptions);
    await runtime.saveArtifacts(pageOptions, result);
    const items = parseTranslationOverlayItems(result.outputText, page, pageOptions);
    return {
      items,
      requestBody: result.requestBody,
      outputText: result.outputText,
      noTextDetected: items.length === 0 && isRequestNoTextDetected(result.requestBody)
    };
  };

  const requestChunkedOcrTextTranslation = async (
    page: MangaPage,
    pageOptions: TranslationOptions,
    pageIndex: number,
    attempt: number,
    ocrHints: unknown[]
  ): Promise<{
    items: OverlayItem[];
    requestBody: unknown;
    outputText: string;
    noTextDetected: boolean;
  }> => {
    const chunks = chunkArray(ocrHints, OCR_TEXT_TRANSLATION_CHUNK_SIZE);
    const mergedItems: OverlayItem[] = [];
    const mergedOutputs: string[] = [];
    let firstRequestBody: unknown = null;
    let emptyChunkCount = 0;

    logInfo("OCR text translation chunking enabled", {
      jobId,
      page: summarizePage(page),
      hintCount: ocrHints.length,
      chunkSize: OCR_TEXT_TRANSLATION_CHUNK_SIZE,
      chunkCount: chunks.length
    });

    for (const [chunkIndex, chunkHints] of chunks.entries()) {
      throwIfAborted(signal);
      const chunkNumber = chunkIndex + 1;
      const chunkOptions: TranslationOptions = {
        ...pageOptions,
        ocrBboxHints: chunkHints,
        ocrBboxHintLimit: OCR_TEXT_TRANSLATION_CHUNK_SIZE,
        outputDir: join(pageOptions.outputDir, "chunks", `chunk-${String(chunkNumber).padStart(3, "0")}`),
        label: `${pageOptions.label}-chunk-${chunkNumber}-of-${chunks.length}`
      };

      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${page.name} 번역 청크 ${chunkNumber}/${chunks.length}`,
        phase: "page_running",
        progressCurrent: pageIndex + 1,
        progressTotal,
        pageIndex: pageIndex + 1,
        pageTotal: pages.length,
        attempt,
        attemptTotal: maxAttempts,
        detail: `OCR 후보 ${chunkHints.length}개 번역 중`
      });

      const result = await runtime.requestTranslation(server, chunkOptions);
      await runtime.saveArtifacts(chunkOptions, result);
      if (!firstRequestBody) {
        firstRequestBody = result.requestBody;
      }

      const items = parseTranslationOverlayItems(result.outputText, page, chunkOptions);
      mergedOutputs.push(result.outputText);
      const chunkOverlayItemsPath = join(chunkOptions.outputDir, "overlay-items.json");
      await mkdir(chunkOptions.outputDir, { recursive: true });
      await writeFile(chunkOverlayItemsPath, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");

      if (items.length === 0) {
        emptyChunkCount += 1;
        warnings.push(`${page.name}: 번역 청크 ${chunkNumber}/${chunks.length}에서 블록이 생성되지 않았습니다.`);
        continue;
      }
      mergedItems.push(...items);
    }

    if (emptyChunkCount > 0) {
      logWarn("Some OCR text translation chunks returned no overlay items", {
        jobId,
        page: summarizePage(page),
        emptyChunkCount,
        chunkCount: chunks.length,
        mergedItemCount: mergedItems.length
      });
    }

    return {
      items: mergedItems,
      requestBody: buildMergedChunkRequestBody(firstRequestBody, ocrHints, page),
      outputText: mergedOutputs.join("\n\n"),
      noTextDetected: mergedItems.length === 0
    };
  };

  const completeTranslatedPage = async (
    page: MangaPage,
    pageOptions: TranslationOptions,
    pageIndex: number,
    attempt: number,
    translation: {
      items: OverlayItem[];
      requestBody: unknown;
      outputText: string;
      noTextDetected: boolean;
    }
  ): Promise<MangaPage> => {
    const items = translation.items;
    if (items.length === 0 && translation.noTextDetected) {
      const noTextPage = buildNoTextCompletedPage(page);
      await onPageComplete?.(noTextPage);
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${page.name} 텍스트 없음`,
        phase: "page_done",
        progressCurrent: pageIndex + 1,
        progressTotal,
        pageIndex: pageIndex + 1,
        pageTotal: pages.length,
        detail: "Paddle OCR에서 번역 대상 텍스트 근거를 찾지 못해 모델 호출을 생략했습니다."
      });
      return noTextPage;
    }
    if (items.length === 0) {
      const bboxError = new Error(`${page.name}: bbox 결과를 만들지 못했습니다.`);
      Object.assign(bboxError, {
        outputDir: pageOptions.outputDir,
        outputPreview: summarizePreview(translation.outputText)
      });
      throw bboxError;
    }

    const overlayItemsPath = join(pageOptions.outputDir, "overlay-items.json");
    await mkdir(pageOptions.outputDir, { recursive: true });
    await writeFile(overlayItemsPath, `${JSON.stringify({ items }, null, 2)}\n`, "utf8");

    let normalizedItems = applyOcrCandidateGeometryLocks(
      normalizeOverlayItemBboxes(items, page, getBboxNormalizationOptions(translation.requestBody)),
      page,
      getOcrBboxHints(translation.requestBody),
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
      pageIndex: pageIndex + 1,
      pageTotal: pages.length,
      progressTotal
    });
    const soundFiltered = filterRejectedOrUncertainSoundItems(normalizedItems);
    normalizedItems = soundFiltered.items;
    const blocks = await applySampledBackgroundColors(
      normalizedItems.map((item, itemIndex) =>
        overlayItemToBlock(item, page, itemIndex, { textOutlineWidthPx: pageOptions.textOutlineWidthPx })
      ),
      page,
      decodeImage
    );
    const successPage: MangaPage = {
      ...page,
      blocks,
      analysisStatus: "completed",
      lastError: undefined,
      updatedAt: new Date().toISOString()
    };
    warnings.push(...buildPageWarnings(page.name, normalizedItems));
    await onPageComplete?.(successPage);
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: `${page.name} 완료`,
      phase: "page_done",
      progressCurrent: pageIndex + 1,
      progressTotal,
      pageIndex: pageIndex + 1,
      pageTotal: pages.length,
      detail: soundFiltered.droppedCount > 0
        ? `${normalizedItems.length}개 블록, 불확실한 효과음 ${soundFiltered.droppedCount}개 제외`
        : `${normalizedItems.length}개 블록`
    });
    return successPage;
  };

  const tryRequestBatchedOcrTextTranslations = async (candidatePages?: MangaPage[]): Promise<void> => {
    if (skipOcrPrepass) {
      return;
    }

    const candidatePageIds = candidatePages ? new Set(candidatePages.map((page) => page.id)) : null;
    const pageJobs = pagesToTranslate
      .filter((page) => !candidatePageIds || candidatePageIds.has(page.id))
      .filter((page) => !completedPagesById.has(page.id))
      .map((page) => {
        const pageIndex = pageIndexById.get(page.id) ?? 0;
        const pageOptions = buildRequestPageOptions(page, pageIndex, 1);
        const hints = Array.isArray(pageOptions.ocrBboxHints) ? pageOptions.ocrBboxHints : [];
        return { page, pageIndex, pageOptions, hints };
      })
      .filter((job) =>
        String(job.pageOptions.translationMode ?? "") === "ocr-text" &&
        job.hints.length > 0
      );

    if (pageJobs.length < 2) {
      return;
    }

    type BatchHintRecord = {
      globalId: number;
      originalId: number;
      pageId: string;
      pageIndex: number;
      page: MangaPage;
      pageOptions: TranslationOptions;
      rawHint: unknown;
      promptHint: unknown;
    };

    const records: BatchHintRecord[] = [];
    let nextGlobalId = 1;
    for (const job of pageJobs) {
      for (const [hintIndex, hint] of job.hints.entries()) {
        const originalId = readHintId(hint) || hintIndex + 1;
        const globalId = nextGlobalId;
        nextGlobalId += 1;
        records.push({
          globalId,
          originalId,
          pageId: job.page.id,
          pageIndex: job.pageIndex,
          page: job.page,
          pageOptions: job.pageOptions,
          rawHint: hint,
          promptHint: buildBatchedPromptHint(hint, job.page, globalId, job.pageIndex + 1)
        });
      }
    }

    if (records.length === 0) {
      return;
    }

    const chunks = chunkArray(records, OCR_TEXT_TRANSLATION_CHUNK_SIZE);
    const itemsByPageId = new Map<string, OverlayItem[]>();
    const outputsByPageId = new Map<string, string[]>();
    const pageJobById = new Map(pageJobs.map((job) => [job.page.id, job]));
    const pageLastGlobalId = new Map<string, number>();
    for (const record of records) {
      pageLastGlobalId.set(record.pageId, Math.max(pageLastGlobalId.get(record.pageId) ?? 0, record.globalId));
    }
    const scheduledPageIds = new Set<string>();
    const completionTasks: Promise<void>[] = [];
    let firstRequestBody: unknown = null;
    let emptyChunkCount = 0;

    const scheduleCompletedPagesThrough = (lastGlobalId: number) => {
      for (const [pageId, lastPageGlobalId] of pageLastGlobalId.entries()) {
        if (lastPageGlobalId > lastGlobalId || scheduledPageIds.has(pageId)) {
          continue;
        }
        const job = pageJobById.get(pageId);
        if (!job) {
          continue;
        }
        const pageItems = itemsByPageId.get(pageId) ?? [];
        if (pageItems.length === 0) {
          scheduledPageIds.add(pageId);
          warnings.push(`${job.page.name}: 묶음 번역에서 블록이 생성되지 않아 페이지별 번역으로 재시도합니다.`);
          continue;
        }
        scheduledPageIds.add(pageId);
        logInfo("Batched OCR text translation page completion scheduled", {
          jobId,
          pageId,
          pageName: job.page.name,
          itemCount: pageItems.length,
          lastPageGlobalId,
          lastCompletedGlobalId: lastGlobalId
        });
        const task = completeTranslatedPage(job.page, job.pageOptions, job.pageIndex, 1, {
          items: pageItems,
          requestBody: buildMergedChunkRequestBody(firstRequestBody, job.hints, job.page),
          outputText: (outputsByPageId.get(pageId) ?? []).join("\n\n"),
          noTextDetected: false
        }).then((successPage) => {
          completedPagesById.set(pageId, successPage);
        });
        completionTasks.push(task);
      }
    };

    logInfo("Batched OCR text translation enabled", {
      jobId,
      pageCount: pageJobs.length,
      hintCount: records.length,
      chunkSize: OCR_TEXT_TRANSLATION_CHUNK_SIZE,
      chunkCount: chunks.length,
      pages: pageJobs.map((job) => summarizePage(job.page))
    });

    for (const [chunkIndex, chunkRecords] of chunks.entries()) {
      throwIfAborted(signal);
      const chunkNumber = chunkIndex + 1;
      const chunkOptions: TranslationOptions = {
        ...chunkRecords[0]!.pageOptions,
        imagePath: "",
        imageWidth: 1000,
        imageHeight: 1000,
        translationMode: "ocr-text",
        imageFirst: false,
        includeEnhancedVariant: false,
        multiPageOcrTextBatch: true,
        ocrBboxProvider: "none",
        ocrBboxHints: chunkRecords.map((record, localIndex) => ({
          ...(record.promptHint && typeof record.promptHint === "object" ? record.promptHint as Record<string, unknown> : {}),
          id: localIndex + 1,
          sourceId: record.globalId
        })),
        ocrBboxHintLimit: OCR_TEXT_TRANSLATION_CHUNK_SIZE,
        outputDir: join(runPaths.runDir, "multi-page-translation", `chunk-${String(chunkNumber).padStart(3, "0")}`),
        label: `${baseOptions.label}-multi-page-chunk-${chunkNumber}-of-${chunks.length}`
      };

      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `묶음 번역 청크 ${chunkNumber}/${chunks.length}`,
        phase: "page_running",
        progressCurrent: Math.min(progressTotal, Math.max(...chunkRecords.map((record) => record.pageIndex + 1))),
        progressTotal,
        pageTotal: pages.length,
        attempt: 1,
        attemptTotal: maxAttempts,
        detail: `${pageJobs.length}페이지 OCR 후보 중 ${chunkRecords.length}개 번역 중`
      });

      const result = await runtime.requestTranslation(server, chunkOptions);
      await runtime.saveArtifacts(chunkOptions, result);
      if (!firstRequestBody) {
        firstRequestBody = result.requestBody;
      }

      const chunkItems = runtime.normalizeItems(runtime.parseJsonLenient(result.outputText));
      const recordByChunkLocalId = new Map(chunkRecords.map((record, localIndex) => [localIndex + 1, record]));
      const recordByGlobalId = new Map(chunkRecords.map((record) => [record.globalId, record]));
      const pagesWithMappedItems = new Set<string>();
      let acceptedItemCount = 0;
      let globalIdFallbackCount = 0;
      for (const item of chunkItems) {
        const record = recordByChunkLocalId.get(item.id) ?? recordByGlobalId.get(item.id);
        if (!record) {
          continue;
        }
        if (!recordByChunkLocalId.has(item.id) && recordByGlobalId.has(item.id)) {
          globalIdFallbackCount += 1;
        }
        const pageItems = itemsByPageId.get(record.pageId) ?? [];
        pageItems.push({
          ...item,
          id: record.originalId
        });
        itemsByPageId.set(record.pageId, pageItems);
        pagesWithMappedItems.add(record.pageId);
        acceptedItemCount += 1;
      }
      for (const pageId of pagesWithMappedItems) {
        const pageOutputs = outputsByPageId.get(pageId) ?? [];
        pageOutputs.push(result.outputText);
        outputsByPageId.set(pageId, pageOutputs);
      }
      logInfo("Batched OCR text translation chunk mapped", {
        jobId,
        chunkNumber,
        chunkCount: chunks.length,
        returnedItemCount: chunkItems.length,
        acceptedItemCount,
        globalIdFallbackCount,
        pageCount: pagesWithMappedItems.size
      });

      const chunkOverlayItemsPath = join(chunkOptions.outputDir, "overlay-items.json");
      await mkdir(chunkOptions.outputDir, { recursive: true });
      await writeFile(chunkOverlayItemsPath, `${JSON.stringify({ items: chunkItems }, null, 2)}\n`, "utf8");

      if (acceptedItemCount === 0) {
        emptyChunkCount += 1;
        warnings.push(`묶음 번역 청크 ${chunkNumber}/${chunks.length}에서 블록이 생성되지 않았습니다.`);
      }

      scheduleCompletedPagesThrough(Math.max(...chunkRecords.map((record) => record.globalId)));
    }

    if (emptyChunkCount > 0) {
      logWarn("Some batched OCR text translation chunks returned no mapped overlay items", {
        jobId,
        emptyChunkCount,
        chunkCount: chunks.length
      });
    }

    if (completionTasks.length > 0) {
      await Promise.all(completionTasks);
    }
  };

  const runParallelOcrTextTranslation = async (): Promise<void> => {
    if (!parallelOcrTextMode) {
      return;
    }

    let translationChain = Promise.resolve();
    const ocrStartedAt = Date.now();
    logInfo("Parallel OCR/Codex translation enabled", {
      jobId,
      pageCount: pages.length,
      ocrBatchSize: baseOptions.ocrBatchSize,
      translationMode: baseOptions.translationMode
    });

    ocrHintsByPageId = await prepareOcrHintsForPages({
      runtime,
      baseOptions,
      pages,
      runPaths,
      emit,
      jobId,
      signal,
      onPagesCompleted: (readyPages) => {
        for (const ready of readyPages) {
          ocrHintsByPageId.set(ready.page.id, ready.result);
        }
        translationChain = translationChain.then(async () => {
          throwIfAborted(signal);
          for (const ready of readyPages) {
            if (completedPagesById.has(ready.page.id) || !isOcrResultNoTextDetected(ready.result)) {
              continue;
            }
            const noTextPage = buildNoTextCompletedPage(ready.page);
            completedPagesById.set(ready.page.id, noTextPage);
            await onPageComplete?.(noTextPage);
            emit({
              id: jobId,
              kind: "gemma-analysis",
              status: "running",
              progressText: `${ready.page.name} 텍스트 없음`,
              phase: "page_done",
              progressCurrent: ready.index + 1,
              progressTotal,
              pageIndex: ready.index + 1,
              pageTotal: pages.length,
              detail: "Paddle OCR에서 번역 대상 텍스트 근거를 찾지 못해 모델 호출을 생략했습니다."
            });
          }
          logInfo("Parallel OCR/Codex translation batch queued", {
            jobId,
            readyPageCount: readyPages.length,
            readyPages: readyPages.map((ready) => ({
              pageId: ready.page.id,
              pageName: ready.page.name,
              hintCount: ready.result.hints.length,
              noTextDetected: Boolean(ready.result.noTextDetected)
            }))
          });
          await tryRequestBatchedOcrTextTranslations(readyPages.map((ready) => ready.page));
        });
      }
    });
    ocrMs = Date.now() - ocrStartedAt;
    await translationChain;
  };

  try {
    try {
      if (parallelOcrTextMode) {
        await runParallelOcrTextTranslation();
      } else {
        await tryRequestBatchedOcrTextTranslations();
      }
    } catch (error) {
      if (isAbortErrorLike(error) || isNonRetriableRuntimeError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`묶음 OCR 텍스트 번역 실패 - 페이지별 번역으로 전환합니다. ${message}`);
      logWarn("Batched OCR text translation failed; falling back to per-page translation", {
        failureCategory: classifyFailure(error),
        jobId,
        pageCount: pagesToTranslate.length,
        error
      });
    }

    for (let translateIndex = 0; translateIndex < pagesToTranslate.length; translateIndex += 1) {
      const page = pagesToTranslate[translateIndex];
      if (completedPagesById.has(page.id)) {
        continue;
      }
      const index = pageIndexById.get(page.id) ?? 0;
      throwIfAborted(signal);
      let successPage: MangaPage | null = null;
      let lastErrorMessage = "";
      let lastError: unknown;
      let lastPageOptions: TranslationOptions | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        throwIfAborted(signal);

        const pageOptions = buildRequestPageOptions(page, index, attempt);
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
          const translation = await requestPageOverlayItems(page, pageOptions, index, attempt);
          successPage = await completeTranslatedPage(page, pageOptions, index, attempt, translation);
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
      detail: `${pages.length} pages ready`
    });

    translationMs = Date.now() - translationStartedAt;
    return buildResult(pages.map((page) => completedPagesById.get(page.id) ?? page));
  } finally {
    translationMs = Math.max(translationMs, Date.now() - translationStartedAt);
    await endpointSession.dispose();
  }
}

function shouldChunkOcrTextTranslation(options: TranslationOptions, ocrHints: unknown[]): boolean {
  return String(options.translationMode ?? "") === "ocr-text" && ocrHints.length > OCR_TEXT_TRANSLATION_CHUNK_SIZE;
}

function buildBatchedPromptHint(hint: unknown, page: MangaPage, globalId: number, pageNumber: number): unknown {
  if (!hint || typeof hint !== "object") {
    return {
      id: globalId,
      label: `page_${pageNumber}_text`,
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1
    };
  }

  const record = hint as Record<string, unknown>;
  const x1 = Number(record.x1);
  const y1 = Number(record.y1);
  const x2 = Number(record.x2);
  const y2 = Number(record.y2);
  const pageWidth = Math.max(1, page.width);
  const pageHeight = Math.max(1, page.height);
  const hasValidBox = [x1, y1, x2, y2].every(Number.isFinite);

  return {
    ...record,
    id: globalId,
    label: `page_${pageNumber}_${String(record.label ?? "text")}`,
    x1: hasValidBox ? Math.round((Math.min(x1, x2) / pageWidth) * 1000) : 0,
    y1: hasValidBox ? Math.round((Math.min(y1, y2) / pageHeight) * 1000) : 0,
    x2: hasValidBox ? Math.round((Math.max(x1, x2) / pageWidth) * 1000) : 1,
    y2: hasValidBox ? Math.round((Math.max(y1, y2) / pageHeight) * 1000) : 1
  };
}

function readHintId(hint: unknown): number | null {
  if (!hint || typeof hint !== "object") {
    return null;
  }
  const id = Number((hint as Record<string, unknown>).id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
}

function buildMergedChunkRequestBody(firstRequestBody: unknown, ocrHints: unknown[], page: MangaPage): unknown {
  const base = firstRequestBody && typeof firstRequestBody === "object" ? firstRequestBody as Record<string, unknown> : {};
  return {
    ...base,
    bboxCoordinateSpace: base.bboxCoordinateSpace ?? "pixels",
    bboxCoordinateFrame: base.bboxCoordinateFrame ?? {
      width: page.width,
      height: page.height
    },
    ocrBboxHintCount: ocrHints.length,
    ocrBboxHintLimit: OCR_TEXT_TRANSLATION_CHUNK_SIZE,
    ocrBboxHints: ocrHints
  };
}
