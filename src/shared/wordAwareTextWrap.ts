import type { TextMeasurer } from "./textMeasurer";

/** 말줄임·문장부호 등 단어 뒤에 붙는 기호 — 단어 본문과 분리해 줄바꿈할 수 있음 */
const TRAILING_WRAP_SUFFIX_PATTERN = /(?:\.{2,3}|…+|[?!]+|[」』"'’”]+)$/u;

type WordCoreSuffix = {
  core: string;
  suffix: string;
};

function splitWordCoreAndSuffix(word: string): WordCoreSuffix {
  const match = word.match(TRAILING_WRAP_SUFFIX_PATTERN);
  if (!match || match.index === undefined || match.index === 0) {
    return { core: word, suffix: "" };
  }
  return {
    core: word.slice(0, match.index),
    suffix: match[0]
  };
}

/** 따옴표 등 뒤에 붙은 마지막 한글 음절 덩어리 (예: 부활을"이라니 → 이라니) */
function splitCoreHangulTail(core: string): { prefix: string; tail: string } {
  const match = core.match(/([\uAC00-\uD7A3]+)$/u);
  if (!match || match.index === undefined || match[1].length === 0) {
    return { prefix: core, tail: "" };
  }
  return {
    prefix: core.slice(0, match.index),
    tail: match[1]
  };
}

export function wrapTextToWidthWordAware(measurer: TextMeasurer, text: string, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }

    lines.push(...wrapParagraphWordAware(measurer, paragraph, maxWidth));
  }

  return lines.length > 0 ? lines : [text];
}

function wrapParagraphWordAware(measurer: TextMeasurer, paragraph: string, maxWidth: number): string[] {
  const words = paragraph.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (trimmed) {
      lines.push(trimmed);
    }
  };

  for (const word of words) {
    current = placeWordWithOptionalSuffixBreak(measurer, word, maxWidth, lines, current, pushLine);
  }

  if (current) {
    pushLine(current);
  }

  return lines.length > 0 ? lines : [paragraph.trim()];
}

function placeWordWithOptionalSuffixBreak(
  measurer: TextMeasurer,
  word: string,
  maxWidth: number,
  lines: string[],
  current: string,
  pushLine: (line: string) => void
): string {
  const { core, suffix } = splitWordCoreAndSuffix(word);
  const token = suffix ? `${core}${suffix}` : word;

  const appendToLine = (line: string, chunk: string) => (line ? `${line} ${chunk}` : chunk);

  const candidate = appendToLine(current, token);
  if (measurer.measureText(candidate).width <= maxWidth) {
    return candidate;
  }

  pushLine(current);
  current = "";

  if (measurer.measureText(token).width <= maxWidth) {
    return token;
  }

  if (suffix && shouldBreakBeforeTrailingSuffix(measurer, core, suffix, maxWidth)) {
    pushLine(core);
    return suffix;
  }

  if (suffix) {
    const hangulTailBreak = resolveHangulTailSuffixBreak(measurer, core, suffix, maxWidth);
    if (hangulTailBreak) {
      current = placeCorePrefixSegment(measurer, hangulTailBreak.prefix, maxWidth, lines, current, pushLine);
      if (current) {
        pushLine(current);
      }
      pushLine(hangulTailBreak.tail);
      return suffix;
    }
  }

  const coreLines = wrapTokenByCharacters(measurer, core, maxWidth);
  if (suffix) {
    return finishCoreLinesWithSuffix(measurer, core, suffix, maxWidth, lines, coreLines);
  }

  if (coreLines.length > 1) {
    lines.push(...coreLines.slice(0, -1));
  }
  return coreLines[coreLines.length - 1] ?? "";
}

function shouldBreakBeforeTrailingSuffix(measurer: TextMeasurer, core: string, suffix: string, maxWidth: number): boolean {
  if (!core || !suffix) {
    return false;
  }

  const coreFits = measurer.measureText(core).width <= maxWidth;
  const suffixFits = measurer.measureText(suffix).width <= maxWidth;
  const combinedFits = measurer.measureText(`${core}${suffix}`).width <= maxWidth;
  return coreFits && suffixFits && !combinedFits;
}

