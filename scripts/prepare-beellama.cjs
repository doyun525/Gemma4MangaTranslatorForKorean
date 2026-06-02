const { createWriteStream, existsSync, mkdirSync } = require("node:fs");
const { get } = require("node:https");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = join(__dirname, "..");
const runtimeVersion = "v0.2.0";
const runtimeDirName = "beellama-v0.2.0-cuda12.4";
const runtimeDir = join(root, "tools", runtimeDirName);
const serverExe = join(runtimeDir, "llama-server.exe");
const binZipUrl = `https://github.com/Anbeeld/beellama.cpp/releases/download/${runtimeVersion}/beellama-v0.2.0-bin-win-cuda-12.4-x64.zip`;
const cudaZipUrl = `https://github.com/Anbeeld/beellama.cpp/releases/download/${runtimeVersion}/cudart-llama-bin-win-cuda-12.4-x64.zip`;
const tmpDir = join(root, ".tmp", "beellama");

async function main() {
  if (process.platform !== "win32") {
    console.log("[beellama] skipping bundled runtime download on non-Windows host");
    return;
  }

  if (existsSync(serverExe)) {
    console.log(`[beellama] already prepared: ${serverExe}`);
    return;
  }

  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(runtimeDir, { recursive: true });

  const binZip = join(tmpDir, "beellama-bin.zip");
  const cudaZip = join(tmpDir, "cudart-bin.zip");
  await download(binZipUrl, binZip);
  await download(cudaZipUrl, cudaZip);
  expandArchive(binZip, runtimeDir);
  expandArchive(cudaZip, runtimeDir);

  if (!existsSync(serverExe)) {
    throw new Error(`llama-server.exe was not found after extraction: ${serverExe}`);
  }

  console.log(`[beellama] prepared: ${serverExe}`);
}

function download(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`[beellama] downloading ${url}`);
    const file = createWriteStream(outputPath);
    get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location) {
        file.close();
        download(response.headers.location, outputPath).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
    }).on("error", (error) => {
      file.close();
      reject(error);
    });
  });
}

function expandArchive(zipPath, outputDir) {
  run("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Expand-Archive -LiteralPath ${JSON.stringify(zipPath)} -DestinationPath ${JSON.stringify(outputDir)} -Force`
  ]);
}

function run(command, args) {
  console.log(`> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status ?? "null"}`);
  }
}

module.exports = { prepareBeellamaRuntime: main };

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
