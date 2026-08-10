// Builds the Chrome Web Store upload ZIP.
//
// Only what the extension actually runs goes in: manifest, src/, icons/. The
// dev fixtures, the mock API and the design docs are deliberately excluded —
// they are development scaffolding, they would ship a second copy of the code
// to reviewers, and dev/mock-api.js in particular reads like a second data
// source to anyone auditing the package.
//
//   node package.mjs                 -> dist/csrun-<version>.zip
//   node package.mjs --bump patch    -> bump manifest version first, then zip
//
// The store refuses an upload whose version is not HIGHER than the last one
// published, so every update starts with a bump. Doing it here means the
// version in the manifest and the version in the filename can never disagree.
//
// Uses PowerShell's Compress-Archive so there is no dependency to install.

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const manifestPath = join(root, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const bumpIdx = process.argv.indexOf("--bump");
if (bumpIdx !== -1) {
  const kind = process.argv[bumpIdx + 1] || "patch";
  const parts = String(manifest.version).split(".").map((n) => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  if (kind === "major") { parts[0] += 1; parts[1] = 0; parts[2] = 0; }
  else if (kind === "minor") { parts[1] += 1; parts[2] = 0; }
  else if (kind === "patch") { parts[2] += 1; }
  else throw new Error(`--bump takes major, minor or patch (got "${kind}")`);
  const next = parts.join(".");
  console.log(`version      ${manifest.version} -> ${next}`);
  manifest.version = next;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

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
