import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { pathToFileURL } from "node:url";

const tempDirectories = [];
const hookUrl = pathToFileURL(join(import.meta.dirname, "..", "linux-launcher.mjs"));

test.afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function fixture() {
  const appOutDir = await mkdtemp(join(tmpdir(), "promptbr0-linux-launcher-"));
  tempDirectories.push(appOutDir);
  const executable = join(appOutDir, "promptbr0");
  await writeFile(executable, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n");
  await chmod(executable, 0o755);
  return appOutDir;
}

test("Linux packages launch Electron with X11 before application startup", async () => {
  const appOutDir = await fixture();
  const { default: installLinuxLauncher } = await import(hookUrl.href);

  await installLinuxLauncher({
    appOutDir,
    electronPlatformName: "linux",
    packager: { executableName: "promptbr0" },
  });

  const launcher = await readFile(join(appOutDir, "promptbr0"), "utf8");
  assert.match(launcher, /--ozone-platform=x11/);
  assert.equal((await stat(join(appOutDir, "promptbr0"))).mode & 0o111, 0o111);

  const result = spawnSync(join(appOutDir, "promptbr0"), ["--probe"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["--ozone-platform=x11", "--probe"]);
});

test("Linux package launcher preserves an explicit Ozone backend override", async () => {
  const appOutDir = await fixture();
  const { default: installLinuxLauncher } = await import(hookUrl.href);

  await installLinuxLauncher({
    appOutDir,
    electronPlatformName: "linux",
    packager: { executableName: "promptbr0" },
  });

  const result = spawnSync(
    join(appOutDir, "promptbr0"),
    ["--ozone-platform=wayland", "--probe"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["--ozone-platform=wayland", "--probe"]);
});

test("Linux package launcher resolves its installed symlink before locating Electron", async () => {
  const appOutDir = await fixture();
  const { default: installLinuxLauncher } = await import(hookUrl.href);

  await installLinuxLauncher({
    appOutDir,
    electronPlatformName: "linux",
    packager: { executableName: "promptbr0" },
  });

  const binDir = join(appOutDir, "bin");
  await mkdir(binDir);
  const installedLauncher = join(binDir, "promptbr0");
  await symlink(join(appOutDir, "promptbr0"), installedLauncher);

  const result = spawnSync(installedLauncher, ["--probe"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split("\n"), ["--ozone-platform=x11", "--probe"]);
});
