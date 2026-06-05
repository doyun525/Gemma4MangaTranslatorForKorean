import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let cachedRuntimeScript: string | null = null;

export function getBlockTextLayoutRuntimeScript(): string {
  if (cachedRuntimeScript) {
    return cachedRuntimeScript;
  }

  const candidates = [
    join(__dirname, "../shared/blockTextLayout.browser.js"),
    join(__dirname, "../../out/shared/blockTextLayout.browser.js")
  ];
  const runtimePath = candidates.find((candidate) => existsSync(candidate));
  if (!runtimePath) {
    throw new Error(
      "blockTextLayout.browser.js 를 찾지 못했습니다. npm run build 로 블록 텍스트 레이아웃 런타임을 먼저 빌드하세요."
    );
  }

  cachedRuntimeScript = readFileSync(runtimePath, "utf8");
  return cachedRuntimeScript;
}
