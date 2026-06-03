import { once } from "node:events";
import { createWriteStream, existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { AdmZip } from "../libraryStore/zipSafety";

export const FLUX_RUNTIME_EXECUTABLE = "mgt-flux-klein.exe";
export const FLUX_MODEL_REPO = "unsloth/FLUX.2-klein-4B-GGUF";
export const FLUX_MODEL_FILE = "flux-2-klein-4b-Q4_K_M.gguf";
export const FLUX_VAE_REPO = "black-forest-labs/FLUX.2-small-decoder";
export const FLUX_VAE_FILE = "diffusion_pytorch_model.safetensors";
export const FLUX_CUDNN_ZIP_FILE = "cudnn-windows-x86_64-9.10.2.21_cuda12-archive.zip";
export const FLUX_CUDNN_URL = `https://developer.download.nvidia.com/compute/cudnn/redist/cudnn/windows-x86_64/${FLUX_CUDNN_ZIP_FILE}`;

export type FluxAssetProgress = {
  progressText: string;
  detail?: string;
  progressMode?: "determinate" | "indeterminate" | "log-only";
  progressPercent?: number;
  progressBytes?: number;
  progressTotalBytes?: number;
  installLogLine?: string;
};

type RemoteFileMetadata = {
  url: string;
  bytes: number;
  downloadedAt: string;
};

export async function ensureMgtFluxKleinRuntime(options: {
  runtimeDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: FluxAssetProgress) => void;
}): Promise<string> {
  const existing = findFirstExecutable([
    process.env.MGT_FLUX_KLEIN_EXE,
    findExecutable(options.runtimeDir, [FLUX_RUNTIME_EXECUTABLE]),
    process.resourcesPath ? join(process.resourcesPath, "tools", "mgt-flux-klein", FLUX_RUNTIME_EXECUTABLE) : undefined,
    join(process.cwd(), "tools", "mgt-flux-klein", FLUX_RUNTIME_EXECUTABLE)
  ]);
  if (existing) {
    options.onProgress?.({
      progressText: "Flux 런타임 캐시 사용",
      detail: basename(existing),
      progressMode: "log-only",
      installLogLine: `MGT Flux Klein 런타임을 사용합니다: ${basename(existing)}`
    });
    return existing;
  }

  await mkdir(options.runtimeDir, { recursive: true });
  throw new Error(
    `${FLUX_RUNTIME_EXECUTABLE}를 찾지 못했습니다. 무늬 배경 인페인팅은 앱 전용 Flux Klein 런타임을 사용합니다. ` +
      `node scripts/prepare-flux-klein-runner.cjs를 실행하거나 MGT_FLUX_KLEIN_EXE로 경로를 지정해야 합니다.`
  );
}

export function hfResolveUrl(repo: string, fileName: string): string {
  return `https://huggingface.co/${repo}/resolve/main/${encodeURIComponent(fileName)}`;
}

export async function ensureRemoteFile(options: {
  modelDir: string;
  url: string;
  fileName: string;
  label: string;
  signal?: AbortSignal;
  onProgress?: (progress: FluxAssetProgress) => void;
}): Promise<string> {
  const filePath = join(options.modelDir, options.fileName);
  if (await isUsableRemoteFile(filePath, options.url)) {
    options.onProgress?.({
      progressText: `${options.label} 캐시 사용`,
      detail: options.fileName,
      progressMode: "log-only",
      installLogLine: `캐시된 ${options.label} 파일을 사용합니다: ${options.fileName}`
    });
    return filePath;
  }
  await mkdir(options.modelDir, { recursive: true });
  await downloadToFile({
    url: options.url,
    outputPath: filePath,
    signal: options.signal,
    progressText: `${options.label} 다운로드 중`,
    label: options.fileName,
    onProgress: options.onProgress
  });
  return filePath;
}

