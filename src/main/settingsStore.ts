import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AppSettings } from "../shared/types";
import { getAppPaths, type AppPaths } from "./appPaths";
import { normalizeAppSettings, parseStoredAppSettings, resolveDefaultAppSettings } from "./appSettings";
import { detectBestGpuInfo } from "./gpuInfo";

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
  const normalized = normalizeAppSettings(settings, resolveDefaultAppSettings(env, await detectBestGpuInfo()));
  await persistAppSettings(normalized, paths);
  return normalized;
}

export async function resetAppSettings(paths = getAppPaths(), env: NodeJS.ProcessEnv = process.env): Promise<AppSettings> {
  const defaults = resolveDefaultAppSettings(env, await detectBestGpuInfo());
  await persistAppSettings(defaults, paths);
  return defaults;
}

async function persistAppSettings(settings: AppSettings, paths: AppPaths): Promise<void> {
  await writeFile(paths.settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
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
