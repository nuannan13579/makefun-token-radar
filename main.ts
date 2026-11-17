// Token Launch Radar: the entry point.
//
// Reads the sealed snapshot (/input/snapshot.json in the grader, or --input <file|dir>), values every
// rankable pre-token protocol with the comp model in lib/, and writes the hand-in to the output
// directory (/output in the grader, or MAKEFUN_OUTPUT_DIR / --output):
//
//   board.json    the ranked board, with the method stated and every row's arithmetic shown
//   data.js       the same board as window.RADAR, which dashboard/index.html renders offline
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  buildDossier's summary of the two copies above, written last, byte for byte what
//                 the scorer rebuilds from them
//
// The program refuses to write a board the gate would refuse: boardIssue in lib/board.ts mirrors the
// gate's board checks, and a bad board exits 1 with the reason rather than handing in a 0.
//
// Outside the grader's container:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSnapshot } from './lib/model.ts';
import { boardIssue, buildBoard, dataScript } from './lib/board.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The dossier caps the scorer applies: the text cap shapes the bytes, the rest only refuse. */
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 },
} as const;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { doc, radar } = buildBoard(snapshot);
const issue = boardIssue(doc.rows, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(doc)}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} images: hand in 3 or 4 (the board, a detail view, a filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// Written last: the scorer rebuilds the dossier from this output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, DOSSIER_CAPS));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${doc.rows.length} rows ranked, ` +
    `top: ${doc.rows[0]!.name} at $${doc.rows[0]!.implied_value_usd.toLocaleString('en-US')}\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images) and dossier.json in ${out}\n`,
);
