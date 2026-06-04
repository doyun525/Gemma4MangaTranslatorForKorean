import type { TranslationBlock } from "../../../shared/types";
import { formatBlockTextWithWordAwareLineBreaks, resolveBlockTextLayout, type ViewportSize } from "./overlayLayout";

export const DEFAULT_SMART_KO_LINE_BREAKS = true;
export const DEFAULT_SMART_KO_LINE_BREAKS_PERSIST = false;

export function isSmartKoLineBreaksEnabled(block: Pick<TranslationBlock, "smartKoLineBreaks" | "renderDirection">): boolean {
  if (block.smartKoLineBreaks === false) {
    return false;
  }
  return block.renderDirection === "horizontal";
}

export function shouldPersistSmartKoLineBreaks(
  block: Pick<TranslationBlock, "smartKoLineBreaks" | "smartKoLineBreaksPersist" | "renderDirection">
): boolean {
  return isSmartKoLineBreaksEnabled(block) && block.smartKoLineBreaksPersist === true;
}

export function resolveBlockDisplayText(
  block: TranslationBlock,
  rawText: string,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): string {
  if (!isSmartKoLineBreaksEnabled(block) || !rawText.trim()) {
    return rawText;
  }

  const layout = resolveBlockTextLayout(block, rawText, pageSize, stageSize);
  return formatBlockTextWithWordAwareLineBreaks(block, rawText, layout.fitInnerWidth, layout.fontSizePx);
}

export function formatPersistedSmartKoLineBreaks(
  block: TranslationBlock,
  rawText: string,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): string {
  if (!shouldPersistSmartKoLineBreaks(block) || !rawText.trim()) {
    return rawText;
  }

  const layout = resolveBlockTextLayout(block, rawText, pageSize, stageSize);
  return formatBlockTextWithWordAwareLineBreaks(block, rawText, layout.fitInnerWidth, layout.fontSizePx);
}

export function buildSmartKoLineBreakPersistPatch(
  block: TranslationBlock,
  pageSize: ViewportSize,
  stageSize: ViewportSize
): Partial<TranslationBlock> | null {
  if (!shouldPersistSmartKoLineBreaks(block)) {
    return null;
  }

  const nextText = formatPersistedSmartKoLineBreaks(block, block.translatedText, pageSize, stageSize);
  if (nextText === block.translatedText) {
    return null;
  }

  return { translatedText: nextText };
}
