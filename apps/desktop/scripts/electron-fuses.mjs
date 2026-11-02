import { join } from "node:path";

import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

/**
 * Path of the real Electron binary at the afterPack stage. Fuses must be
 * flipped on the actual Mach-O/PE/ELF file — before code signing (electron-
 * builder signs after the afterPack hooks) and before the Linux launcher
 * renames the binary to `${executableName}-bin` (see linux-launcher.mjs).
 */
export function electronBinaryPath(context) {
  const { appOutDir, electronPlatformName, packager } = context;
  if (electronPlatformName === "darwin") {
    const productName = packager.appInfo.productFilename;
    return join(appOutDir, `${productName}.app`, "Contents", "MacOS", productName);
  }
  // Mirrors app-builder-lib's own fuse-step naming: win32 executables are
  // named after productFilename, Linux after the linux executableName.
  const name =
    electronPlatformName === "win32"
      ? `${packager.appInfo.productFilename}.exe`
      : packager.executableName;
  return join(appOutDir, name);
}

/**
 * The hardening baseline for packaged artifacts (security audit, stage 1):
 * the packaged app must never run as plain Node, never honour NODE_OPTIONS,
 * never open an inspector port, and only load app code from a validated asar.
 */
export function fuseWireOptions() {
  return {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  };
}

export async function flipProductionFuses(context) {
  await flipFuses(electronBinaryPath(context), fuseWireOptions());
}