export async function ensureFluxCudnnRuntime(options: {
  cudnnDir: string;
  signal?: AbortSignal;
  onProgress?: (progress: FluxAssetProgress) => void;
}): Promise<string | null> {
  if (process.platform !== "win32") {
    return null;
  }

  const existing = findFirstCudnnDirectory([
    process.env.MGT_FLUX_CUDNN_BIN,
    process.env.CUDNN_BIN,
    process.env.CUDNN_PATH ? join(process.env.CUDNN_PATH, "bin") : undefined,
    findCudnnBin(options.cudnnDir),
    join(process.cwd(), "tools", "cudnn", "bin"),
    join(process.cwd(), "tools", "cudnn"),
    process.resourcesPath ? join(process.resourcesPath, "tools", "cudnn", "bin") : undefined,
    process.resourcesPath ? join(process.resourcesPath, "tools", "cudnn") : undefined
  ]);
  if (existing) {
    options.onProgress?.({
      progressText: "cuDNN 런타임 캐시 사용",
      detail: basename(existing),
      progressMode: "log-only",
      installLogLine: `cuDNN DLL을 사용합니다: ${existing}`
    });
    return existing;
  }

  await mkdir(options.cudnnDir, { recursive: true });
  const archivePath = join(options.cudnnDir, FLUX_CUDNN_ZIP_FILE);
  if (!(await isUsableRemoteFile(archivePath, FLUX_CUDNN_URL))) {
    await downloadToFile({
      url: FLUX_CUDNN_URL,
      outputPath: archivePath,
      signal: options.signal,
      progressText: "cuDNN 런타임 다운로드 중",
      label: FLUX_CUDNN_ZIP_FILE,
      onProgress: options.onProgress
    });
  }

  const binDir = join(options.cudnnDir, "bin");
  await extractCudnnDlls(archivePath, binDir);
  options.onProgress?.({
    progressText: "cuDNN 런타임 준비 완료",
    detail: "cudnn64_12.dll",
    progressMode: "log-only",
    installLogLine: `cuDNN DLL 압축 해제 완료: ${binDir}`
  });
  return binDir;
}

async function extractCudnnDlls(zipPath: string, binDir: string): Promise<void> {
  await mkdir(binDir, { recursive: true });
  const zip = new AdmZip(zipPath);
  const entries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && /(^|\/)bin\/cudnn[^/\\]*\.dll$/i.test(entry.entryName.replace(/\\/g, "/")));
  if (entries.length === 0) {
    throw new Error("cuDNN 압축 파일에서 cudnn DLL을 찾지 못했습니다.");
  }
  for (const entry of entries) {
    await writeFile(join(binDir, basename(entry.entryName)), entry.getData());
  }
  if (!hasCudnnDll(binDir)) {
    throw new Error("cuDNN DLL 압축 해제에 실패했습니다.");
  }
}

