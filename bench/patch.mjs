#!/usr/bin/env node
// `huddle-axi patch` with a log: runs the real CLI with the same stdin, output and exit
// code, and appends each attempt to <board>.patches.jsonl so the benchmark can count
// rejected patches. Usage: node bench/patch.mjs <board.html> < card
import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const board = resolve(process.argv[2] ?? '');
const body = readFileSync(0, 'utf8');
const start = Date.now();
const res = spawnSync(process.execPath, [CLI, 'patch', board, ...process.argv.slice(3)], { input: body, encoding: 'utf8' });
const end = Date.now();
appendFileSync(`${board}.patches.jsonl`, `${JSON.stringify({ start, end, status: res.status, stderr: res.stderr.trim(), body })}\n`);
process.stdout.write(res.stdout);
process.stderr.write(res.stderr);
process.exitCode = res.status ?? 1;
