import { execFile } from "node:child_process";

export type GpuMemorySnapshot = {
  index: number;
  name: string | null;
  totalMb: number;
  usedMb: number;
  freeMb: number;
};

export async function queryBestGpuMemorySnapshot(): Promise<GpuMemorySnapshot | null> {
  try {
    const stdout = await execFileAsync("nvidia-smi", [
      "--query-gpu=index,name,memory.total,memory.used,memory.free",
      "--format=csv,noheader,nounits"
    ]);
    const snapshots = stdout
      .split(/\r?\n/)
      .map(parseGpuMemoryLine)
      .filter((snapshot): snapshot is GpuMemorySnapshot => Boolean(snapshot));
    if (snapshots.length === 0) {
      return null;
    }
    return snapshots.sort((left, right) => right.totalMb - left.totalMb)[0];
  } catch {
    return null;
  }
}

export function shouldReleaseGpuResidentModel(snapshot: GpuMemorySnapshot | null, minFreeMb: number): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.freeMb < minFreeMb;
}

function parseGpuMemoryLine(line: string): GpuMemorySnapshot | null {
  const parts = line.split(",").map((part) => part.trim());
  if (parts.length < 5) {
    return null;
  }
  const index = Number(parts[0]);
  const totalMb = Number(parts[2]);
  const usedMb = Number(parts[3]);
  const freeMb = Number(parts[4]);
  if (![index, totalMb, usedMb, freeMb].every(Number.isFinite) || totalMb <= 0) {
    return null;
  }
  return {
    index,
    name: parts[1] || null,
    totalMb,
    usedMb,
    freeMb
  };
}

function execFileAsync(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { windowsHide: true }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(stdout);
    });
  });
}
