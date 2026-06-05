import { describe, expect, it } from "vitest";

const { getOverlayPrompt } = require("../src/main/runtime/simple-page-prompts.cjs");

const baseOptions = {
  translationMode: "ocr-text",
  includeSoundEffects: false,
  imageWidth: 1200,
  imageHeight: 1800
};

const variants = [{ role: "original", width: 1200, height: 1800 }];

function buildHints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    label: "ocr_textbox",
    x1: 10 + index,
    y1: 20,
    x2: 100,
    y2: 80,
    score: 0.9,
    ocrText: `テスト${index}`
  }));
}

describe("ocr-text overlay prompts", () => {
  it("uses a compact prompt without image geometry sections", () => {
    const prompt = getOverlayPrompt({ ...baseOptions, ocrBboxHints: buildHints(3) }, variants);

    expect(prompt).toContain("No image is included in this request");
    expect(prompt).toContain("# Candidate geometry");
    expect(prompt).toContain("OCR bbox candidates");
    expect(prompt).not.toContain("# Geometry");
    expect(prompt).not.toContain("# Segmentation");
    expect(prompt).not.toContain("# Coordinate calibration");
    expect(prompt).not.toContain("Image 1 is the coordinate-authority");
    expect(prompt).not.toContain("Scan the entire page before writing records");
    expect(prompt).not.toContain("Estimate every value from the actual glyphs in Image 1");
  });

  it("is materially shorter than the image-mode prompt for the same OCR hints", () => {
    const hints = buildHints(80);
    const ocrTextPrompt = getOverlayPrompt({ ...baseOptions, ocrBboxHints: hints }, variants);
    const imagePrompt = getOverlayPrompt(
      { translationMode: "image", includeSoundEffects: false, imageWidth: 1200, imageHeight: 1800, ocrBboxHints: hints },
      variants
    );

    expect(ocrTextPrompt.length).toBeLessThan(imagePrompt.length * 0.75);
    expect(ocrTextPrompt.length).toBeLessThan(15000);
  });

  it("keeps image-mode prompts unchanged", () => {
    const prompt = getOverlayPrompt(
      { translationMode: "image", includeSoundEffects: false, imageWidth: 1200, imageHeight: 1800 },
      variants
    );

    expect(prompt).toContain("# Geometry");
    expect(prompt).toContain("# Segmentation");
    expect(prompt).toContain("Image 1 is the coordinate-authority full page");
  });

  it("uses multilingual source-language guidance for 26B models", () => {
    const prompt = getOverlayPrompt(
      {
        modelRepo: "HauhauCS/Gemma4-26B-A4B-Uncensored",
        modelFile: "gemma-4-26b-a4b-q4_k_m.gguf",
        translationMode: "image",
        includeSoundEffects: false,
        imageWidth: 1200,
        imageHeight: 1800,
        ocrBboxHints: buildHints(2)
      },
      variants
    );

    expect(prompt).toContain("Chinese");
    expect(prompt).toContain("source-language text area");
    expect(prompt).not.toContain("physical Japanese text area");
    expect(prompt).not.toContain("Japanese or English text group");
  });
});
