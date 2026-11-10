// The live agent loop end to end: a real board in headless Chrome, the real CLI and
// server, and a scripted agent that edits the card the way a model would.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../src/toon.mjs';
import { launchBrowser } from './helpers/chrome.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'huddle-loop-'));
// Keep this test's server apart from any real one on the machine.
const env = { ...process.env, HUDDLE_STATE_DIR: join(dir, 'state') };
const board = join(dir, 'board.html');
const squash = (html) => html.replace(/>\s+</g, '><').trim();

const runSync = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
function run(args, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(input ?? '');
  });
}

// The browser writes the marker attribute back as data-huddle-context="".
const fileContext = () => JSON.parse(readFileSync(board, 'utf8').match(/<script type="application\/json" data-huddle-context(?:="")?>([\s\S]*?)<\/script>/)[1]);

let browser;
let url;

before(async () => {
  assert.equal(runSync('new', board, '--sample').status, 0);
  const opened = runSync('open', board, '--no-open');
  assert.equal(opened.status, 0, opened.stderr);
  url = decode(opened.stdout).url;
  browser = await launchBrowser();
  await browser.open(url);
  await browser.call(() => new Promise((ok) => {
    const check = () => (document.querySelector('.huddle-state')?.textContent.includes('live (connected)') ? ok() : setTimeout(check, 20));
    check();
  }));
});

after(async () => {
  await browser?.close();
  runSync('stop');
});

test('a note reaches the agent, and the agent rewrites the card in place', async (t) => {
  await browser.call(() => { window.notReloaded = true; });
  const cardFile = join(dir, 'c5.toon');
  const started = Date.now();
  const polling = run(['poll', board, '--out', cardFile, '--timeout-ms', '20000']);
  await browser.call(() => huddle.comment('c5', 'We picked the wizard. Mark it decided.'));
  const polled = await polling;
  const noteMs = Date.now() - started;
  assert.equal(polled.status, 0, polled.stderr);
  const head = decode(polled.stdout);
  assert.equal(head.note, 'We picked the wizard. Mark it decided.');
  assert.equal(head.card, 'c5');
  assert.equal(head.board, 'Q3 onboarding redesign');
  assert.equal(head.format, 'toon');
  assert.deepEqual(head.thread, []);

  const busy = await browser.call(() => new Promise((ok) => {
    const start = Date.now();
    const check = () => (huddle.get('c5') && document.querySelector('[data-card="c5"]').classList.contains('huddle-busy') ? ok(true) : Date.now() - start > 3000 ? ok(false) : setTimeout(check, 20));
    check();
  }));
  assert.ok(busy, 'the card shows the agent is working on it');

  // The agent's edit: two targeted string changes, the way a model would use an edit tool.
  const original = readFileSync(cardFile, 'utf8');
  const row = '  Progressive wizard,"Three short steps, skippable, resumable later",5,false';
  assert.ok(original.split('\n').includes('status: open') && original.split('\n').includes(row), original);
  const edited = original.replace('status: open', 'status: decided').replace(row, row.replace(/false$/, 'true'));
  writeFileSync(cardFile, edited);

  const patchStarted = Date.now();
  const patched = await run(['patch', board, '--card-file', cardFile, '--note', 'decided: wizard']);
  const patchMs = Date.now() - patchStarted;
  assert.equal(patched.status, 0, patched.stderr);
  assert.deepEqual(decode(patched.stdout), { patched: 'c5', saved: true });

  const dom = await browser.call(() => {
    const el = document.querySelector('[data-card="c5"]');
    return { status: el.dataset.status, chosen: el.querySelector('li[data-chosen]')?.firstChild.textContent, busy: el.classList.contains('huddle-busy'), notReloaded: window.notReloaded === true };
  });
  assert.deepEqual(dom, { status: 'decided', chosen: 'Progressive wizard', busy: false, notReloaded: true });

  const ctx = fileContext();
  assert.equal(ctx.threads.c5[0].text, 'We picked the wizard. Mark it decided.', 'the note is saved in the file');
  assert.deepEqual(ctx.revisions.at(-1), { ...ctx.revisions.at(-1), card: 'c5', op: 'patch', by: 'agent', note: 'decided: wizard' });
  assert.match(readFileSync(board, 'utf8'), /<section data-card="c5" data-kind="decision" data-status="decided">/);
  t.diagnostic(`note to agent: ${noteMs} ms; patch to visible and saved: ${patchMs} ms`);
});

test('a second note on the card carries the earlier thread', async () => {
  const polling = run(['poll', board, '--timeout-ms', '20000']);
  await browser.call(() => huddle.comment('c5', 'Add who owns the wizard.'));
  const polled = await polling;
  const [head, card] = polled.stdout.split('\n---\n');
  assert.deepEqual(decode(head).thread, [{ who: 'facilitator', text: 'We picked the wizard. Mark it decided.' }]);
  assert.match(card, /^status: decided$/m, 'the card is printed as it is now');
});

