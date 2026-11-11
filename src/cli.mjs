#!/usr/bin/env node
// huddle-axi CLI: make a board, open it live, and run the agent's poll/patch loop.
// Output is TOON (https://toonformat.dev) so an agent can read it directly.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardToToon } from './card-model.mjs';
import { ClientError, call, ensureServer, findServer, openInBrowser } from './client.mjs';
import { RULES, protocolText } from './rules.mjs';
import { SAMPLE, STARTER } from './sample.mjs';
import { encode } from './toon.mjs';

const here = (name) => new URL(name, import.meta.url);
const VERSION = JSON.parse(readFileSync(here('../package.json'), 'utf8')).version;
const POLL_MS = 8 * 60 * 1000;

const USAGE = `usage:
  huddle-axi new <file.html> [--title "<title>"] [--sample] [--force]
  huddle-axi open <file.html> [--no-open]
  huddle-axi poll <file.html> [--timeout-ms <ms>] [--out <card-file>]
  huddle-axi patch <file.html> [--card-file <card-file>] [--note "<what changed>"]
  huddle-axi stop

  new     write a board file
          --title   board title (default: "New huddle", or the sample's title)
          --sample  start from the sample onboarding board instead of a blank one
          --force   overwrite <file.html> if it exists
  open    serve the board live and open it in the browser (--no-open: just print the URL)
  poll    wait for the facilitator's next note; prints the note and the card it is on
          --timeout-ms  how long to wait (default ${POLL_MS})
          --out         write the card to this file instead of printing it
  patch   replace one card: TOON (as poll prints it) or one <section> element,
          from --card-file or stdin. The board updates in place and the file is saved.
  stop    stop the background server`;

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

const VALUE_FLAGS = new Set(['--title', '--timeout-ms', '--out', '--card-file', '--note']);
const BOOL_FLAGS = new Set(['--sample', '--force', '--no-open']);
const COMMANDS = { new: 1, open: 1, poll: 1, patch: 1, stop: 0 }; // positional args after the command

class UsageError extends Error {}

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const name = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (VALUE_FLAGS.has(arg)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new UsageError(`${arg} needs a value`);
      out.flags[name] = argv[++i];
    } else if (BOOL_FLAGS.has(arg)) out.flags[name] = true;
    else if (arg === '--help' || arg === '-h') out.flags.help = true;
    else if (arg.startsWith('--')) throw new UsageError(`unknown flag ${arg}`);
    else out.positional.push(arg);
  }
  const [command, ...rest] = out.positional;
  if (!out.flags.help && (!Object.hasOwn(COMMANDS, command ?? '') || rest.length !== COMMANDS[command])) throw new UsageError('');
  return { command, file: rest[0] && resolve(rest[0]), flags: out.flags };
}

const print = (obj) => process.stdout.write(encode(obj));

function cmdNew(path, flags) {
  if (existsSync(path) && !flags.force) {
    console.error(`error: ${path} already exists. Pass --force to overwrite it.`);
    return 1;
  }
  const base = flags.sample ? SAMPLE : STARTER;
  const html = buildBoard({ ...base, title: flags.title ?? base.title });
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, html);
  const cards = base.lanes.reduce((n, lane) => n + lane.cards.length, 0);
  print({ created: path, cards, next: `huddle-axi open ${path}` });
  return 0;
}

async function cmdOpen(path, flags) {
  if (!existsSync(path)) {
    console.error(`error: ${path} does not exist. Make it with: huddle-axi new ${path}`);
    return 1;
  }
  const state = await ensureServer();
  const { url } = await call(state, '/api/open', { file: path });
  if (!flags.noOpen) openInBrowser(url);
  print({ url, file: path, next: `huddle-axi poll ${path}` });
  return 0;
}

async function liveServer() {
  const state = await findServer();
  if (!state) throw new ClientError('no huddle server is running; start one with: huddle-axi open <file.html>');
  return state;
}

// The card as the agent should edit it: TOON when it fits the card model, else its HTML.
function cardText(note) {
  if (note.model) {
    try {
      return { format: 'toon', text: cardToToon(note.model) };
    } catch {}
  }
  return { format: 'html', text: `${note.html ?? ''}\n` };
}

async function cmdPoll(path, flags) {
  const timeoutMs = flags.timeoutMs === undefined ? POLL_MS : Number(flags.timeoutMs);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 0) throw new UsageError('--timeout-ms must be a whole number of milliseconds');
  const state = await liveServer();
  const { note } = await call(state, '/api/poll', { file: path, timeoutMs });
  if (!note) {
    print({ status: 'timeout', next: `huddle-axi poll ${path}` });
    return 0;
  }
  const { format, text } = cardText(note);
  const head = {
    note: note.text,
    card: note.card,
    board: note.board.title,
    brief: note.board.brief,
    thread: note.thread.map((t) => ({ who: String(t.who), text: String(t.text) })),
    format,
  };
  if (flags.out) {
    const out = resolve(flags.out);
    writeFileSync(out, text);
    print({ ...head, card_file: out, next: `edit ${out}, then: huddle-axi patch ${path} --card-file ${out}` });
  } else {
    print({ ...head, next: `edit the card below and pipe it to: huddle-axi patch ${path}` });
    process.stdout.write(`---\n${text}`);
  }
  return 0;
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function cmdPatch(path, flags) {
  const body = flags.cardFile ? readFileSync(resolve(flags.cardFile), 'utf8') : await readStdin();
  const state = await liveServer();
  const { card, saved } = await call(state, '/api/patch', { file: path, body, note: flags.note });
  print({ patched: card, saved });
  return 0;
}

async function cmdStop() {
  const state = await findServer();
  if (state) await call(state, '/api/stop', {});
  print({ stopped: Boolean(state) });
  return 0;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    if (!(err instanceof UsageError)) throw err;
    console.error(err.message ? `error: ${err.message}\n${USAGE}` : USAGE);
    return 2;
  }
  if (args.flags.help) {
    console.log(USAGE);
    return 0;
  }
  try {
    switch (args.command) {
      case 'new': return cmdNew(args.file, args.flags);
      case 'open': return await cmdOpen(args.file, args.flags);
      case 'poll': return await cmdPoll(args.file, args.flags);
      case 'patch': return await cmdPatch(args.file, args.flags);
      case 'stop': return await cmdStop();
    }
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}`);
      return 2;
    }
    if (!(err instanceof ClientError) && err.code !== 'ENOENT') throw err;
    console.error(`error: ${err.message}`);
    return 1;
  }
}

// Run only when executed (including through an npm bin link), not when imported.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
