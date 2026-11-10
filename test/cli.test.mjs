// Tests of the `huddle-axi new` command, run as a real process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const tmp = () => mkdtempSync(join(tmpdir(), 'huddle-cli-'));

// The context block is the board's persisted state, so reading it back is reading the contract.
function readContext(file) {
  const html = readFileSync(file, 'utf8');
  const block = html.match(/<script type="application\/json" data-huddle-context>([\s\S]*?)<\/script>/);
  assert.ok(block, 'no context block in the board');
  return JSON.parse(block[1]);
}

test('new writes a board whose context names it and is empty', () => {
  const file = join(tmp(), 'retro.html');
  const res = run('new', file, '--title', 'Retro <Q3>');
  assert.equal(res.status, 0, res.stderr);
  const ctx = readContext(file);
  assert.equal(ctx.format, 'huddle-board');
  assert.equal(ctx.title, 'Retro <Q3>');
  assert.deepEqual(ctx.threads, {});
  assert.deepEqual(ctx.revisions, []);
});

test('new creates missing parent folders', () => {
  const file = join(tmp(), 'a', 'b', 'board.html');
  assert.equal(run('new', file).status, 0);
  assert.equal(readContext(file).format, 'huddle-board');
});

test('new refuses to overwrite a file unless forced', () => {
  const file = join(tmp(), 'board.html');
  writeFileSync(file, 'keep me');
  const refused = run('new', file);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /already exists/);
  assert.equal(readFileSync(file, 'utf8'), 'keep me');
  assert.equal(run('new', file, '--force').status, 0);
  assert.equal(readContext(file).format, 'huddle-board');
});

test('bad usage exits 2 with the usage text', () => {
  for (const args of [[], ['new'], ['poll'], ['stop', 'x.html'], ['publish', 'x.html'], ['new', 'x.html', '--colour'], ['new', 'x.html', '--title']]) {
    const res = run(...args);
    assert.equal(res.status, 2, `huddle-axi ${args.join(' ')}`);
    assert.match(res.stderr, /usage|--title needs a value/);
  }
});
