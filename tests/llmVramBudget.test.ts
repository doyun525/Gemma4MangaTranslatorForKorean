import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLM_VRAM_ESTIMATE_MB,
  LLM_MODEL_BUFFER_OVERHEAD_MB,
  buildLlmVramFingerprint,
  parseLlmCudaModelBufferMbFromLogLine,
  parseLlmProjectedVramMbFromLogLine,
  resolveEstimatedLlmVramMb,
  resolveRequiredFreeVramMb,
  shouldReleaseOcrBeforeLlm
} from "../src/shared/llmVramBudget";

describe("llmVramBudget", () => {
  it("parses projected and model buffer lines from llama logs", () => {
    expect(parseLlmProjectedVramMbFromLogLine("llama_params_fit: projected 12863 MiB vs free 15031 MiB")).toBe(12863);
    expect(parseLlmCudaModelBufferMbFromLogLine("load_tensors: CUDA0 model buffer size = 11641.15 MiB")).toBe(11642);
    expect(parseLlmProjectedVramMbFromLogLine("offloaded 31/31 layers to GPU")).toBeNull();
  });

  it("builds a stable fingerprint from llm launch settings", () => {
    const fingerprint = buildLlmVramFingerprint({
      modelRepo: "repo",
      modelFile: "model.gguf",
      gemmaVramMode: "economy",
      ctx: 8192,
      batch: 1024,
      ubatch: 1024,
      fitTargetMb: 2048,
      kvOffload: true,
      mmprojOffload: true,
      useDraft: false,
      gpuLayers: "fit"
    });
    expect(fingerprint).toContain("repo|model.gguf|economy|8192|1024|1024|2048|kv1|mm1|draft0|fit");
  });

  it("prefers cached projected VRAM and falls back to model buffer overhead", () => {
    expect(resolveEstimatedLlmVramMb({ cachedProjectedMb: 12863 })).toBe(12863);
    expect(resolveEstimatedLlmVramMb({ cachedModelBufferMb: 11641 })).toBe(11641 + LLM_MODEL_BUFFER_OVERHEAD_MB);
    expect(resolveEstimatedLlmVramMb({})).toBe(DEFAULT_LLM_VRAM_ESTIMATE_MB);
  });

  it("releases OCR when free VRAM is below estimated llm budget", () => {
    const snapshot = { freeMb: 9920, usedMb: 6126, totalMb: 16376 };
    expect(shouldReleaseOcrBeforeLlm(snapshot, 12863, 512)).toBe(true);
    expect(shouldReleaseOcrBeforeLlm(snapshot, 9000, 512)).toBe(false);
    expect(resolveRequiredFreeVramMb(12863, 512, 14000)).toBe(14000);
  });
});
