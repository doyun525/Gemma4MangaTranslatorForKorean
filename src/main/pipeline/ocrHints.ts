import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TranslationOptions } from "../appSettings";
import type { ChapterRunPaths } from "../library";
import type { JobEvent, MangaPage } from "../../shared/types";
import { throwIfAborted } from "./failure";
import { isOcrResultNoTextDetected } from "./noText";
import type { TranslationRuntimePort } from "./translationRuntimePort";
import type { OcrBboxResult } from "./types";
import { logInfo } from "../logger";
import { formatStoredTimestamp } from "../../shared/storedTimestamp";

const OCR_HINT_CACHE_SCHEMA_VERSION = 4;

export async function prepareOcrHintsForPages({
  runtime,
  baseOptions,
  pages,
  runPaths,
  emit,
  jobId,
  signal,
  onPagesCompleted
}: {
  runtime: TranslationRuntimePort;
  baseOptions: TranslationOptions;
  pages: MangaPage[];
  runPaths: ChapterRunPaths;
  emit: (event: JobEvent) => void;
  jobId: string;
  signal: AbortSignal;
  onPagesCompleted?: (pages: Array<{ page: MangaPage; index: number; result: OcrBboxResult }>) => void;
}): Promise<Map<string, OcrBboxResult>> {
  const results = new Map<string, OcrBboxResult>();
  const total = pages.length;
  const pendingPages: Array<{
    page: MangaPage;
    index: number;
    options: TranslationOptions;
    cachePath: string;
    mergeGroupId?: string;
    tile?: { x: number; y: number; width: number; height: number };
  }> = [];

  for (const [index, page] of pages.entries()) {
    throwIfAborted(signal);
    const cachePath = getOcrHintsCachePath(runPaths, page);
    const cached = await readCachedOcrHints(cachePath, page);
    if (cached) {
      const filtered = applyOcrTextlineScorePolicy(cached, baseOptions);
      results.set(page.id, filtered);
      logInfo("OCR hint cache reused", {
        jobId,
        chapterDir: runPaths.chapterDir,
        pageId: page.id,
        pageName: page.name,
        imageWidth: page.width,
        imageHeight: page.height,
        hintCount: filtered.hints.length,
        originalHintCount: cached.hints.length,
        filteredHintCount: cached.hints.length - filtered.hints.length,
        textEvidenceCount: filtered.textEvidenceCount,
        noTextDetected: Boolean(filtered.noTextDetected)
      });
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
        detail: formatOcrHintDetail(filtered)
      });
      onPagesCompleted?.([{ page, index, result: filtered }]);
      continue;
    }

    const pageOcrTiles = getWebOcrTiles(page);
    const pageOptionsList = pageOcrTiles.length > 0
      ? pageOcrTiles.map((tile, tileIndex) => buildOcrTileOptions(baseOptions, page, tile, runPaths, index, total, tileIndex, pageOcrTiles.length))
      : [buildOcrPageOptions(baseOptions, page, runPaths, index, total)];

    for (const [tileIndex, ocrOptions] of pageOptionsList.entries()) {
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
      pendingPages.push({
        page,
        index,
        options: ocrOptions,
        cachePath,
        mergeGroupId: pageOcrTiles.length > 0 ? page.id : undefined,
        tile: pageOcrTiles[tileIndex]
      });
    }
  }

  if (pendingPages.length > 0) {
    pendingPages.forEach((entry) => {
      entry.options.ocrBatchCompletedBefore = results.size;
      entry.options.ocrBatchTotal = pendingPages.length;
    });
    const tiledPageCount = new Set(pendingPages.filter((entry) => entry.mergeGroupId).map((entry) => entry.page.id)).size;
    emit({
      id: jobId,
      kind: "gemma-analysis",
      status: "running",
      progressText: "Paddle OCR 배치 선분석 중",
      phase: "ocr_running",
      progressCurrent: 0,
      progressTotal: pendingPages.length,
      pageTotal: total,
      detail: tiledPageCount > 0
        ? `${tiledPageCount}개 긴 페이지를 ${pendingPages.length}개 OCR 타일로 나누어 처리합니다.`
        : `${pendingPages.length}페이지를 한 번에 처리합니다. Paddle OCR 워커가 준비되어 있으면 모델을 재사용합니다.`
    });

    const batchStartedAt = Date.now();
    const persistentOcrWorkerEnabled = !["1", "true", "yes", "y", "on"].includes(
      String(process.env.MANGA_TRANSLATOR_DISABLE_OCR_WORKER ?? "").trim().toLowerCase()
    );
    const hasTiledPages = pendingPages.some((entry) => entry.mergeGroupId);
    const ocrBatchSize = Math.max(1, Math.floor(Number(baseOptions.ocrBatchSize) || 1));
    const processingBatches = hasTiledPages ? [pendingPages] : chunkArray(pendingPages, ocrBatchSize);
    logInfo("OCR batch started", {
      jobId,
      chapterDir: runPaths.chapterDir,
      pageCount: pendingPages.length,
      totalPageCount: total,
      processingBatchCount: processingBatches.length,
      ocrEngine: baseOptions.ocrEngine,
      ocrBboxProvider: baseOptions.ocrBboxProvider,
      ocrDevice: baseOptions.ocrDevice,
      ocrBatchSize: baseOptions.ocrBatchSize,
      modelReuse: persistentOcrWorkerEnabled ? "persistent-worker" : "process-per-batch",
      modelReuseNote: persistentOcrWorkerEnabled
        ? "Paddle OCR worker is reused when available; set MANGA_TRANSLATOR_DISABLE_OCR_WORKER=1 to force process-per-batch."
        : "Persistent OCR worker is disabled by MANGA_TRANSLATOR_DISABLE_OCR_WORKER.",
      pages: pendingPages.map((entry) => ({
        pageId: entry.page.id,
        pageName: entry.page.name,
        imageWidth: entry.options.imageWidth ?? entry.page.width,
        imageHeight: entry.options.imageHeight ?? entry.page.height,
        tile: entry.tile
      }))
    });

    const batchResults: OcrBboxResult[] = [];
    for (const [processingBatchIndex, processingBatch] of processingBatches.entries()) {
      throwIfAborted(signal);
      const partialStartedAt = Date.now();
      logInfo("OCR processing batch started", {
        jobId,
        chapterDir: runPaths.chapterDir,
        processingBatchIndex: processingBatchIndex + 1,
        processingBatchCount: processingBatches.length,
        pageCount: processingBatch.length,
        ocrBatchSize: baseOptions.ocrBatchSize,
        pages: processingBatch.map((entry) => ({
          pageId: entry.page.id,
          pageName: entry.page.name,
          imageWidth: entry.options.imageWidth ?? entry.page.width,
          imageHeight: entry.options.imageHeight ?? entry.page.height,
          tile: entry.tile
        }))
      });
      const partialResults = await runtime.collectOcrHintsBatch(processingBatch.map((entry) => entry.options));
      const partialElapsedMs = Date.now() - partialStartedAt;
      batchResults.push(...partialResults);
      logInfo("OCR processing batch completed", {
        jobId,
        chapterDir: runPaths.chapterDir,
        processingBatchIndex: processingBatchIndex + 1,
        processingBatchCount: processingBatches.length,
        pageCount: processingBatch.length,
        elapsedMs: partialElapsedMs,
        elapsedText: formatDuration(partialElapsedMs),
        ocrBatchSize: baseOptions.ocrBatchSize
      });

      if (!hasTiledPages) {
        const completedInBatch: Array<{ page: MangaPage; index: number; result: OcrBboxResult }> = [];
        for (const [localIndex, result] of partialResults.entries()) {
          const entry = processingBatch[localIndex];
          if (!entry) {
            continue;
          }
          const filtered = applyOcrTextlineScorePolicy(result, baseOptions);
          await writeCachedOcrHints(entry.cachePath, entry.page, filtered);
          results.set(entry.page.id, filtered);
          completedInBatch.push({ page: entry.page, index: entry.index, result: filtered });
        }
        onPagesCompleted?.(completedInBatch);
      }
    }
    const batchElapsedMs = Date.now() - batchStartedAt;
    const averagePageElapsedMs = pendingPages.length > 0 ? Math.round(batchElapsedMs / pendingPages.length) : batchElapsedMs;

    logInfo("OCR batch completed", {
      jobId,
      chapterDir: runPaths.chapterDir,
      pageCount: pendingPages.length,
      elapsedMs: batchElapsedMs,
      elapsedText: formatDuration(batchElapsedMs),
      averagePageElapsedMs,
      averagePageElapsedText: formatDuration(averagePageElapsedMs),
      ocrEngine: baseOptions.ocrEngine,
      ocrBboxProvider: baseOptions.ocrBboxProvider,
      ocrDevice: baseOptions.ocrDevice,
      ocrBatchSize: baseOptions.ocrBatchSize
    });

    const mergedTileResults = mergeTiledOcrResults(pendingPages, batchResults);
    for (const [batchIndex, result] of batchResults.entries()) {
      throwIfAborted(signal);
      const entry = pendingPages[batchIndex];
      if (!entry) {
        continue;
      }
      if (entry.mergeGroupId) {
        continue;
      }
      if (!results.has(entry.page.id)) {
        await writeCachedOcrHints(entry.cachePath, entry.page, result);
        results.set(entry.page.id, result);
      }
      logInfo("OCR page completed", {
        jobId,
        chapterDir: runPaths.chapterDir,
        pageId: entry.page.id,
        pageName: entry.page.name,
        pageIndex: entry.index + 1,
        pageTotal: total,
        batchIndex: batchIndex + 1,
        batchTotal: pendingPages.length,
        elapsedMs: pendingPages.length === 1 ? batchElapsedMs : averagePageElapsedMs,
        elapsedText: pendingPages.length === 1 ? formatDuration(batchElapsedMs) : formatDuration(averagePageElapsedMs),
        elapsedKind: pendingPages.length === 1 ? "exact" : "batch-average",
        batchElapsedMs,
        ocrEngine: baseOptions.ocrEngine,
        ocrBboxProvider: baseOptions.ocrBboxProvider,
        ocrDevice: baseOptions.ocrDevice,
        ocrBatchSize: baseOptions.ocrBatchSize,
        imageWidth: entry.page.width,
        imageHeight: entry.page.height,
        hintCount: results.get(entry.page.id)?.hints.length ?? result.hints.length,
        originalHintCount: result.hints.length,
        filteredHintCount: result.hints.length - (results.get(entry.page.id)?.hints.length ?? result.hints.length),
        textEvidenceCount: results.get(entry.page.id)?.textEvidenceCount ?? result.textEvidenceCount,
        noTextDetected: Boolean(results.get(entry.page.id)?.noTextDetected ?? result.noTextDetected)
      });
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
        detail: `${formatOcrHintDetail(results.get(entry.page.id) ?? result)}, OCR ${pendingPages.length === 1 ? formatDuration(batchElapsedMs) : `${formatDuration(averagePageElapsedMs)} 평균`}`
      });
    }
    for (const merged of mergedTileResults) {
      throwIfAborted(signal);
      const filtered = applyOcrTextlineScorePolicy(merged.result, baseOptions);
      await writeCachedOcrHints(merged.cachePath, merged.page, filtered);
      results.set(merged.page.id, filtered);
      onPagesCompleted?.([{ page: merged.page, index: merged.index, result: filtered }]);
      logInfo("OCR tiled page completed", {
        jobId,
        chapterDir: runPaths.chapterDir,
        pageId: merged.page.id,
        pageName: merged.page.name,
        pageIndex: merged.index + 1,
        pageTotal: total,
        tileCount: merged.tileCount,
        elapsedMs: batchElapsedMs,
        elapsedText: formatDuration(batchElapsedMs),
        ocrEngine: baseOptions.ocrEngine,
        ocrBboxProvider: baseOptions.ocrBboxProvider,
        ocrDevice: baseOptions.ocrDevice,
        ocrBatchSize: baseOptions.ocrBatchSize,
        imageWidth: merged.page.width,
        imageHeight: merged.page.height,
        hintCount: filtered.hints.length,
        originalHintCount: merged.result.hints.length,
        filteredHintCount: merged.result.hints.length - filtered.hints.length,
        textEvidenceCount: filtered.textEvidenceCount,
        noTextDetected: Boolean(filtered.noTextDetected)
      });
      emit({
        id: jobId,
        kind: "gemma-analysis",
        status: "running",
        progressText: `${merged.page.name} OCR 완료`,
        phase: "ocr_running",
        progressCurrent: Math.min(total, merged.index + 1),
        progressTotal: total,
        pageIndex: merged.index + 1,
        pageTotal: total,
        detail: `${merged.tileCount}개 타일 병합, ${formatOcrHintDetail(filtered)}`
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

export async function inspectOcrHintCacheCoverage(
  runPaths: ChapterRunPaths,
  pages: MangaPage[]
): Promise<{
  cachedCount: number;
  pendingCount: number;
  totalCount: number;
  allCached: boolean;
}> {
  let cachedCount = 0;
  for (const page of pages) {
    const cached = await readCachedOcrHints(getOcrHintsCachePath(runPaths, page), page);
    if (cached) {
      cachedCount += 1;
    }
  }
  const totalCount = pages.length;
  const pendingCount = totalCount - cachedCount;
  return {
    cachedCount,
    pendingCount,
    totalCount,
    allCached: totalCount > 0 && pendingCount === 0
  };
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "0ms";
  }
  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)}s`;
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

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }
  return chunks;
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

function buildOcrTileOptions(
  baseOptions: TranslationOptions,
  page: MangaPage,
  tile: { imagePath: string; x: number; y: number; width: number; height: number },
  runPaths: ChapterRunPaths,
  index: number,
  total: number,
  tileIndex: number,
  tileTotal: number
): TranslationOptions {
  const outputDir = join(getOcrHintsOutputDir(runPaths, page), `tile-${String(tileIndex + 1).padStart(3, "0")}`);
  return {
    ...baseOptions,
    imagePath: tile.imagePath,
    imageWidth: tile.width,
    imageHeight: tile.height,
    outputDir,
    label: `ocr-page-${index + 1}-tile-${tileIndex + 1}`,
    ocrPageIndex: index + 1,
    ocrPageTotal: total,
    ocrTileIndex: tileIndex + 1,
    ocrTileTotal: tileTotal,
    ocrProgressDefaultToPage: true
  };
}

function getWebOcrTiles(page: MangaPage): Array<{ imagePath: string; x: number; y: number; width: number; height: number }> {
  const tiles = page.webMeta?.ocrTiles;
  if (!Array.isArray(tiles) || tiles.length === 0) {
    return [];
  }
  return tiles
    .filter((tile) =>
      typeof tile.imagePath === "string" &&
      Number.isFinite(tile.x) &&
      Number.isFinite(tile.y) &&
      Number.isFinite(tile.width) &&
      Number.isFinite(tile.height) &&
      tile.width > 0 &&
      tile.height > 0
    )
    .map((tile) => ({
      imagePath: tile.imagePath,
      x: Number(tile.x),
      y: Number(tile.y),
      width: Number(tile.width),
      height: Number(tile.height)
    }));
}

function mergeTiledOcrResults(
  pendingPages: Array<{
    page: MangaPage;
    index: number;
    options: TranslationOptions;
    cachePath: string;
    mergeGroupId?: string;
    tile?: { x: number; y: number; width: number; height: number };
  }>,
  batchResults: OcrBboxResult[]
): Array<{ page: MangaPage; index: number; cachePath: string; result: OcrBboxResult; tileCount: number }> {
  const groups = new Map<string, {
    page: MangaPage;
    index: number;
    cachePath: string;
    tileCount: number;
    hints: unknown[];
    diagnostics: unknown[];
    textEvidenceCount: number;
  }>();
  for (const [batchIndex, entry] of pendingPages.entries()) {
    if (!entry.mergeGroupId || !entry.tile) {
      continue;
    }
    const result = batchResults[batchIndex];
    if (!result) {
      continue;
    }
    const group = groups.get(entry.mergeGroupId) ?? {
      page: entry.page,
      index: entry.index,
      cachePath: entry.cachePath,
      tileCount: 0,
      hints: [],
      diagnostics: [],
      textEvidenceCount: 0
    };
    group.tileCount += 1;
    group.diagnostics.push(...(result.diagnostics ?? []));
    group.textEvidenceCount += Number(result.textEvidenceCount) || 0;
    group.hints.push(...(result.hints ?? []).map((hint) => rebaseOcrHintToPage(hint, entry.tile!, entry.page)));
    groups.set(entry.mergeGroupId, group);
  }
  return [...groups.values()].map((group) => {
    const hints = renumberOcrHints(dedupeRebasedOcrHints(group.hints));
    return {
      page: group.page,
      index: group.index,
      cachePath: group.cachePath,
      tileCount: group.tileCount,
      result: {
        hints,
        diagnostics: group.diagnostics,
        noTextDetected: hints.length === 0 || group.textEvidenceCount === 0,
        textEvidenceCount: Math.min(group.textEvidenceCount, hints.length)
      }
    };
  });
}

function dedupeRebasedOcrHints(hints: unknown[]): unknown[] {
  const orderedHints = [...hints].sort(compareOcrHintsForDedupe);
  const accepted: unknown[] = [];
  for (const hint of orderedHints) {
    if (!isDuplicateOcrHint(hint, accepted)) {
      accepted.push(hint);
    }
  }
  return accepted.sort(compareOcrHintsByReadingOrder);
}

function renumberOcrHints(hints: unknown[]): unknown[] {
  return hints.map((hint, index) => {
    if (!hint || typeof hint !== "object") {
      return hint;
    }
    return {
      ...(hint as Record<string, unknown>),
      id: index + 1
    };
  });
}

function applyOcrTextlineScorePolicy(result: OcrBboxResult, options: TranslationOptions): OcrBboxResult {
  const hints = Array.isArray(result.hints) ? result.hints : [];
  const threshold = options.includeSoundEffects === false ? 0.7 : 0.5;
  const filteredHints = hints.filter((hint) => {
    if (!hint || typeof hint !== "object") {
      return true;
    }
    const record = hint as Record<string, unknown>;
    const label = String(record.label ?? "").trim();
    if (label !== "ocr_textline" && label !== "ocr_textgroup") {
      return true;
    }
    const score = Number(record.score ?? record.confidence);
    if (!Number.isFinite(score)) {
      return false;
    }
    return options.includeSoundEffects === false ? score >= threshold : score > threshold;
  });
  if (filteredHints.length === hints.length) {
    return result;
  }
  const textEvidenceCount = countOcrTextEvidence(filteredHints);
  return {
    ...result,
    hints: renumberOcrHints(filteredHints),
    textEvidenceCount,
    noTextDetected: filteredHints.length === 0 || textEvidenceCount === 0,
    diagnostics: [
      ...(Array.isArray(result.diagnostics) ? result.diagnostics : []),
      {
        provider: "ocr-textline-score-filter",
        labels: ["ocr_textline", "ocr_textgroup"],
        threshold,
        includeSoundEffects: options.includeSoundEffects !== false,
        originalHintCount: hints.length,
        filteredHintCount: hints.length - filteredHints.length,
        remainingHintCount: filteredHints.length
      }
    ]
  };
}

function countOcrTextEvidence(hints: unknown[]): number {
  return hints.reduce<number>((count, hint) => count + (hasTranslatableTextEvidence(readHintText(hint)) ? 1 : 0), 0);
}

function hasTranslatableTextEvidence(value: string): boolean {
  const text = String(value ?? "");
  if (/[A-Za-z]{2,}/.test(text) || /(^|[^A-Za-z])[AIai]([^A-Za-z]|$)/.test(text)) {
    return true;
  }
  for (const char of text) {
    const code = char.codePointAt(0);
    if (
      typeof code === "number" &&
      (
        (code >= 0x3040 && code <= 0x30ff) ||
        (code >= 0x31f0 && code <= 0x31ff) ||
        (code >= 0x3400 && code <= 0x4dbf) ||
        (code >= 0x4e00 && code <= 0x9fff) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        code === 0x3005 ||
        code === 0x30fc
      )
    ) {
      return true;
    }
  }
  return false;
}

function isDuplicateOcrHint(candidate: unknown, accepted: unknown[]): boolean {
  const candidateBox = readHintBbox(candidate);
  if (!candidateBox) {
    return false;
  }
  const candidateText = readHintText(candidate);
  for (const existing of accepted) {
    const existingBox = readHintBbox(existing);
    if (!existingBox) {
      continue;
    }
    const iou = bboxIou(candidateBox, existingBox);
    if (iou >= 0.72) {
      return true;
    }
    const existingText = readHintText(existing);
    if (candidateText && existingText && candidateText === existingText && bboxCenterDistance(candidateBox, existingBox) <= 28) {
      return true;
    }
    if (isContainedTextDuplicate(candidateText, existingText) && bboxContainmentRatio(candidateBox, existingBox) >= 0.62) {
      return true;
    }
  }
  return false;
}

function compareOcrHintsForDedupe(a: unknown, b: unknown): number {
  const textDelta = readHintText(b).length - readHintText(a).length;
  if (textDelta !== 0) {
    return textDelta;
  }
  return hintArea(b) - hintArea(a);
}

function compareOcrHintsByReadingOrder(a: unknown, b: unknown): number {
  const aBox = readHintBbox(a);
  const bBox = readHintBbox(b);
  if (!aBox || !bBox) {
    return 0;
  }
  const yDelta = aBox.y - bBox.y;
  if (Math.abs(yDelta) > 12) {
    return yDelta;
  }
  return aBox.x - bBox.x;
}

function hintArea(hint: unknown): number {
  const box = readHintBbox(hint);
  return box ? box.w * box.h : 0;
}

function isContainedTextDuplicate(candidateText: string, existingText: string): boolean {
  const candidate = normalizeTextForDedupe(candidateText);
  const existing = normalizeTextForDedupe(existingText);
  if (candidate.length < 12 || existing.length < candidate.length + 8) {
    return false;
  }
  return existing.includes(candidate);
}

function normalizeTextForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function readHintBbox(hint: unknown): { x: number; y: number; w: number; h: number } | null {
  if (!hint || typeof hint !== "object") {
    return null;
  }
  const bbox = (hint as Record<string, unknown>).bbox;
  if (bbox && typeof bbox === "object") {
    const record = bbox as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const w = Number(record.w);
    const h = Number(record.h);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
      return { x, y, w, h };
    }
  }
  const record = hint as Record<string, unknown>;
  const x1 = Number(record.x1);
  const y1 = Number(record.y1);
  const x2 = Number(record.x2);
  const y2 = Number(record.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  const x = Math.min(x1, x2);
  const y = Math.min(y1, y2);
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

function readHintText(hint: unknown): string {
  if (!hint || typeof hint !== "object") {
    return "";
  }
  const record = hint as Record<string, unknown>;
  for (const key of ["ocrText", "ocr_text", "text", "content", "rec_text", "transcription"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, "").trim();
    }
  }
  return "";
}

function bboxIou(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function bboxContainmentRatio(inner: { x: number; y: number; w: number; h: number }, outer: { x: number; y: number; w: number; h: number }): number {
  const left = Math.max(inner.x, outer.x);
  const top = Math.max(inner.y, outer.y);
  const right = Math.min(inner.x + inner.w, outer.x + outer.w);
  const bottom = Math.min(inner.y + inner.h, outer.y + outer.h);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const innerArea = inner.w * inner.h;
  return innerArea > 0 ? intersection / innerArea : 0;
}

function bboxCenterDistance(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
  const ax = a.x + a.w / 2;
  const ay = a.y + a.h / 2;
  const bx = b.x + b.w / 2;
  const by = b.y + b.h / 2;
  return Math.hypot(ax - bx, ay - by);
}

function rebaseOcrHintToPage(
  hint: unknown,
  tile: { x: number; y: number; width: number; height: number },
  page: MangaPage
): unknown {
  if (!hint || typeof hint !== "object") {
    return hint;
  }
  const record = hint as Record<string, unknown>;
  return {
    ...record,
    ...rebasePixelCornerBbox(record, tile, page),
    bbox: rebaseNormalizedBbox(record.bbox, tile, page),
    ...(record.renderBbox ? { renderBbox: rebaseNormalizedBbox(record.renderBbox, tile, page) } : {}),
    tileOffset: { x: tile.x, y: tile.y }
  };
}

function rebasePixelCornerBbox(
  record: Record<string, unknown>,
  tile: { x: number; y: number; width: number; height: number },
  page: MangaPage
): Partial<Record<"x1" | "y1" | "x2" | "y2", number>> {
  const x1 = Number(record.x1);
  const y1 = Number(record.y1);
  const x2 = Number(record.x2);
  const y2 = Number(record.y2);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return {};
  }

  const pageWidth = Math.max(1, page.width);
  const pageHeight = Math.max(1, page.height);
  const left = clampPixel(tile.x + Math.min(x1, x2), 0, pageWidth);
  const top = clampPixel(tile.y + Math.min(y1, y2), 0, pageHeight);
  const right = clampPixel(tile.x + Math.max(x1, x2), 0, pageWidth);
  const bottom = clampPixel(tile.y + Math.max(y1, y2), 0, pageHeight);
  return {
    x1: left,
    y1: top,
    x2: clampPixel(Math.max(left + 1, right), 0, pageWidth),
    y2: clampPixel(Math.max(top + 1, bottom), 0, pageHeight)
  };
}

function rebaseNormalizedBbox(
  bbox: unknown,
  tile: { x: number; y: number; width: number; height: number },
  page: MangaPage
): unknown {
  if (!bbox || typeof bbox !== "object") {
    return bbox;
  }
  const record = bbox as Record<string, unknown>;
  const x = Number(record.x);
  const y = Number(record.y);
  const w = Number(record.w);
  const h = Number(record.h);
  if (![x, y, w, h].every(Number.isFinite)) {
    return bbox;
  }
  const pageWidth = Math.max(1, page.width);
  const pageHeight = Math.max(1, page.height);
  const absoluteX = tile.x + (x / 1000) * tile.width;
  const absoluteY = tile.y + (y / 1000) * tile.height;
  const absoluteW = (w / 1000) * tile.width;
  const absoluteH = (h / 1000) * tile.height;
  const nextX = Math.min(999, clampNormalized((absoluteX / pageWidth) * 1000));
  const nextY = Math.min(999, clampNormalized((absoluteY / pageHeight) * 1000));
  return {
    ...record,
    x: nextX,
    y: nextY,
    w: Math.max(1, Math.min(1000 - nextX, clampNormalized((absoluteW / pageWidth) * 1000, 1))),
    h: Math.max(1, Math.min(1000 - nextY, clampNormalized((absoluteH / pageHeight) * 1000, 1)))
  };
}

function clampPixel(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNormalized(value: number, min = 0): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.max(min, Math.min(1000, Math.round(value * 1000) / 1000));
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
      updatedAt: formatStoredTimestamp()
    }, null, 2)}\n`,
    "utf8"
  );
}
