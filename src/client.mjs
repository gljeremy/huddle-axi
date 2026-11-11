// The CLI's side of the live-session server: find it (or start it) and call it.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { stateFile } from './server.mjs';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));

export class ClientError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function readState() {
  try {
    return JSON.parse(readFileSync(stateFile(), 'utf8'));
  } catch {
    return null;
  }
}

// Plain node:http rather than fetch: a long poll can outlast fetch's built-in header timeout.
export function call(state, path, body, { method = 'POST', timeoutMs = 0 } = {}) {
  return new Promise((ok, fail) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request({
      host: '127.0.0.1',
      port: state.port,
      path,
      method,
      headers: { authorization: `Bearer ${state.token}`, ...(data ? { 'content-type': 'application/json' } : {}) },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let out = {};
        try {
          out = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {}
        if (res.statusCode >= 400) fail(new ClientError(out.error || `HTTP ${res.statusCode}`, res.statusCode));
        else ok(out);
      });
    });
    if (timeoutMs) req.setTimeout(timeoutMs, () => req.destroy(new ClientError('the huddle server did not answer')));
    req.on('error', (err) => fail(err instanceof ClientError ? err : new ClientError(`cannot reach the huddle server: ${err.message}`)));
    req.end(data);
  });
}

async function healthy(state) {
  if (!state) return false;
  try {
    await call(state, '/api/health', undefined, { method: 'GET', timeoutMs: 1500 });
    return true;
  } catch {
    return false;
  }
}

// The running server, or null.
export async function findServer() {
  const state = readState();
  return (await healthy(state)) ? state : null;
}

export async function ensureServer() {
  const existing = await findServer();
  if (existing) return existing;
  const child = spawn(process.execPath, [SERVER], { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
    const state = readState();
    if (state?.pid === child.pid && (await healthy(state))) return state;
  }
  throw new ClientError('the huddle server did not start');
}

export function openInBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}
