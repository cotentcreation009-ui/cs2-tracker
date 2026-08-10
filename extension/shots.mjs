// Turns any screenshots you have into Chrome Web Store listing images.
//
// The store accepts 1280x800 or 640x400 and nothing else — an image a few
// pixels off is rejected at upload. Rather than fight an editor, drop whatever
// you captured into store/raw/ and run this: each one is scaled to fit and
// centred on an exact 1280x800 canvas, on the extension's own panel colour so
// the padding reads as part of the design instead of as a letterbox.
//
//   node shots.mjs           -> store/*.png at 1280x800
//   node shots.mjs --small   -> 640x400 instead
//
// Uses .NET's System.Drawing through PowerShell, so there is nothing to
// install. Aspect ratio is never distorted; a wide screenshot gets bars top and
// bottom, a tall one gets them at the sides.

import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, parse } from "node:path";

const root = resolve(import.meta.dirname);
const rawDir = join(root, "store", "raw");
const outDir = join(root, "store");

const small = process.argv.includes("--small");
const W = small ? 640 : 1280;
const H = small ? 400 : 800;

// --sr-panel from tokens.css, so the padding matches the extension's own card.
const BG = "#10182B";

mkdirSync(rawDir, { recursive: true });

const inputs = existsSync(rawDir)
  ? readdirSync(rawDir).filter((f) => /\.(png|jpg|jpeg)$/i.test(f))
  : [];

if (!inputs.length) {
  console.log(`No images found in ${rawDir}`);
  console.log("Put your screenshots there (any size) and run this again.");
  console.log("\nWhat to capture, one image each:");
  console.log("  1. a match room with the player strips visible");
  console.log("  2. a player profile with the CSRun card (Overview tab)");
  console.log("  3. the same card on the Maps tab");
  process.exit(0);
}

const ps = `
Add-Type -AssemblyName System.Drawing
$W = ${W}; $H = ${H}
$bg = [System.Drawing.ColorTranslator]::FromHtml('${BG}')
foreach ($src in @(${inputs.map((f) => `'${join(rawDir, f).replace(/'/g, "''")}'`).join(",")})) {
  $img = [System.Drawing.Image]::FromFile($src)
  $canvas = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($canvas)
  $g.Clear($bg)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.PixelOffsetMode  = 'HighQuality'
  # scale to FIT — never crop, never stretch.
  # NOTE: PowerShell variables are case-INSENSITIVE, so naming the scaled width
  # $w silently overwrites $W, the canvas width. Hence $dw / $dh.
  $s = [Math]::Min($W / $img.Width, $H / $img.Height)
  $dw = [int]($img.Width * $s); $dh = [int]($img.Height * $s)
  $g.DrawImage($img, [int](($W - $dw) / 2), [int](($H - $dh) / 2), $dw, $dh)
  $name = [IO.Path]::GetFileNameWithoutExtension($src)
  $dest = Join-Path '${outDir.replace(/'/g, "''")}' ($name + '-' + $W + 'x' + $H + '.png')
  $canvas.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $canvas.Dispose(); $img.Dispose()
  Write-Host ('  ' + $name + '  ->  ' + [IO.Path]::GetFileName($dest))
}
`;

console.log(`Converting ${inputs.length} image(s) to ${W}x${H}:`);
execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });
console.log(`\nUpload these from ${outDir}`);