function shouldSplitHangulTailFromSuffix(
  measurer: TextMeasurer,
  core: string,
  tail: string,
  suffix: string,
  maxWidth: number
): boolean {
  if (!tail || !suffix) {
    return false;
  }

  const tailFits = measurer.measureText(tail).width <= maxWidth;
  const suffixFits = measurer.measureText(suffix).width <= maxWidth;
  if (!tailFits || !suffixFits) {
    return false;
  }

  const coreFits = measurer.measureText(core).width <= maxWidth;
  if (!coreFits) {
    return true;
  }

  return shouldBreakBeforeTrailingSuffix(measurer, tail, suffix, maxWidth);
}

function finishCoreLinesWithSuffix(
  measurer: TextMeasurer,
  core: string,
  suffix: string,
  maxWidth: number,
  lines: string[],
  coreLines: string[]
): string {
  const hangulTail = splitCoreHangulTail(core);
  if (hangulTail.tail && shouldSplitHangulTailFromSuffix(measurer, core, hangulTail.tail, suffix, maxWidth)) {
    if (coreLines.length > 1) {
      lines.push(...coreLines.slice(0, -1));
      const lastCore = coreLines[coreLines.length - 1] ?? "";
      if (lastCore && lastCore !== hangulTail.tail && !hangulTail.tail.endsWith(lastCore)) {
        appendLine(lines, lastCore);
      }
    } else if (coreLines.length === 1 && coreLines[0] !== hangulTail.tail) {
      appendLine(lines, coreLines[0]);
    }
    appendLine(lines, hangulTail.tail);
    return suffix;
  }

  if (coreLines.length === 0) {
    return suffix;
  }

  if (coreLines.length === 1) {
    if (shouldBreakBeforeTrailingSuffix(measurer, core, suffix, maxWidth)) {
      appendLine(lines, core);
      return suffix;
    }
    const combined = `${coreLines[0]}${suffix}`;
    if (measurer.measureText(combined).width <= maxWidth) {
      return combined;
    }
    appendLine(lines, coreLines[0]);
    return suffix;
  }

  const lastCore = coreLines[coreLines.length - 1] ?? "";
  const hangulTailAtEnd = splitCoreHangulTail(core);
  const tailBrokenBySyllables =
    hangulTailAtEnd.tail &&
    lastCore &&
    lastCore !== hangulTailAtEnd.tail &&
    hangulTailAtEnd.tail.startsWith(lastCore);

  if (!tailBrokenBySyllables) {
    const withSuffix = `${lastCore}${suffix}`;
    if (measurer.measureText(withSuffix).width <= maxWidth) {
      lines.push(...coreLines.slice(0, -1));
      return withSuffix;
    }
  }

  if (shouldBreakBeforeTrailingSuffix(measurer, core, suffix, maxWidth)) {
    lines.push(...coreLines);
    return suffix;
  }

  lines.push(...coreLines.slice(0, -1));
  appendLine(lines, lastCore);
  return suffix;
}

function resolveHangulTailSuffixBreak(
  measurer: TextMeasurer,
  core: string,
  suffix: string,
  maxWidth: number
): { prefix: string; tail: string } | null {
  const { prefix, tail } = splitCoreHangulTail(core);
  if (!tail || tail === core) {
    return null;
  }
  if (!shouldSplitHangulTailFromSuffix(measurer, core, tail, suffix, maxWidth)) {
    return null;
  }
  return { prefix, tail };
}

function placeCorePrefixSegment(
  measurer: TextMeasurer,
  prefix: string,
  maxWidth: number,
  lines: string[],
  current: string,
  pushLine: (line: string) => void
): string {
  if (!prefix) {
    return current;
  }

  const candidate = current ? `${current} ${prefix}` : prefix;
  if (measurer.measureText(candidate).width <= maxWidth) {
    return candidate;
  }

  pushLine(current);
  current = "";

  if (measurer.measureText(prefix).width <= maxWidth) {
    return prefix;
  }

  const prefixLines = wrapTokenByCharacters(measurer, prefix, maxWidth);
  if (prefixLines.length > 1) {
    lines.push(...prefixLines.slice(0, -1));
  }
  return prefixLines[prefixLines.length - 1] ?? "";
}

function appendLine(lines: string[], line: string) {
  const trimmed = line.trim();
  if (trimmed) {
    lines.push(trimmed);
  }
}

function wrapTokenByCharacters(measurer: TextMeasurer, token: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";

  for (const char of [...token]) {
    const candidate = `${current}${char}`;
    if (!current || measurer.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = char;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [token];
}
