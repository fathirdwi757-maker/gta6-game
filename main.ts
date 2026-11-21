// Solano Heat — hand-in program for the make.fun "Make GTA 6" bounty (gta6-01).
//
// The game itself is the static site in game/ (open game/index.html in a browser and
// play; there is no build step). This program packages an entry: it copies game/ and
// screenshots/ into the output directory and writes dossier.json there with the
// vendored make.fun library, which is also what the grader runs to check the entry.
//
// Run it locally the same way the grader does, with an explicit output directory:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader's container the output directory is /output, which is the default.

import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoDir = dirname(fileURLToPath(import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Copy the playable game first: buildDossier reads the tree back from the output
// directory, so the dossier describes exactly the bytes that were handed in.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outputDir, 'game'), { recursive: true });

// Screenshots are optional on disk during development but required for an entry;
// copy whatever is present so a local run never fails on a missing folder.
const shotsDir = join(repoDir, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outputDir, 'screenshots'), { recursive: true });
}

// The caps mirror the sealed gate's limits, so a local run refuses anything the
// scorer would refuse: the dossier's source text, the screenshot count and size,
// and the game tree's file count, total bytes and longest path.
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

console.log(`Solano Heat entry written to ${outputDir} (dossier ${dossier.byteLength} bytes)`);