test('every sample card fits the card model and re-renders to the same markup', async () => {
  const { cardToHtml } = await import('../src/card-model.mjs');
  const cards = await browser.call(() => huddle.cards().map((c) => ({ id: c.id, model: huddle.model(c.id), html: huddle.get(c.id) })));
  assert.equal(cards.length, 16);
  const rendered = cards.map(({ id, model }) => {
    assert.ok(model, `${id} fits the model`);
    return cardToHtml(model);
  });
  // Let the browser serialize both sides, so data-chosen and data-chosen="" compare equal.
  const reparsed = await browser.call((list) => list.map((h) => {
    const t = document.createElement('template');
    t.innerHTML = h;
    return t.innerHTML;
  }), rendered);
  cards.forEach(({ id, html }, k) => assert.equal(squash(reparsed[k]), squash(html), id));
});

test('a card that does not fit the model is handed to the agent as HTML', async () => {
  await browser.call(() => huddle.patch('<section data-card="c13" data-kind="note"><h3>Live chat</h3><ul><li>one</li></ul><p>after the list</p></section>'));
  const polling = run(['poll', board, '--timeout-ms', '20000']);
  await browser.call(() => huddle.comment('c13', 'Tidy this up.'));
  const [head, card] = (await polling).stdout.split('\n---\n');
  assert.equal(decode(head).format, 'html');
  assert.equal(squash(card), '<section data-card="c13" data-kind="note"><h3>Live chat</h3><ul><li>one</li></ul><p>after the list</p></section>');
  const patched = await run(['patch', board], '<section data-card="c13" data-kind="note"><h3>Live chat</h3><p>Tidied.</p></section>');
  assert.equal(patched.status, 0, patched.stderr);
});

test('a bad patch is refused with a reason the agent can fix, and nothing changes', async () => {
  const before = await browser.call(() => huddle.get('c6'));
  const syntax = await run(['patch', board], 'id: c6\nkind: decision\ntitle: x\nbody[2]: only one');
  assert.equal(syntax.status, 1);
  assert.match(syntax.stderr, /line 4: body\[2\] declares 2 values but has 1/);
  const rules = await run(['patch', board], '<section data-card="c6" data-kind="note"><h3>x</h3><script>alert(1)</script></section>');
  assert.equal(rules.status, 1);
  assert.match(rules.stderr, /<script> is not allowed in a note card/);
  const missing = await run(['patch', board], 'id: c99\nkind: note\ntitle: x');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /there is no card #c99/);
  assert.equal(await browser.call(() => huddle.get('c6')), before);
});

test('poll times out cleanly when the facilitator is quiet', async () => {
  const res = await run(['poll', board, '--timeout-ms', '150']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(decode(res.stdout).status, 'timeout');
});

test('patching a board no browser has open says so', async () => {
  const other = join(dir, 'other.html');
  runSync('new', other);
  assert.equal(runSync('open', other, '--no-open').status, 0);
  const res = await run(['patch', other], 'id: c1\nkind: note\ntitle: x');
  assert.equal(res.status, 1);
  assert.match(res.stderr, /no browser has .*other\.html open/);
});

test('the server only talks to its own clients', async () => {
  const { port, token } = JSON.parse(readFileSync(join(env.HUDDLE_STATE_DIR, 'server.json'), 'utf8'));
  const id = new URL(url).pathname.split('/')[2];
  const hit = (path, { method = 'POST', headers = {}, body = '{}' } = {}) => new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => ok(res.statusCode));
    });
    req.on('error', fail);
    req.end(method === 'GET' ? undefined : body);
  });
  assert.equal(await hit('/api/poll', { body: JSON.stringify({ file: board, timeoutMs: 10 }) }), 401, 'agent endpoints need the token');
  assert.equal(await hit('/api/health', { method: 'GET', headers: { authorization: `Bearer ${token}`, host: 'evil.example:80' } }), 421, 'other host names are refused');
  assert.equal(await hit(`/b/${id}/note`, { headers: { 'content-type': 'text/plain' }, body: '{"card":"c1","text":"x"}' }), 415, 'form-style posts are refused');
  assert.equal(await hit(`/b/${'0'.repeat(32)}/`, { method: 'GET' }), 404, 'unknown sessions are not served');
});

test('stop shuts the server down', () => {
  const res = runSync('stop');
  assert.deepEqual(decode(res.stdout), { stopped: true });
  assert.equal(existsSync(join(env.HUDDLE_STATE_DIR, 'server.json')), false);
});
