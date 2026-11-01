import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const packageDirs = ["packages/core", "apps/cli"];

function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed (${result.status ?? "no status"}): ${executable} ${args.join(" ")}`,
        result.stdout,
        result.stderr,
        result.error?.message,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
}

function packageManager(name, args, options = {}) {
  return run(command(name), args, {
    shell: process.platform === "win32",
    ...options,
  });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "promptbr0-npm-smoke-"));
const tarballDir = path.join(tempRoot, "tarballs");
const consumerDir = path.join(tempRoot, "consumer");
fs.mkdirSync(tarballDir);
fs.mkdirSync(consumerDir);

try {
  run(process.execPath, [path.join(root, "scripts/sync-package-licenses.mjs")]);
  packageManager("pnpm", [
    "--filter",
    "@promptbr0/core",
    "--filter",
    "@promptbr0/cli",
    "build",
  ]);

  const tarballs = {};
  for (const packageDir of packageDirs) {
    const packed = packageManager("pnpm", [
      "--dir",
      packageDir,
      "pack",
      "--pack-destination",
      tarballDir,
      "--json",
    ]);
    const metadata = JSON.parse(packed.stdout);
    tarballs[metadata.name] = metadata.filename;

    const fileNames = new Set(metadata.files.map((file) => file.path));
    assert(fileNames.has("README.md"), `${metadata.name} tarball is missing README.md`);
    if (metadata.name === "@promptbr0/core") {
      assert(fileNames.has("dist/index.js"), `${metadata.name} tarball is missing compiled JavaScript`);
      assert(fileNames.has("dist/index.d.ts"), `${metadata.name} tarball is missing declarations`);
      assert(
        [...fileNames].every((fileName) => !fileName.startsWith("src/") && !fileName.startsWith("tests/")),
        `${metadata.name} tarball contains development source or tests`,
      );
    }
  }

  fs.writeFileSync(
    path.join(consumerDir, "package.json"),
    `${JSON.stringify(
      {
        name: "promptbr0-package-smoke-consumer",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          Object.entries(tarballs).map(([name, filename]) => [name, `file:${filename}`]),
        ),
      },
      null,
      2,
    )}\n`,
  );
  packageManager("npm", ["install", "--no-audit", "--no-fund"], { cwd: consumerDir });

  for (const packageName of Object.keys(tarballs)) {
    const installedManifest = JSON.parse(
      fs.readFileSync(path.join(consumerDir, "node_modules", packageName, "package.json"), "utf8"),
    );
    for (const dependencyKind of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [dependencyName, dependencyRange] of Object.entries(installedManifest[dependencyKind] ?? {})) {
        assert(
          typeof dependencyRange !== "string" || !dependencyRange.startsWith("workspace:"),
          `${packageName} contains an unpublished workspace ${dependencyKind} entry ${dependencyName}: ${dependencyRange}`,
        );
      }
    }
  }

  const require = createRequire(path.join(consumerDir, "package.json"));
  const sqliteManifestPath = require.resolve("better-sqlite3/package.json");
  const sqliteRoot = path.dirname(sqliteManifestPath);
  for (const target of [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64",
    "linuxmusl-arm64",
    "linuxmusl-x64",
    "win32-arm64",
    "win32-x64",
  ]) {
    assert(
      fs.existsSync(path.join(sqliteRoot, "prebuilds", `${target}.node`)),
      `better-sqlite3 is missing its ${target} prebuild`,
    );
  }

  const runtimeSmokePath = path.join(consumerDir, "runtime-smoke.mjs");
  fs.writeFileSync(
    runtimeSmokePath,
    `import assert from "node:assert/strict";
import { openMemoryDatabase, PromptLibrary } from "@promptbr0/core";

const db = openMemoryDatabase();
const library = new PromptLibrary(db);
const prompt = library.createPrompt({ title: "Cross-platform smoke", content: "Hello" });
assert.equal(library.getPrompt(prompt.id)?.title, "Cross-platform smoke");
db.close();
`,
  );
  run(process.execPath, [runtimeSmokePath], { cwd: consumerDir });

  const typeSmokePath = path.join(consumerDir, "type-smoke.ts");
  fs.writeFileSync(
    typeSmokePath,
    `import { openMemoryDatabase, type Database } from "@promptbr0/core";

const opened: Database = openMemoryDatabase();
opened.close();
`,
  );
  fs.writeFileSync(
    path.join(consumerDir, "tsconfig.json"),
    `${JSON.stringify(
      {
        compilerOptions: {
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        files: ["type-smoke.ts"],
      },
      null,
      2,
    )}\n`,
  );
  run(process.execPath, [path.join(root, "node_modules/typescript/bin/tsc"), "-p", consumerDir]);

  const cliPath = path.join(consumerDir, "node_modules/@promptbr0/cli/dist/index.js");
  assert.equal(fs.readFileSync(cliPath, "utf8").split(/\r?\n/, 1)[0], "#!/usr/bin/env node");
  const cliDbPath = path.join(tempRoot, "cli", "library.db");
  const cli = run(process.execPath, [cliPath, "list", "--json"], {
    cwd: consumerDir,
    env: { ...process.env, PROMPTBR0_DB: cliDbPath },
  });
  assert.deepEqual(JSON.parse(cli.stdout), []);

  console.log(`npm package smoke passed on ${process.platform}/${process.arch} with Node ${process.version}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
