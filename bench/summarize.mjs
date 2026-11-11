#!/usr/bin/env node
// Prints the tables for bench/REAL-MODEL.md from the results real-model.mjs wrote.
//   node bench/summarize.mjs bench/real-model-toon.json bench/real-model-html.json
import { readFileSync } from 'node:fs';

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN;
};
const sec = (ms) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '–');
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const rows = [];
for (const file of process.argv.slice(2)) {
  const { format, rounds } = JSON.parse(readFileSync(file, 'utf8'));
  const done = rounds.filter((r) => r.visibleMs !== null && r.visibleMs !== undefined);
  const visible = done.map((r) => r.visibleMs);
  // Model time: from the poll handing over the note to the agent's first patch attempt.
  const think = done.filter((r) => r.attempts?.length).map((r) => r.attempts[0].startMs - r.claimedMs);
  const attempts = rounds.flatMap((r) => r.attempts ?? []);
  const failed = attempts.filter((a) => a.status !== 0);
  const cardIn = done.map((r) => (format === 'toon' ? r.cardIn.toon ?? r.cardIn.html : r.cardIn.html).length);
  const cardOut = done.flatMap((r) => (r.attempts ?? []).filter((a) => a.status === 0).map((a) => a.body.length));
  rows.push({
    format,
    rounds: `${done.length}/${rounds.length}`,
    correct: done.filter((r) => r.correct).length,
    under8: visible.filter((v) => v < 8000).length,
    median: sec(median(visible)),
    p90: sec(pct(visible, 90)),
    max: sec(Math.max(...visible)),
    pickup: `${Math.round(median(done.map((r) => r.claimedMs)))} ms`,
    think: sec(median(think)),
    applied: sec(median(done.filter((r) => r.attempts?.length).map((r) => r.visibleMs - r.attempts.at(-1).startMs))),
    attempts: attempts.length,
    failed: failed.length,
    failedRounds: rounds.filter((r) => r.attempts?.some((a) => a.status !== 0)).length,
    cardIn: Math.round(median(cardIn)),
    cardOut: Math.round(median(cardOut)),
    errors: failed.map((a) => a.error.split('\n')[0]),
  });
}

const table = (head, pick) => [
  `| | ${rows.map((r) => r.format.toUpperCase()).join(' | ')} |`,
  `| --- | ${rows.map(() => '---').join(' | ')} |`,
  ...head.map(([label, key]) => `| ${label} | ${rows.map((r) => pick(r, key)).join(' | ')} |`),
].join('\n');

console.log(table([
  ['Rounds finished', 'rounds'],
  ['Edits that did what the note asked', 'correct'],
  ['Note to visible under 8 s', 'under8'],
  ['Note to visible, median', 'median'],
  ['Note to visible, 90th percentile', 'p90'],
  ['Note to visible, slowest', 'max'],
  ['Note reaches the agent (median)', 'pickup'],
  ['Agent writes the patch (median)', 'think'],
  ['Patch sent to visible and saved (median)', 'applied'],
], (r, k) => r[k]));
console.log();
console.log(table([
  ['Patch attempts', 'attempts'],
  ['Rejected patches', 'failed'],
  ['Rounds with a rejected patch', 'failedRounds'],
  ['Card handed to the agent, median characters', 'cardIn'],
  ['Card sent back, median characters', 'cardOut'],
], (r, k) => r[k]));
for (const r of rows) for (const e of r.errors) console.log(`${r.format} rejection: ${e}`);
