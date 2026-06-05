import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAppPaths } from "./appPaths";
import type { LlmVramProjectionRecord } from "../shared/llmVramBudget";
import { formatStoredTimestamp } from "../shared/storedTimestamp";

type ProjectionCacheFile = {
  entries: Record<string, LlmVramProjectionRecord>;
};

let cachedProjectionFile: ProjectionCacheFile | null = null;
let cachePath: string | null = null;

function getCachePath(): string {
  if (!cachePath) {
    cachePath = join(getAppPaths().dataRoot, "llm-vram-projections.json");
  }
  return cachePath;
}

async function loadProjectionCacheFile(): Promise<ProjectionCacheFile> {
  if (cachedProjectionFile) {
    return cachedProjectionFile;
  }
  try {
    const raw = await readFile(getCachePath(), "utf8");
    const parsed = JSON.parse(raw) as ProjectionCacheFile;
    cachedProjectionFile = {
      entries: parsed?.entries && typeof parsed.entries === "object" ? parsed.entries : {}
    };
  } catch {
    cachedProjectionFile = { entries: {} };
  }
  return cachedProjectionFile;
}

export async function loadLlmVramProjection(fingerprint: string): Promise<LlmVramProjectionRecord | null> {
  const cache = await loadProjectionCacheFile();
  return cache.entries[fingerprint] ?? null;
}

export async function saveLlmVramProjection(
  fingerprint: string,
  update: {
    projectedMb?: number | null;
    modelBufferMb?: number | null;
  }
): Promise<void> {
  const cache = await loadProjectionCacheFile();
  const previous = cache.entries[fingerprint] ?? { updatedAt: formatStoredTimestamp() };
  const next: LlmVramProjectionRecord = {
    ...previous,
    updatedAt: formatStoredTimestamp()
  };
  if (typeof update.projectedMb === "number" && update.projectedMb > 0) {
    next.projectedMb = Math.ceil(update.projectedMb);
  }
  if (typeof update.modelBufferMb === "number" && update.modelBufferMb > 0) {
    next.modelBufferMb = Math.ceil(update.modelBufferMb);
  }
  cache.entries[fingerprint] = next;
  const path = getCachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
}

export function resetLlmVramProjectionCacheForTests(): void {
  cachedProjectionFile = null;
  cachePath = null;
}
