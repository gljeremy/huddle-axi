#!/usr/bin/env node
// Times stock Lavish's reload path: file saved -> iframe reloaded -> layout gate lifted.
// Usage: node bench/measure-reload.mjs <lavish session url> <artifact file> [runs] [browser exe]
// Runs a headless browser so requestAnimationFrame works (a hidden pane stalls the layout gate).
// Each run appends a hidden marker to the file, so content changes but layout doesn't.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [, , url, file, runsArg = '5', browser = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'] = process.argv;
if (!url || !file) {
  console.error('usage: node bench/measure-reload.mjs <session url> <artifact file> [runs] [browser exe]');
  process.exit(2);
}
const runs = Number(runsArg);
const port = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const original = readFileSync(file, 'utf8');
const results = [];
let proc;
let ws;
try {
  const profile = mkdtempSync(join(tmpdir(), 'huddle-bench-'));
  proc = spawn(browser, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1280,800', url], { stdio: 'ignore' });
  let browserError;
  proc.on('error', (error) => { browserError = error; });

  let target;
  for (let i = 0; i < 75 && !target; i++) {
    await sleep(200);
    if (browserError) throw browserError;
    if (proc.exitCode !== null || proc.signalCode !== null) throw new Error('headless browser exited');
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })).json();
      target = list.find((t) => t.type === 'page' && t.url.includes('/session/'));
    } catch {
      // browser not listening yet
    }
  }
  if (!target) throw new Error('headless browser never opened the session page');

  ws = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  const disconnected = () => {
    for (const request of pending.values()) request.reject(new Error('CDP connection closed or failed'));
  };
  ws.addEventListener('close', disconnected);
  ws.addEventListener('error', disconnected);
  await new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      ws.removeEventListener('open', opened);
      ws.removeEventListener('error', failed);
      ws.removeEventListener('close', failed);
      if (error) reject(error); else resolve();
    };
    const opened = () => finish();
    const failed = () => finish(new Error('CDP connection failed'));
    const timer = setTimeout(() => finish(new Error('CDP connection timed out')), 5000);
    ws.addEventListener('open', opened);
    ws.addEventListener('error', failed);
    ws.addEventListener('close', failed);
  });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) pending.get(m.id).resolve(m);
  };
  const send = (method, params = {}, timeout = 5000) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error('CDP connection is not open'));
    const id = ++nextId;
    const finish = (error, value) => {
      clearTimeout(timer);
      pending.delete(id);
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(`CDP ${method} timed out`)), timeout);
    pending.set(id, { resolve: (value) => finish(null, value), reject: (error) => finish(error) });
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      finish(error);
    }
  });
  const evaluate = async (expression, timeout) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout)).result?.result?.value;

  // Wait for the first load to finish before arming the observers.
  for (let i = 0; i < 150; i++) {
    if (await evaluate(`!!document.getElementById('layoutGateOverlay')?.hidden && !!document.getElementById('artifact')`)) break;
    await sleep(100);
  }
  await evaluate(`(() => {
    window.__ev = [];
    const g = document.getElementById('layoutGateOverlay'), f = document.getElementById('artifact');
    new MutationObserver(() => __ev.push({ t: Date.now(), e: g.hidden ? 'gate-off' : 'gate-on' })).observe(g, { attributes: true, attributeFilter: ['hidden'] });
    new MutationObserver(() => __ev.push({ t: Date.now(), e: 'src-change' })).observe(f, { attributes: true, attributeFilter: ['src'] });
    f.addEventListener('load', () => __ev.push({ t: Date.now(), e: 'frame-load' }));
  })()`);

  for (let i = 0; i < runs; i++) {
    await evaluate('window.__ev.length = 0');
    writeFileSync(file, original.replace('</main>', `<p hidden data-bench="${i}-${Date.now()}"></p>\n</main>`));
    const saved = Date.now();
    let ev = [];
    let settled = false;
    const deadline = saved + 15_000;
    while (Date.now() < deadline && !settled) {
      await sleep(Math.min(50, deadline - Date.now()));
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      ev = await evaluate('window.__ev', Math.min(5000, remaining));
      const loaded = ev.some((x) => x.e === 'frame-load');
      const gateOn = ev.some((x) => x.e === 'gate-on');
      settled = loaded && (!gateOn || ev.at(-1).e === 'gate-off');
    }
    const first = (name) => ev.find((x) => x.e === name)?.t;
    const last = (name) => ev.findLast((x) => x.e === name)?.t;
    const shown = last('gate-off') ?? last('frame-load');
    const visibleMs = shown - saved;
    // A gate that lifts at its max hold (12 s) timed out rather than passing; flag it.
    const note = !settled ? 'never settled (15 s)' : !ev.some((x) => x.e === 'gate-on') ? 'gate never shown' : visibleMs >= 11_900 ? 'gate hit max hold' : '';
    results.push({ run: i + 1, reloadStartsMs: first('src-change') - saved, frameLoadedMs: last('frame-load') - saved, visibleMs, note });
    await sleep(1500);
  }
} finally {
  try {
    writeFileSync(file, original);
  } finally {
    try {
      ws?.close();
    } finally {
      proc?.kill();
    }
  }
}
console.table(results);
const clean = results.filter((r) => !r.note && Number.isFinite(r.visibleMs));
const visible = clean.map((r) => r.visibleMs).sort((a, b) => a - b);
const middle = Math.floor(visible.length / 2);
const median = visible.length === 0 ? 'n/a' : visible.length % 2 ? visible[middle] : (visible[middle - 1] + visible[middle]) / 2;
console.log(`median save -> visible: ${median} ms over ${clean.length} clean runs of ${runs}`);
if (clean.length < results.length) process.exitCode = 1;
