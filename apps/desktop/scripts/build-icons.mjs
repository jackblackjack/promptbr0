/**
 * Derives the platform icon set from build/icon.png (created by
 * generate-icon.mjs):
 *   build/icon.icns      macOS / cross-platform (ic01-ic12, zlib-compressed PNGs)
 *   build/icon.ico       Windows (multi-size)
 *   build/icon-512.png   Linux / AppImage
 * The About dialog uses a copy at src/renderer/src/assets/icon.png — refresh
 * it from build/icon.png if the brand icon changes.
 *
 * Platform:
 *   macOS: sips + iconutil (native, fast)
 *   Linux/elsewhere: ImageMagick convert + Python (stdlib only)
 * Run: node scripts/build-icons.mjs  (or: pnpm icons)
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(scriptsDir, "..", "build");
const src = path.join(buildDir, "icon.png");

if (!fs.existsSync(src)) {
  execFileSync(process.execPath, [path.join(scriptsDir, "generate-icon.mjs")], { stdio: "inherit" });
}

// --- platform-specific resize helper ------------------------------------------

function resize(size, outPath) {
  execFileSync("sips", ["-z", String(size), String(size), src, "--out", outPath], { stdio: "pipe" });
}

function resizeMagick(size, outPath) {
  execFileSync("convert", [src, "-resize", `${size}x${size}`, outPath], { stdio: "pipe" });
}

const isMac = os.platform() === "darwin";
const resizeFn = isMac ? resize : resizeMagick;

// --- macOS .icns or cross-platform fallback -----------------------------------
if (isMac) {
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), "pb-iconset-"));
  const iconsetDir = path.join(iconset, "icon.iconset");
  fs.mkdirSync(iconsetDir);
  for (const size of [16, 32, 128, 256, 512]) {
    resizeFn(size, path.join(iconsetDir, `icon_${size}x${size}.png`));
    resizeFn(size * 2, path.join(iconsetDir, `icon_${size}x${size}@2x.png`));
  }
  execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", path.join(buildDir, "icon.icns")]);
  fs.rmSync(iconset, { recursive: true, force: true });
} else {
  // Linux/elsewhere: generate PNGs + pack with Python (stdlib: struct+zlib)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pb-icns-"));
  const entries = [
    { size: 16, type: "ic01" },
    { size: 32, type: "ic02" },
    { size: 64, type: "ic04" },
    { size: 128, type: "ic08" },
    { size: 256, type: "ic10" },
    { size: 512, type: "ic12" },
  ];
  // Generate resized PNGs
  for (const e of entries) {
    const png = path.join(tmpDir, `${e.size}.png`);
    resizeFn(e.size, png);
    e.png = png;
  }
  // Pack .icns via inline Python
  const pyCode = `
import struct, zlib, sys
header = b"icns" + struct.pack(">HH", 1, 0)
pairs = list(zip(sys.argv[1::2], sys.argv[2::2]))
entries = []
for png_path, type_str in pairs:
    data = open(png_path, "rb").read()
    compressed = zlib.compress(data, 9)
    entries.append(type_str.encode("ascii") + struct.pack(">I", len(compressed)) + compressed)
with open(sys.argv[-1], "wb") as f:
    f.write(header + b"".join(entries))
`;
  const pyArgs = entries.flatMap(e => [e.png, e.type]).concat(path.join(buildDir, "icon.icns"));
  spawnSync("python3", ["-c", pyCode, ...pyArgs], { stdio: "inherit" });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// --- Windows .ico (multi-size) ------------------------------------------------
if (isMac) {
  const icoTmp = fs.mkdtempSync(path.join(os.tmpdir(), "pb-ico-"));
  const icoPngs = [16, 32, 48, 64, 128, 256].map((size) => {
    const p = path.join(icoTmp, `${size}.png`);
    resizeFn(size, p);
    return p;
  });
  try {
    const pngToIco = await import("png-to-ico");
    fs.writeFileSync(path.join(buildDir, "icon.ico"), await pngToIco.default(icoPngs));
  } catch {
    execFileSync("convert", [src, "-define", "icon:auto-resize=256,128,64,48,32,16", path.join(buildDir, "icon.ico")], { stdio: "pipe" });
  }
  fs.rmSync(icoTmp, { recursive: true, force: true });
} else {
  execFileSync("convert", [src, "-define", "icon:auto-resize=256,128,64,48,32,16", path.join(buildDir, "icon.ico")], { stdio: "pipe" });
}

// --- 512x512 png (Linux / AppImage) -------------------------------------------
resizeFn(512, path.join(buildDir, "icon-512.png"));

// --- About dialog icon --------------------------------------------------------
fs.copyFileSync(path.join(buildDir, "icon.png"), path.join(scriptsDir, "..", "src", "renderer", "src", "assets", "icon.png"));

for (const f of ["icon.icns", "icon.ico", "icon-512.png"]) {
  console.log(`icon written: ${path.join(buildDir, f)}`);
}
