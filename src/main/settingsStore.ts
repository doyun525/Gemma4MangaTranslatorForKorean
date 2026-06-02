import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettings } from "../shared/types";
import { getAppPaths, type AppPaths } from "./appPaths";
import { normalizeAppSettings, parseStoredAppSettings, resolveDefaultAppSettings } from "./appSettings";
import { detectBestGpuInfo } from "./gpuInfo";
import { writeJsonFile } from "./libraryStore/storage";

export async function getAppSettings(paths = getAppPaths(), env: NodeJS.ProcessEnv = process.env): Promise<AppSettings> {
  const defaults = resolveDefaultAppSettings(env, await detectBestGpuInfo());

  try {
    const rawText = await readFile(paths.settingsPath, "utf8");
    const parsed = parseStoredAppSettings(rawText, defaults);
    if (shouldPersistNormalizedSettings(rawText, parsed)) {
      await persistAppSettings(parsed, paths);
    }
    return parsed;
  } catch (error) {
    if (isMissingFileError(error)) {
      const sharedSettings = await readSharedWindowsSettingsIfAvailable(paths, defaults);
      if (sharedSettings) {
        return sharedSettings;
      }
      return defaults;
    }
    throw error;
  }
}

export async function saveAppSettings(
  settings: AppSettings,
  paths = getAppPaths(),
  env: NodeJS.ProcessEnv = process.env
): Promise<AppSettings> {
  const defaults = resolveDefaultAppSettings(env, await detectBestGpuInfo());
  const existing = await readExistingSettings(paths, defaults);
  const normalized = normalizeAppSettings(mergeSettingsForSave(settings, existing), defaults);
  await persistAppSettings(normalized, paths);
  return normalized;
}

export async function resetAppSettings(paths = getAppPaths(), env: NodeJS.ProcessEnv = process.env): Promise<AppSettings> {
  const defaults = resolveDefaultAppSettings(env, await detectBestGpuInfo());
  await persistAppSettings(defaults, paths);
  return defaults;
}

async function persistAppSettings(settings: AppSettings, paths: AppPaths): Promise<void> {
  await writeJsonFile(paths.settingsPath, settings);
}

async function readExistingSettings(paths: AppPaths, defaults: AppSettings): Promise<AppSettings | null> {
  try {
    return parseStoredAppSettings(await readFile(paths.settingsPath, "utf8"), defaults);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}

function mergeSettingsForSave(settings: AppSettings, existing: AppSettings | null): AppSettings {
  if (!existing) {
    return settings;
  }

  const rawSettings = settings as unknown as Record<string, unknown>;
  const rawGemma = asRecord(rawSettings.gemma);
  const rawOcr = asRecord(rawSettings.ocr);
  const rawStorage = asRecord(rawSettings.storage);
  const merged: AppSettings = {
    ...settings,
    gemma: {
      ...settings.gemma
    },
    ocr: {
      ...settings.ocr
    },
    ...(settings.storage ? { storage: { ...settings.storage } } : {})
  };

  if (!hasOwn(rawGemma, "customModelPresets") && existing.gemma.customModelPresets?.length) {
    merged.gemma.customModelPresets = existing.gemma.customModelPresets;
  }
  if (!hasOwn(rawOcr, "engine")) {
    merged.ocr.engine = existing.ocr.engine;
  }
  if (!hasOwn(rawOcr, "gpuCudaTag") && existing.ocr.gpuCudaTag) {
    merged.ocr.gpuCudaTag = existing.ocr.gpuCudaTag;
  }
  if (!hasOwn(rawStorage, "modelCacheDir") && existing.storage?.modelCacheDir) {
    merged.storage = {
      ...merged.storage,
      modelCacheDir: existing.storage.modelCacheDir
    };
  }
  return merged;
}

function shouldPersistNormalizedSettings(rawText: string, normalized: AppSettings): boolean {
  try {
    return JSON.stringify(JSON.parse(rawText)) !== JSON.stringify(normalized);
  } catch {
    return false;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function hasOwn(record: Record<string, unknown> | null, key: string): boolean {
  return !!record && Object.prototype.hasOwnProperty.call(record, key);
}

async function readSharedWindowsSettingsIfAvailable(paths: AppPaths, defaults: AppSettings): Promise<AppSettings | null> {
  if (paths.isPackaged || process.platform !== "win32") {
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA?.trim();
  if (!localAppData) {
    return null;
  }

  const sharedSettingsPath = join(localAppData, "manga-gemma-translator", "settings.json");
  if (sharedSettingsPath === paths.settingsPath) {
    return null;
  }

  try {
    return parseStoredAppSettings(await readFile(sharedSettingsPath, "utf8"), defaults);
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }
    throw error;
  }
}
