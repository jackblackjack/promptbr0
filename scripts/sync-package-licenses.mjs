/**
 * Copies the root THIRD_PARTY_NOTICES.md into every npm-published package so
 * tarballs carry them (the notices file is whitelisted in each package's
 * "files"). Run this manually before npm publication. The copies are
 * gitignored; the root files are the source of truth.
 *
 * If a root LICENSE file exists, it is also copied into each package.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = ["packages/core", "packages/ai", "apps/cli"];

const license = path.join(root, "LICENSE");
const notices = path.join(root, "THIRD_PARTY_NOTICES.md");
if (!fs.existsSync(notices)) {
  console.error("THIRD_PARTY_NOTICES.md missing — run `pnpm notices` first.");
  process.exit(1);
}

for (const target of TARGETS) {
  if (fs.existsSync(license)) {
    fs.copyFileSync(license, path.join(root, target, "LICENSE"));
    console.log(`synced LICENSE + THIRD_PARTY_NOTICES.md → ${target}`);
  } else {
    fs.copyFileSync(notices, path.join(root, target, "THIRD_PARTY_NOTICES.md"));
    console.log(`synced THIRD_PARTY_NOTICES.md → ${target}`);
  }
}