async function downloadToFile(options: {
  url: string;
  outputPath: string;
  signal?: AbortSignal;
  progressText: string;
  label: string;
  onProgress?: (progress: FluxAssetProgress) => void;
}): Promise<void> {
  if (await isUsableRemoteFile(options.outputPath, options.url)) {
    options.onProgress?.({
      progressText: `${options.label} 캐시 사용`,
      detail: options.label,
      progressMode: "log-only",
      installLogLine: `캐시된 파일을 사용합니다: ${options.label}`
    });
    return;
  }
  await mkdir(dirname(options.outputPath), { recursive: true });
  const partPath = `${options.outputPath}.part`;
  await rm(partPath, { force: true });
  const totalBytes = await probeContentLength(options.url, options.signal);
  options.onProgress?.({
    progressText: options.progressText,
    detail: options.label,
    progressMode: totalBytes > 0 ? "determinate" : "log-only",
    progressPercent: totalBytes > 0 ? 0 : undefined,
    progressBytes: totalBytes > 0 ? 0 : undefined,
    progressTotalBytes: totalBytes > 0 ? totalBytes : undefined,
    installLogLine: `${options.label} 다운로드 시작`
  });

  const response = await fetch(options.url, {
    signal: options.signal,
    headers: { "User-Agent": "manga-gemma-translator" }
  });
  if (!response.ok || !response.body) {
    throw new Error(`${options.label} 다운로드에 실패했습니다 (${response.status}).`);
  }

  const responseTotalBytes = totalBytes || readContentLength(response);
  const reader = response.body.getReader();
  const writer = createWriteStream(partPath, { flags: "wx" });
  let receivedBytes = 0;
  let lastEmitAt = 0;
  try {
    while (true) {
      throwIfAborted(options.signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const chunk = Buffer.from(value);
      await writeStreamChunk(writer, chunk);
      receivedBytes += chunk.byteLength;
      const now = Date.now();
      if (now - lastEmitAt > 500) {
        lastEmitAt = now;
        emitDownloadProgress(options, receivedBytes, responseTotalBytes);
      }
    }
    await finishWriteStream(writer);
    if (responseTotalBytes > 0 && receivedBytes !== responseTotalBytes) {
      throw new Error(`${options.label} 다운로드 크기가 맞지 않습니다 (${formatBytes(receivedBytes)} / ${formatBytes(responseTotalBytes)}).`);
    }
    await rm(options.outputPath, { force: true });
    await rename(partPath, options.outputPath);
    await writeRemoteFileMetadata(options.outputPath, {
      url: options.url,
      bytes: receivedBytes,
      downloadedAt: new Date().toISOString()
    });
    emitDownloadProgress(options, responseTotalBytes > 0 ? responseTotalBytes : receivedBytes, responseTotalBytes || receivedBytes, true);
  } catch (error) {
    writer.destroy();
    await rm(partPath, { force: true }).catch(() => {});
    throw error;
  }
}

function emitDownloadProgress(
  options: {
    progressText: string;
    label: string;
    onProgress?: (progress: FluxAssetProgress) => void;
  },
  receivedBytes: number,
  totalBytes: number,
  done = false
): void {
  options.onProgress?.({
    progressText: done ? `${options.label} 다운로드 완료` : options.progressText,
    detail: totalBytes > 0 ? `${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}` : `${formatBytes(receivedBytes)} 받음`,
    progressMode: totalBytes > 0 ? "determinate" : "log-only",
    progressPercent: totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : undefined,
    progressBytes: totalBytes > 0 ? receivedBytes : undefined,
    progressTotalBytes: totalBytes > 0 ? totalBytes : undefined,
    installLogLine:
      totalBytes > 0
        ? `${options.label}: ${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)}`
        : `${options.label}: ${formatBytes(receivedBytes)}`
  });
}

function findFirstExecutable(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && isExecutableFile(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findFirstCudnnDirectory(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (candidate && hasCudnnDll(candidate)) {
      return candidate;
    }
  }
  return null;
}

function findCudnnBin(rootDir: string): string | null {
  const direct = join(rootDir, "bin");
  if (hasCudnnDll(direct)) {
    return direct;
  }
  return hasCudnnDll(rootDir) ? rootDir : null;
}

function hasCudnnDll(dir: string): boolean {
  try {
    return existsSync(dir) && (existsSync(join(dir, "cudnn64_12.dll")) || existsSync(join(dir, "cudnn.dll")));
  } catch {
    return false;
  }
}

function findExecutable(rootDir: string, executableNames: string[]): string | null {
  if (!existsSync(rootDir)) {
    return null;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = join(current, entry);
      let stat;
      try {
        stat = statSync(path);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(path);
      } else if (stat.isFile() && executableNames.some((name) => entry.toLowerCase() === name.toLowerCase())) {
        return path;
      }
    }
  }
  return null;
}

function isUsableFile(filePath: string, minBytes = 1024 * 1024): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile() && statSync(filePath).size > minBytes;
  } catch {
    return false;
  }
}

async function isUsableRemoteFile(filePath: string, url: string): Promise<boolean> {
  if (!isUsableFile(filePath)) {
    return false;
  }
  const metadata = await readRemoteFileMetadata(filePath);
  if (!metadata) {
    return true;
  }
  try {
    const actualBytes = statSync(filePath).size;
    return metadata.url === url && metadata.bytes === actualBytes && actualBytes > 1024 * 1024;
  } catch {
    return false;
  }
}

async function readRemoteFileMetadata(filePath: string): Promise<RemoteFileMetadata | null> {
  try {
    return JSON.parse(await readFile(remoteFileMetadataPath(filePath), "utf8")) as RemoteFileMetadata;
  } catch {
    return null;
  }
}

async function writeRemoteFileMetadata(filePath: string, metadata: RemoteFileMetadata): Promise<void> {
  await writeFile(remoteFileMetadataPath(filePath), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

function remoteFileMetadataPath(filePath: string): string {
  return `${filePath}.mgtmeta.json`;
}

function isExecutableFile(filePath: string): boolean {
  try {
    return existsSync(filePath) && statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function probeContentLength(url: string, signal?: AbortSignal): Promise<number> {
  try {
    const response = await fetch(url, { method: "HEAD", signal });
    return response.ok ? readContentLength(response) : 0;
  } catch {
    return 0;
  }
}

function readContentLength(response: Response): number {
  const value = Number(response.headers.get("content-length"));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

async function writeStreamChunk(writer: ReturnType<typeof createWriteStream>, chunk: Buffer): Promise<void> {
  if (writer.write(chunk)) {
    return;
  }
  await once(writer, "drain");
}

async function finishWriteStream(writer: ReturnType<typeof createWriteStream>): Promise<void> {
  writer.end();
  await once(writer, "finish");
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
}
