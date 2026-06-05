import { describe, expect, it } from "vitest";
import {
  OCR_TEXT_TRANSLATION_CHUNK_SIZE_CODEX,
  OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_ECONOMY,
  OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_FULL,
  resolveOcrTextTranslationChunkSize
} from "../src/main/pipeline/options";

describe("resolveOcrTextTranslationChunkSize", () => {
  it("uses 80 OCR candidates per chunk for Codex", () => {
    expect(
      resolveOcrTextTranslationChunkSize({
        modelProvider: "openai-codex",
        gemmaVramMode: "economy"
      })
    ).toBe(OCR_TEXT_TRANSLATION_CHUNK_SIZE_CODEX);
  });

  it("uses 50 OCR candidates per chunk for local Gemma full VRAM mode", () => {
    expect(
      resolveOcrTextTranslationChunkSize({
        modelProvider: "gemma",
        gemmaVramMode: "full"
      })
    ).toBe(OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_FULL);
  });

  it("uses 20 OCR candidates per chunk for local Gemma economy VRAM mode", () => {
    expect(
      resolveOcrTextTranslationChunkSize({
        modelProvider: "gemma",
        gemmaVramMode: "economy"
      })
    ).toBe(OCR_TEXT_TRANSLATION_CHUNK_SIZE_GEMMA_ECONOMY);
  });
});
