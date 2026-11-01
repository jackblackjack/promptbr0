import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../package-desktop.mjs", import.meta.url));
const manifestPath = fileURLToPath(new URL("../../package.json", import.meta.url));

test("Linux packaging aligns the shortcuts portal with the installed desktop entry", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  assert.equal(manifest.desktopName, manifest.build.appId);
  assert.match(manifest.desktopName, /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/);
  assert.equal(manifest.build.linux.syncDesktopName, true);
});

test("Packaging identity uses the promptbr0.ru product domain", async () => {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  // The bundle identifier is the only place the product domain reaches the
  // installed app (macOS CFBundleIdentifier, Linux desktop entry), so pin it
  // here rather than trusting the two manifest fields to stay in step.
  assert.equal(manifest.desktopName, "com.promptbr0.ru");
  assert.equal(manifest.build.appId, "com.promptbr0.ru");
});

test("Windows packaging forces the NSIS-compatible BCJ filter", async () => {
  const binDirectory = await mkdtemp(join(tmpdir(), "promptbr0-builder-bin-"));
  const fakeBuilder = join(binDirectory, "electron-builder");

  try {
    await writeFile(
      fakeBuilder,
      [
        "#!/usr/bin/env node",
        'console.log(`filter=${process.env.ELECTRON_BUILDER_7Z_FILTER ?? "unset"}`);',
        "console.log(`args=${process.argv.slice(2).join(\" \")}`);",
      ].join("\n"),
    );
    await chmod(fakeBuilder, 0o755);

    const environment = { ...process.env };
    delete environment.ELECTRON_BUILDER_7Z_FILTER;
    environment.PATH = `${binDirectory}${delimiter}${environment.PATH ?? ""}`;

    const result = spawnSync(process.execPath, [scriptPath, "--win", "--arm64"], {
      encoding: "utf8",
      env: environment,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^filter=BCJ$/m);
    assert.match(result.stdout, /^args=--win --arm64$/m);
  } finally {
    await rm(binDirectory, { recursive: true, force: true });
  }
});

test("Linux packaging normalizes electron-builder architecture names", async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), "promptbr0-linux-artifact-names-"));
  const binDirectory = await mkdtemp(join(tmpdir(), "promptbr0-builder-bin-"));
  const fakeBuilder = join(binDirectory, "electron-builder");

  try {
    await writeFile(
      fakeBuilder,
      [
        "#!/usr/bin/env node",
        'const fs = require("node:fs");',
        'fs.mkdirSync("dist", { recursive: true });',
        'for (const name of ["promptbr0_0.2.0_linux_x86_64.AppImage", "promptbr0_0.2.0_linux_amd64.deb"]) fs.writeFileSync(`dist/${name}`, name);',
      ].join("\n"),
    );
    await chmod(fakeBuilder, 0o755);

    const environment = { ...process.env };
    environment.PATH = `${binDirectory}${delimiter}${environment.PATH ?? ""}`;

    const result = spawnSync(process.execPath, [scriptPath, "--linux", "--x64", "--publish", "never"], {
      cwd: fixtureRoot,
      encoding: "utf8",
      env: environment,
    });

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual((await readdir(join(fixtureRoot, "dist"))).sort(), [
      "promptbr0_0.2.0_linux_x64.AppImage",
      "promptbr0_0.2.0_linux_x64.deb",
    ]);
  } finally {
    await Promise.all([
      rm(fixtureRoot, { recursive: true, force: true }),
      rm(binDirectory, { recursive: true, force: true }),
    ]);
  }
});
