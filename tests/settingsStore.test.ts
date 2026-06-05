import { createDefaultGemmaRuntimeOverrides } from "../src/shared/gemmaRuntimeSettings";
import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

describe("settings store", () => {
  afterEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        await rm(dir, { recursive: true, force: true });
      }
    }
  });

  it("backs up malformed settings and returns defaults", async () => {
    const rootDir = await createTempDir();
    const settingsPath = join(rootDir, "settings.json");
    await writeFile(settingsPath, "{ malformed", "utf8");
    const { getAppSettings } = await loadSettingsStore(rootDir);

    const settings = await getAppSettings();

    expect(settings.modelProvider).toBe("openai-codex");
    const files = await readdir(rootDir);
    expect(files.some((name) => /^settings\.json\.corrupt-.*\.bak$/.test(name))).toBe(true);
    expect(existsSync(settingsPath)).toBe(true);
  });

  it("writes default gemma.runtimeOverrides when settings are loaded and saved", async () => {
    const rootDir = await createTempDir();
    const { getAppSettings, saveAppSettings } = await loadSettingsStore(rootDir);
    const existing = await getAppSettings();

    expect(existing.gemma.runtimeOverrides?.full?.ctx).toBe(8192);
    expect(existing.gemma.runtimeOverrides?.economy?.gpuLayers).toBe("fit");

    const saved = await saveAppSettings({
      ...existing,
      maxTokens: 8400
    });

    expect(saved.maxTokens).toBe(8400);
    expect(saved.gemma.runtimeOverrides?.full?.ctx).toBe(8192);

    const persisted = JSON.parse(await readFile(join(rootDir, "settings.json"), "utf8"));
    expect(persisted.gemma.runtimeOverrides.full.ctx).toBe(8192);
    expect(persisted.gemma.runtimeOverrides.economy.gpuLayers).toBe("fit");
  });

  it("keeps gemma vramMode and runtimeOverrides when the save payload omits them", async () => {
    const rootDir = await createTempDir();
    const settingsPath = join(rootDir, "settings.json");
    await writeFile(
      settingsPath,
      JSON.stringify(
        {
          modelProvider: "gemma",
          gemma: {
            modelSource: "huggingface",
            modelRepo: "custom/repo",
            modelFile: "custom.gguf",
            vramMode: "full",
            runtimeOverrides: {
              economy: { ctx: 4096 },
              full: { batch: 2048 }
            }
          },
          codex: { model: "gpt-5.5", reasoningEffort: "low", oauthPort: 10531 },
          ocr: { device: "gpu", engine: "paddleocr-vl", batchSize: 4 },
          translation: {
            mode: "image",
            includeSoundEffects: true,
            ocrBboxExpandXRatio: 0.2,
            ocrBboxExpandYRatio: 0.1,
            textOutlineWidthPx: 1.4
          },
          maxTokens: 12000
        },
        null,
        2
      ),
      "utf8"
    );

    const { getAppSettings, saveAppSettings } = await loadSettingsStore(rootDir);
    const existing = await getAppSettings();
    const saved = await saveAppSettings({
      ...existing,
      gemma: {
        modelSource: "huggingface",
        modelRepo: "custom/repo",
        modelFile: "custom.gguf"
      } as typeof existing.gemma,
      maxTokens: 9000
    });

    const baseOverrides = createDefaultGemmaRuntimeOverrides();

    expect(saved.gemma.vramMode).toBe("full");
    expect(saved.gemma.runtimeOverrides).toEqual({
      economy: { ...baseOverrides.economy, ctx: 4096 },
      full: { ...baseOverrides.full, batch: 2048 }
    });
    expect(saved.maxTokens).toBe(9000);

    const persisted = JSON.parse(await readFile(settingsPath, "utf8"));
    expect(persisted.gemma.vramMode).toBe("full");
    expect(persisted.gemma.runtimeOverrides).toEqual({
      economy: { ...baseOverrides.economy, ctx: 4096 },
      full: { ...baseOverrides.full, batch: 2048 }
    });
  });
});

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "manga-settings-store-"));
  tempDirs.push(dir);
  return dir;
}

async function loadSettingsStore(rootDir: string): Promise<typeof import("../src/main/settingsStore")> {
  vi.resetModules();
  vi.doMock("../src/main/appPaths", () => ({
    getAppPaths: () => ({
      isPackaged: false,
      repoRoot: rootDir,
      executableDir: rootDir,
      resourcesDir: rootDir,
      dataRoot: rootDir,
      settingsPath: join(rootDir, "settings.json"),
      libraryDir: join(rootDir, "library"),
      fontsDir: join(rootDir, "fonts"),
      logsDir: join(rootDir, "logs"),
      logFile: join(rootDir, "logs", "app.log"),
      runtimeDir: join(rootDir, "runtime"),
      toolsDir: join(rootDir, "tools"),
      ocrRuntimeDir: join(rootDir, "ocr-runtime"),
      llamaRuntimeDir: join(rootDir, "tools", "llama"),
      llamaServerPath: join(rootDir, "tools", "llama", "llama-server.exe")
    })
  }));
  vi.doMock("../src/main/gpuInfo", () => ({
    detectBestGpuInfo: async () => null
  }));
  return import("../src/main/settingsStore");
}
