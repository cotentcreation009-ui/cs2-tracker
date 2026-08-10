// Builds the Chrome Web Store upload ZIP.
//
// Only what the extension actually runs goes in: manifest, src/, icons/. The
// dev fixtures, the mock API and the design docs are deliberately excluded —
// they are development scaffolding, they would ship a second copy of the code
// to reviewers, and dev/mock-api.js in particular reads like a second data
// source to anyone auditing the package.
//
//   node package.mjs        -> dist/csrun-<version>.zip
//
// Uses PowerShell's Compress-Archive so there is no dependency to install.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));

// Everything shipped, and nothing else.
const INCLUDE = ["manifest.json", "src", "icons"];

const stage = join(root, "dist", "stage");
const outDir = join(root, "dist");
const zip = join(outDir, `csrun-${manifest.version}.zip`);

rmSync(stage, { recursive: true, force: true });
rmSync(zip, { force: true });
mkdirSync(stage, { recursive: true });

for (const entry of INCLUDE) {
  const from = join(root, entry);
  if (!existsSync(from)) throw new Error(`missing required entry: ${entry}`);
  cpSync(from, join(stage, entry), { recursive: true });
}

// The store rejects an over-long description at upload, before any human sees
// it, so it is worth failing here instead of there.
const limits = { name: 75, description: 132 };
for (const [field, max] of Object.entries(limits)) {
  const len = [...(manifest[field] || "")].length;
  if (len > max) throw new Error(`manifest.${field} is ${len} chars, limit ${max}`);
  console.log(`${field.padEnd(12)} ${String(len).padStart(3)} / ${max}`);
}

for (const size of ["16", "48", "128"]) {
  const icon = manifest.icons?.[size];
  if (!icon || !existsSync(join(stage, icon))) throw new Error(`missing icon ${size}: ${icon}`);
}
console.log("icons        16/48/128 present");

execFileSync(
  "powershell.exe",
  ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zip}' -Force`],
  { stdio: "inherit" },
);
rmSync(stage, { recursive: true, force: true });

const bytes = statSync(zip).size;
console.log(`\nwrote ${zip}`);
console.log(`${(bytes / 1024).toFixed(1)} KB`);
console.log(`contents: ${INCLUDE.join(", ")}`);
console.log(`excluded: ${readdirSync(root).filter((f) => !INCLUDE.includes(f) && f !== "dist" && f !== "package.mjs").join(", ")}`);
