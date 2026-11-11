#!/usr/bin/env node
// Reads a Claude Code agent transcript (JSONL) from a benchmark run and prints the
// output tokens of each turn that sent a patch, as reported by the API's usage field.
//   node bench/transcript-tokens.mjs <transcript.jsonl>
import { readFileSync } from 'node:fs';

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const turns = new Map(); // message id -> { output, patch }
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const entry = JSON.parse(line);
  const msg = entry.message;
  if (entry.type !== 'assistant' || !msg?.usage) continue;
  // A streamed message can be logged once per content block; keep the last usage seen.
  const turn = turns.get(msg.id) ?? { output: 0, patch: false, poll: false, thinking: false };
  turn.output = msg.usage.output_tokens;
  for (const block of msg.content ?? []) {
    if (block.type === 'thinking') turn.thinking = true;
    if (block.type !== 'tool_use') continue;
    if (/bench\/patch\.mjs/.test(block.input?.command ?? '')) turn.patch = true;
    else if (/ poll /.test(block.input?.command ?? '')) turn.poll = true;
  }
  turns.set(msg.id, turn);
}
const patchTurns = [...turns.values()].filter((t) => t.patch);
const all = [...turns.values()].map((t) => t.output);
console.log(JSON.stringify({
  turns: turns.size,
  patchTurns: patchTurns.length,
  patchTurnsThatThink: patchTurns.filter((t) => t.thinking).length,
  patchTurnsThatAlsoPoll: patchTurns.filter((t) => t.poll).length,
  patchTurnOutputMedian: median(patchTurns.map((t) => t.output)),
  allOutputTotal: all.reduce((a, b) => a + b, 0),
}));
