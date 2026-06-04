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
  private endpointAbortController: AbortController | null = null;
  private ocrAbortController: AbortController | null = null;
  private delayedStartTimer: NodeJS.Timeout | null = null;
  private status: WarmupStatus = "idle";
  private startedAt: string | undefined;
  private readyAt: string | undefined;
  private error: string | undefined;
  private endpointReady = false;
  private ocrReady = false;
  private generation = 0;

  constructor(private readonly appPaths: AppPaths) {}

  startDelayed(reason: string, delayMs = 5000): TranslationWarmupSnapshot {
    if (this.status === "warming" || this.status === "ready") {
      return this.getSnapshot();
    }
    if (this.delayedStartTimer) {
      return this.getSnapshot();
    }
    this.status = "idle";
    logInfo("Translation warmup scheduled", { reason, delayMs });
    this.delayedStartTimer = setTimeout(() => {
      this.delayedStartTimer = null;
      this.start(reason);
    }, Math.max(0, delayMs));
    this.delayedStartTimer.unref?.();
    return this.getSnapshot();
  }

  start(reason: string): TranslationWarmupSnapshot {
    if (this.status === "warming" || this.status === "ready") {
      return this.getSnapshot();
    }
    if (this.delayedStartTimer) {
      clearTimeout(this.delayedStartTimer);
      this.delayedStartTimer = null;
    }

    this.status = "warming";
    this.startedAt = new Date().toISOString();
    this.readyAt = undefined;
    this.error = undefined;
    this.endpointReady = false;
    this.ocrReady = false;
    const generation = ++this.generation;

    const jobId = `warmup-${randomUUID()}`;
    const runDir = join(this.appPaths.dataRoot, "runs", "warmup");
    this.endpointPromise = this.startEndpointWarmup(jobId, runDir, reason, generation);
    this.ocrPromise = this.startOcrWarmup(jobId, runDir, reason, generation);
    void Promise.allSettled([this.endpointPromise, this.ocrPromise]).then((results) => {
      if (this.generation !== generation) {
        return;
      }
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
    this.generation += 1;
    if (this.delayedStartTimer) {
      clearTimeout(this.delayedStartTimer);
      this.delayedStartTimer = null;
    }
    this.status = "stopped";
    this.readyAt = undefined;
    this.error = undefined;
    this.endpointAbortController?.abort();
    this.ocrAbortController?.abort();
    this.endpointAbortController = null;
    this.ocrAbortController = null;
    const endpoint = this.endpoint;
    this.endpoint = null;
    this.endpointPromise = null;
    this.ocrPromise = null;
    this.endpointReady = false;
    this.ocrReady = false;
    try {
      await this.getRuntime().simplePage.stopOcrWorker?.();
    } catch (error) {
      logError("Failed to stop OCR warmup worker", error);
    }
    if (endpoint) {
      try {
        await stopModelEndpoint(this.getRuntime(), endpoint);
      } catch (error) {
        logError("Failed to stop translation warmup endpoint", error);
      }
    }
  }

  async restartDelayed(reason: string, delayMs = 1500): Promise<TranslationWarmupSnapshot> {
    await this.stop();
    return this.startDelayed(reason, delayMs);
  }

  async stopEndpoint(reason = "gpu-vram-guard"): Promise<void> {
    if (this.delayedStartTimer) {
      clearTimeout(this.delayedStartTimer);
      this.delayedStartTimer = null;
    }
    if (this.endpointPromise && !this.endpointReady) {
      logInfo("Stopping full warmup because endpoint is still loading", { reason });
      this.endpointAbortController?.abort();
      await this.stop();
      return;
    }

    this.endpointAbortController?.abort();
    this.endpointAbortController = null;
    const endpoint = this.endpoint;
    this.endpoint = null;
    this.endpointPromise = null;
    this.endpointReady = false;
    if (this.status === "ready") {
      this.status = this.ocrReady ? "warming" : "stopped";
    }
    if (!endpoint) {
      return;
    }
    logInfo("Stopping warmed translation endpoint for GPU VRAM", { reason });
    try {
      await stopModelEndpoint(this.getRuntime(), endpoint);
    } catch (error) {
      logError("Failed to stop warmed translation endpoint", error);
    }
  }

  async stopOcr(reason = "gpu-vram-guard"): Promise<void> {
    this.ocrAbortController?.abort();
    this.ocrAbortController = null;
    this.ocrPromise = null;
    this.ocrReady = false;
    if (this.status === "ready") {
      this.status = this.endpointReady ? "warming" : "stopped";
    }
    logInfo("Stopping warmed OCR worker for GPU VRAM", { reason });
    try {
      await this.getRuntime().simplePage.stopOcrWorker?.();
    } catch (error) {
      logError("Failed to stop warmed OCR worker", error);
    }
  }

  private async startEndpointWarmup(jobId: string, runDir: string, reason: string, generation: number): Promise<void> {
    const settings = await getAppSettings(this.appPaths);
    if (this.generation !== generation) {
      return;
    }
    if (settings.modelProvider !== "gemma") {
      logInfo("Translation endpoint warmup skipped for non-local provider", { reason, provider: settings.modelProvider });
      this.endpointReady = true;
      return;
    }
    await mkdir(runDir, { recursive: true });
    const options = buildBaseOptions(jobId, runDir, settings, this.appPaths);
    const abortController = new AbortController();
    this.endpointAbortController = abortController;
    options.label = `warmup-${jobId}`;
    options.imagePath = "";
    options.outputDir = runDir;
    options.abortSignal = abortController.signal;
    options.onProgress = (progress) => {
      logInfo("Translation endpoint warmup progress", {
        reason,
        phase: progress.phase,
        progressText: progress.progressText,
        detail: progress.detail,
        installLogLine: progress.installLogLine
      });
    };
    const endpoint = await startModelEndpoint(this.getRuntime(), options);
    if (this.generation !== generation) {
      await stopModelEndpoint(this.getRuntime(), endpoint).catch((error) => {
        logError("Failed to stop stale translation warmup endpoint", error);
      });
      return;
    }
    this.endpoint = endpoint;
    if (this.endpointAbortController === abortController) {
      this.endpointAbortController = null;
    }
    this.endpointReady = true;
  }

  private async startOcrWarmup(jobId: string, runDir: string, reason: string, generation: number): Promise<void> {
    const runtime = this.getRuntime();
    if (!runtime.simplePage.warmupOcrRuntime) {
      this.ocrReady = true;
      return;
    }
    const settings = await getAppSettings(this.appPaths);
    if (this.generation !== generation) {
      return;
    }
    await mkdir(runDir, { recursive: true });
    const options = buildBaseOptions(jobId, runDir, settings, this.appPaths);
    const abortController = new AbortController();
    this.ocrAbortController = abortController;
    options.label = `ocr-warmup-${jobId}`;
    options.imagePath = "";
    options.outputDir = runDir;
    options.abortSignal = abortController.signal;
    options.onProgress = (progress) => {
      logInfo("OCR warmup progress", {
        reason,
        phase: progress.phase,
        progressText: progress.progressText,
        detail: progress.detail,
        installLogLine: progress.installLogLine
      });
    };
    const result = await runtime.simplePage.warmupOcrRuntime(options);
    if (this.generation !== generation) {
      await runtime.simplePage.stopOcrWorker?.().catch((error) => {
        logError("Failed to stop stale OCR warmup worker", error);
      });
      return;
    }
    if (this.ocrAbortController === abortController) {
      this.ocrAbortController = null;
    }
    this.ocrReady = true;
    logInfo("OCR warmup ready", {
      reason,
      ...(result && typeof result === "object" ? (result as Record<string, unknown>) : {})
    });
  }

  private getRuntime(): RuntimeModules {
    if (!this.runtime) {
      this.runtime = loadRuntimeModules();
    }
    return this.runtime;
  }
}
