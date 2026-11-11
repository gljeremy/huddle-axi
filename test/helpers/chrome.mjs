// Minimal headless Chrome/Edge driver over CDP, using only Node 22 built-ins.
// Set HUDDLE_BROWSER to a browser executable to override auto-detection.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = {
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function findBrowser() {
  return process.env.HUDDLE_BROWSER || (CANDIDATES[process.platform] || []).find((p) => existsSync(p));
}

function connect(url) {
  const ws = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const listeners = new Map();
  const fail = (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`CDP ${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners.get(msg.method) || []) fn(msg.params);
    }
  });
  ws.addEventListener('close', () => fail(new Error('CDP connection closed')));
  const client = {
    send(method, params = {}, timeout = 10_000) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP ${method} timed out`));
        }, timeout);
        pending.set(id, {
          method,
          resolve: (v) => { clearTimeout(timer); resolve(v); },
          reject: (e) => { clearTimeout(timer); reject(e); },
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    on(method, fn) {
      if (!listeners.has(method)) listeners.set(method, new Set());
      listeners.get(method).add(fn);
      return () => listeners.get(method).delete(fn);
    },
    once(method, timeout = 10_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { off(); reject(new Error(`timed out waiting for ${method}`)); }, timeout);
        const off = client.on(method, (params) => { clearTimeout(timer); off(); resolve(params); });
      });
    },
    close: () => ws.close(),
  };
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(client), { once: true });
    ws.addEventListener('error', () => reject(new Error(`could not connect to ${url}`)), { once: true });
  });
}

export async function launchBrowser() {
  const exe = findBrowser();
  if (!exe) throw new Error('No Chrome or Edge found. Set HUDDLE_BROWSER to a browser executable.');
  const profile = mkdtempSync(join(tmpdir(), 'huddle-test-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'];
  // GitHub's Ubuntu runners block Chrome's user-namespace sandbox; the pages under test are local fixtures.
  if (process.platform === 'linux' && process.env.CI) args.unshift('--no-sandbox');
  const proc = spawn(exe, args, { stdio: 'ignore' });

  const shutdown = async () => {
    proc.kill();
    await sleep(300);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // a locked profile dir in the OS temp folder is harmless
    }
  };

  try {
    const portFile = join(profile, 'DevToolsActivePort');
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      await sleep(100);
      if (proc.exitCode !== null) throw new Error(`browser exited with code ${proc.exitCode}`);
      if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]) || undefined;
    }
    if (!port) throw new Error('browser did not open a debugging port');
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('browser has no page target');
    const cdp = await connect(page.webSocketDebuggerUrl);
    const errors = [];
    cdp.on('Runtime.exceptionThrown', (p) => errors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text));
    cdp.on('Runtime.consoleAPICalled', (p) => {
      if (p.type === 'error') errors.push(p.args.map((a) => a.value ?? a.description).join(' '));
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    return {
      errors,
      async open(url) {
        errors.length = 0;
        const loaded = cdp.once('Page.loadEventFired');
        await cdp.send('Page.navigate', { url });
        await loaded;
      },
      // Runs fn(...args) in the page and returns its JSON-serializable result.
      async call(fn, ...args) {
        const res = await cdp.send('Runtime.evaluate', {
          expression: `(${fn})(...${JSON.stringify(args)})`,
          awaitPromise: true,
          returnByValue: true,
        });
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text);
        }
        return res.result.value;
      },
      // A PNG of the whole page, for looking at a layout by eye.
      async screenshot() {
        const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        return Buffer.from(data, 'base64');
      },
      async close() {
        cdp.close();
        await shutdown();
      },
    };
  } catch (err) {
    await shutdown();
    throw err;
  }
}
