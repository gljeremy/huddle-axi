#!/usr/bin/env node
// Times a real model working the live loop. This script plays the facilitator: it opens
// a fresh sample board in headless Chrome, waits until the agent is polling, leaves each
// note in bench/tasks.mjs, and times it until the patched card is on screen and saved.
// The agent runs separately and uses poll and bench/patch.mjs (patch with a log).
//
//   node bench/real-model.mjs <toon|html> <results.json>
//
// It prints "ready: <board>" once the agent can start, and writes the results when done.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cardToToon } from '../src/card-model.mjs';
import { stateFile } from '../src/server.mjs';
import { decode } from '../src/toon.mjs';
import { launchBrowser } from '../test/helpers/chrome.mjs';
import { TASKS } from './tasks.mjs';

const [format, outArg] = process.argv.slice(2);
if (!['toon', 'html'].includes(format) || !outArg) {
  console.error('usage: node bench/real-model.mjs <toon|html> <results.json>');
  process.exit(2);
}
const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const dir = mkdtempSync(join(tmpdir(), `huddle-bench-${format}-`));
process.env.HUDDLE_STATE_DIR = join(dir, 'state');
const board = join(dir, 'board.html');
const shellQuote = (path) => `'${path.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
const ROUND_MS = 180_000;

async function waiting() {
  const { port, token } = JSON.parse(readFileSync(stateFile(), 'utf8'));
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { headers: { authorization: `Bearer ${token}` } });
  return (await res.json()).waiting;
}

async function untilPolling(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if ((await waiting()) > 0) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

if (cli('new', board, '--sample').status !== 0) throw new Error('could not make the board');
const opened = cli('open', board, '--no-open');
if (opened.status !== 0) throw new Error(opened.stderr);
const browser = await launchBrowser();
const rounds = [];
try {
  await browser.open(decode(opened.stdout).url);
  await browser.call(() => new Promise((ok) => {
    const check = () => (document.querySelector('.huddle-state')?.textContent.includes('live (connected)') ? ok() : setTimeout(check, 20));
    check();
  }));
  console.log(`Agent shell setup (bash; applies to both poll and patch):\nexport HUDDLE_STATE_DIR=${shellQuote(process.env.HUDDLE_STATE_DIR)}\nnode ${shellQuote(CLI)} poll ${shellQuote(board)} --format ${format}\nnode ${shellQuote(fileURLToPath(new URL('./patch.mjs', import.meta.url)))} ${shellQuote(board)} < card`);
  console.log(`ready: ${board.replace(/\\/g, '/')}`);

  for (const [i, task] of TASKS.entries()) {
    // The first round waits for the agent to start; later rounds for it to come back to poll.
    if (!(await untilPolling(i === 0 ? 15 * 60_000 : ROUND_MS))) {
      rounds.push({ ...task, check: undefined, error: 'the agent was not polling' });
      break;
    }
    const before = await browser.call((id) => ({ html: huddle.get(id), model: huddle.model(id) }), task.card);
    const sent = Date.now();
    // The page times the round itself; the driver only checks in, since each call is short-lived.
    await browser.call((id, note, limit) => {
      const el = () => document.querySelector(`[data-card="${id}"]`);
      const old = huddle.get(id);
      const t0 = Date.now();
      const round = (window.benchRound = { claimed: null, visible: null, done: false });
      huddle.comment(id, note);
      const check = () => {
        const now = Date.now();
        if (round.claimed === null && el().classList.contains('huddle-busy')) round.claimed = now - t0;
        if (round.claimed !== null && !el().classList.contains('huddle-busy') && huddle.get(id) !== old && !huddle.dirty) {
          round.visible = now - t0;
          round.done = true;
        } else if (now - t0 > limit) round.done = true;
        else setTimeout(check, 10);
      };
      check();
    }, task.card, task.note, ROUND_MS);
    let timing;
    while (!(timing = await browser.call(() => window.benchRound)).done) await new Promise((r) => setTimeout(r, 50));
    const after = await browser.call((id) => huddle.get(id), task.card);
    rounds.push({
      card: task.card,
      note: task.note,
      sent,
      claimedMs: timing.claimed,
      visibleMs: timing.visible,
      correct: timing.visible !== null && task.check(after),
      cardIn: { toon: before.model ? cardToToon(before.model) : null, html: before.html },
      after,
    });
    console.log(`${i + 1}/${TASKS.length} ${task.card}: ${timing.visible === null ? 'timed out' : `${timing.visible} ms`}${rounds.at(-1).correct ? '' : ' (check failed)'}`);
    if (timing.visible === null) break;
  }
} finally {
  await browser.close();
  cli('stop');
}

const logFile = `${board}.patches.jsonl`;
const attempts = existsSync(logFile) ? readFileSync(logFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
const assigned = new Set();
for (const r of rounds) {
  if (!r.sent) continue;
  const mine = attempts.filter((a) => a.start >= r.sent && (r.visibleMs === null || a.start <= r.sent + r.visibleMs));
  mine.forEach((a) => assigned.add(a));
  r.attempts = mine.map((a) => ({ startMs: a.start - r.sent, endMs: a.end - r.sent, status: a.status, error: a.stderr || undefined, body: a.body }));
}
const stray = attempts.filter((a) => !assigned.has(a));
writeFileSync(resolve(outArg), `${JSON.stringify({ format, at: new Date().toISOString(), rounds, strayAttempts: stray }, null, 2)}\n`);
console.log(`results: ${resolve(outArg)}`);
