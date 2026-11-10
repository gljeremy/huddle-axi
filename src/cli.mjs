#!/usr/bin/env node
// huddle-axi CLI. Step 1 ships `new`; `poll` and `patch` arrive with the agent loop in step 2.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RULES, protocolText } from './rules.mjs';
import { SAMPLE, STARTER } from './sample.mjs';

const here = (name) => new URL(name, import.meta.url);
const VERSION = JSON.parse(readFileSync(here('../package.json'), 'utf8')).version;

const USAGE = `usage: huddle-axi new <file.html> [--title "<title>"] [--sample] [--force]

  --title   board title (default: "New huddle", or the sample's title)
  --sample  start from the sample onboarding board instead of a blank one
  --force   overwrite <file.html> if it exists`;

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function buildBoard({ title, subtitle = '', brief = '', lanes }) {
  const runtimeJs = readFileSync(here('./runtime.js'), 'utf8')
    .replace('/*HUDDLE_RULES*/ null', () => JSON.stringify(RULES))
    .replace("/*HUDDLE_VERSION*/ '0.0.0'", () => JSON.stringify(VERSION));
  const context = {
    format: 'huddle-board',
    formatVersion: 1,
    title,
    brief,
    protocol: protocolText(),
    threads: {},
    revisions: [],
  };
  const laneHtml = lanes
    .map((lane) => `<div data-lane="${escapeHtml(lane.id)}">\n<h2>${escapeHtml(lane.title)}</h2>\n${lane.cards.join('\n')}\n</div>`)
    .join('\n');
  const fill = {
    VERSION: escapeHtml(VERSION),
    TITLE: escapeHtml(title),
    SUBTITLE: escapeHtml(subtitle),
    CSS: readFileSync(here('./runtime.css'), 'utf8').trim(),
    LANES: laneHtml,
    CONTEXT: JSON.stringify(context, null, 2).replace(/</g, '\\u003c'),
    JS: runtimeJs.trim(),
  };
  return readFileSync(here('./board-template.html'), 'utf8').replace(/\{\{([A-Z]+)\}\}/g, (_, key) => fill[key]);
}

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--title') out.flags.title = argv[++i];
    else if (arg === '--sample' || arg === '--force') out.flags[arg.slice(2)] = true;
    else if (arg === '--help' || arg === '-h') out.flags.help = true;
    else if (arg.startsWith('--')) throw new Error(`unknown flag ${arg}`);
    else out.positional.push(arg);
  }
  return out;
}

function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(`error: ${err.message}\n${USAGE}`);
    return 2;
  }
  const [command, file] = args.positional;
  if (args.flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (command !== 'new' || !file) {
    console.error(USAGE);
    return 2;
  }
  if (args.flags.title === undefined && argv.includes('--title')) {
    console.error('error: --title needs a value');
    return 2;
  }
  const path = resolve(file);
  if (existsSync(path) && !args.flags.force) {
    console.error(`error: ${path} already exists. Pass --force to overwrite it.`);
    return 1;
  }
  const base = args.flags.sample ? SAMPLE : STARTER;
  const html = buildBoard({ ...base, title: args.flags.title ?? base.title });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  const cards = base.lanes.reduce((n, lane) => n + lane.cards.length, 0);
  console.log(`created: ${path}\ncards: ${cards}\nnext: open it in a browser`);
  return 0;
}

// Run only when executed (including through an npm bin link), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2));
}
