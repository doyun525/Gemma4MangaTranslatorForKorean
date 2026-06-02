import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { AppPaths } from "./appPaths";
import { getAppSettings } from "./settingsStore";
import { buildBaseOptions } from "./pipeline/options";
import { loadRuntimeModules, startModelEndpoint, stopModelEndpoint } from "./pipeline/runtimeModules";
import type { ModelEndpointHandle, RuntimeModules } from "./pipeline/types";
import { logError, logInfo, logWarn } from "./logger";

type WarmupStatus = "idle" | "warming" | "ready" | "failed" | "stopped";

export type TranslationWarmupSnapshot = {
  status: WarmupStatus;
  startedAt?: string;
  readyAt?: string;
  error?: string;
  endpointReady: boolean;
  ocrReady: boolean;
};

export class TranslationWarmupManager {
  private runtime: RuntimeModules | null = null;
  private endpoint: ModelEndpointHandle | null = null;
  private endpointPromise: Promise<void> | null = null;
  private ocrPromise: Promise<void> | null = null;
  private status: WarmupStatus = "idle";
  private startedAt: string | undefined;
  private readyAt: string | undefined;
  private error: string | undefined;
  private endpointReady = false;
  private ocrReady = false;

  constructor(private readonly appPaths: AppPaths) {}

  start(reason: string): TranslationWarmupSnapshot {
    if (this.status === "warming" || this.status === "ready") {
      return this.getSnapshot();
    }

    this.status = "warming";
    this.startedAt = new Date().toISOString();
    this.readyAt = undefined;
    this.error = undefined;
    this.endpointReady = false;
    this.ocrReady = false;

    const jobId = `warmup-${randomUUID()}`;
    const runDir = join(this.appPaths.dataRoot, "runs", "warmup");
    this.endpointPromise = this.startEndpointWarmup(jobId, runDir, reason);
    this.ocrPromise = this.startOcrWarmup(jobId, runDir, reason);
    void Promise.allSettled([this.endpointPromise, this.ocrPromise]).then((results) => {
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") {
        this.status = "failed";
        this.error = rejected.reason instanceof Error ? rejected.reason.message : String(rejected.reason);
        logWarn("Translation warmup completed with failure", { reason, error: rejected.reason });
        return;
      }
      this.status = "ready";
      this.readyAt = new Date().toISOString();
      logInfo("Translation warmup ready", { reason, endpointReady: this.endpointReady, ocrReady: this.ocrReady });
    });

    return this.getSnapshot();
  }

  async waitForEndpointReady(): Promise<void> {
    if (!this.endpointPromise) {
      return;
    }
    await this.endpointPromise.catch((error) => {
      logWarn("Ignoring failed endpoint warmup before translation job", { error });
    });
  }

  async waitForReady(): Promise<void> {
    await Promise.all([
      this.endpointPromise?.catch((error) => {
        logWarn("Ignoring failed endpoint warmup before translation job", { error });
      }),
      this.ocrPromise?.catch((error) => {
        logWarn("Ignoring failed OCR warmup before translation job", { error });
      })
    ]);
  }

  getSnapshot(): TranslationWarmupSnapshot {
    return {
      status: this.status,
      ...(this.startedAt ? { startedAt: this.startedAt } : {}),
      ...(this.readyAt ? { readyAt: this.readyAt } : {}),
      ...(this.error ? { error: this.error } : {}),
      endpointReady: this.endpointReady,
      ocrReady: this.ocrReady
    };
  }

  async stop(): Promise<void> {
    this.status = "stopped";
    this.readyAt = undefined;
    this.error = undefined;
    const endpoint = this.endpoint;
    this.endpoint = null;
    this.endpointPromise = null;
    this.ocrPromise = null;
    this.endpointReady = false;
    this.ocrReady = false;
    if (endpoint) {
      try {
        await stopModelEndpoint(this.getRuntime(), endpoint);
      } catch (error) {
        logError("Failed to stop translation warmup endpoint", error);
      }
    }
  }

  private async startEndpointWarmup(jobId: string, runDir: string, reason: string): Promise<void> {
    const settings = await getAppSettings(this.appPaths);
    if (settings.modelProvider !== "gemma") {
      logInfo("Translation endpoint warmup skipped for non-local provider", { reason, provider: settings.modelProvider });
      this.endpointReady = true;
      return;
    }
    await mkdir(runDir, { recursive: true });
    const options = buildBaseOptions(jobId, runDir, settings, this.appPaths);
    options.label = `warmup-${jobId}`;
    options.imagePath = "";
    options.outputDir = runDir;
    options.onProgress = (progress) => {
      logInfo("Translation endpoint warmup progress", {
        reason,
        phase: progress.phase,
        progressText: progress.progressText,
        detail: progress.detail,
        installLogLine: progress.installLogLine
      });
    };
    this.endpoint = await startModelEndpoint(this.getRuntime(), options);
    this.endpointReady = true;
  }

  private async startOcrWarmup(jobId: string, runDir: string, reason: string): Promise<void> {
    const runtime = this.getRuntime();
    if (!runtime.simplePage.warmupOcrRuntime) {
      this.ocrReady = true;
      return;
    }
    const settings = await getAppSettings(this.appPaths);
    await mkdir(runDir, { recursive: true });
    const options = buildBaseOptions(jobId, runDir, settings, this.appPaths);
    options.label = `ocr-warmup-${jobId}`;
    options.imagePath = "";
    options.outputDir = runDir;
    options.onProgress = (progress) => {
      logInfo("OCR warmup progress", {
        reason,
        phase: progress.phase,
        progressText: progress.progressText,
        detail: progress.detail,
        installLogLine: progress.installLogLine
      });
    };
    await runtime.simplePage.warmupOcrRuntime(options);
    this.ocrReady = true;
  }

  private getRuntime(): RuntimeModules {
    if (!this.runtime) {
      this.runtime = loadRuntimeModules();
    }
    return this.runtime;
  }
}
