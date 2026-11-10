#!/usr/bin/env node
// The live-session server. It serves boards to the facilitator's browser, queues the
// facilitator's notes for the agent, and relays the agent's card patches back.
// The browser stays the source of truth: it applies every patch, then sends the whole
// file back, and the server writes that to disk.
//
// Agent side (token in the state file):   POST /api/open, /api/poll, /api/patch, /api/stop
// Browser side (the session id is secret): GET /b/<id>/, /b/<id>/events; POST /b/<id>/save, note, ack
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CardError, ToonError, cardToHtml, toonToCard } from './card-model.mjs';

export const stateDir = () => process.env.HUDDLE_STATE_DIR || join(tmpdir(), 'huddle-axi');
export const stateFile = () => join(stateDir(), 'server.json');

const MAX_BODY = 20 * 1024 * 1024;
const ACK_MS = 10_000;
const IDLE_MS = 4 * 60 * 60 * 1000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function readBody(req) {
  return new Promise((ok, fail) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, 'request is too large'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        ok(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        fail(new HttpError(400, 'body is not JSON'));
      }
    });
    req.on('error', fail);
  });
}

const send = (res, status, body) => {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

// Rename over the old file so a reader never sees half a board. Windows can briefly
// refuse the rename while another process has the file open, so retry a little.
async function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        rmSync(tmp, { force: true });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)));
    }
  }
}

// Turns what the agent sent into one card's HTML. TOON is the default; markup is accepted as-is.
export function patchBodyToHtml(body) {
  const text = String(body ?? '').trim();
  if (!text) throw new HttpError(400, 'the patch is empty');
  if (text.startsWith('<')) return text;
  try {
    return cardToHtml(toonToCard(text));
  } catch (err) {
    if (err instanceof ToonError || err instanceof CardError) throw new HttpError(422, err.message);
    throw err;
  }
}

export function startServer({ port = 0, token = randomBytes(16).toString('hex'), idleMs = IDLE_MS } = {}) {
  const sessions = new Map(); // id -> session
  const byFile = new Map(); // absolute path -> session
  let idleTimer;

  const session = (file) => {
    const s = byFile.get(file);
    if (!s) throw new HttpError(404, `${file} is not open; run huddle-axi open ${file}`);
    return s;
  };

  function openSession(file) {
    let s = byFile.get(file);
    if (!s) {
      s = { id: randomBytes(16).toString('hex'), file, clients: new Set(), notes: [], pollers: [], acks: new Map(), nextReq: 1 };
      sessions.set(s.id, s);
      byFile.set(file, s);
    }
    return s;
  }

  function emit(s, event, data) {
    // The facilitator works in one tab; the newest connection is that tab.
    const client = [...s.clients].pop();
    if (!client) return false;
    client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  }

  function deliver(s) {
    while (s.notes.length && s.pollers.length) {
      const poller = s.pollers.shift();
      if (poller.res.destroyed) continue;
      clearTimeout(poller.timer);
      const note = s.notes.shift();
      send(poller.res, 200, { note });
      emit(s, 'claimed', { card: note.card });
    }
  }

  async function api(req, res, url) {
    if (req.headers.authorization !== `Bearer ${token}`) throw new HttpError(401, 'bad or missing token');
    if (url.pathname === '/api/health') return send(res, 200, { ok: true, pid: process.pid, sessions: sessions.size });
    if (req.method !== 'POST') throw new HttpError(405, 'use POST');
    const body = await readBody(req);
    const file = typeof body.file === 'string' ? resolve(body.file) : null;
    switch (url.pathname) {
      case '/api/open': {
        if (!file) throw new HttpError(400, 'file is required');
        readFileSync(file); // fail now, with the real error, if it cannot be read
        const s = openSession(file);
        return send(res, 200, { id: s.id, url: `http://127.0.0.1:${server.address().port}/b/${s.id}/` });
      }
      case '/api/poll': {
        const s = session(file);
        const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 0, 0), 60 * 60 * 1000);
        const poller = { res, timer: setTimeout(() => {
          s.pollers = s.pollers.filter((p) => p !== poller);
          send(res, 200, { note: null });
        }, timeoutMs) };
        s.pollers.push(poller);
        res.on('close', () => {
          clearTimeout(poller.timer);
          s.pollers = s.pollers.filter((p) => p !== poller);
        });
        return deliver(s);
      }
      case '/api/patch': {
        const s = session(file);
        const html = patchBodyToHtml(body.body);
        if (!s.clients.size) throw new HttpError(409, `no browser has ${file} open; run huddle-axi open ${file}`);
        const reqId = s.nextReq++;
        const result = new Promise((ok) => {
          const timer = setTimeout(() => {
            s.acks.delete(reqId);
            ok({ status: 504, body: { error: 'the board did not answer; is it still open in the browser?' } });
          }, ACK_MS);
          s.acks.set(reqId, (ack) => {
            clearTimeout(timer);
            ok(ack.ok ? { status: 200, body: { card: ack.card, saved: ack.saved === true } } : { status: 422, body: { error: String(ack.error) } });
          });
        });
        emit(s, 'patch', { reqId, html, note: typeof body.note === 'string' ? body.note : undefined });
        const { status, body: out } = await result;
        return send(res, status, out);
      }
      case '/api/stop':
        send(res, 200, { stopped: true });
        return stop();
      default:
        throw new HttpError(404, 'no such endpoint');
    }
  }

  async function browser(req, res, s, action) {
    if (req.method === 'GET' && action === '') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(readFileSync(s.file));
    }
    if (req.method === 'GET' && action === 'events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write(': connected\n\n');
      s.clients.add(res);
      req.on('close', () => s.clients.delete(res));
      return;
    }
    if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');
    // A JSON content type makes cross-site form posts impossible without a CORS preflight, which we never grant.
    if (!String(req.headers['content-type']).startsWith('application/json')) throw new HttpError(415, 'send JSON');
    const body = await readBody(req);
    switch (action) {
      case 'save': {
        if (typeof body.html !== 'string' || !/^<!doctype html>/i.test(body.html)) throw new HttpError(400, 'html must be a whole board');
        await writeAtomic(s.file, body.html);
        return send(res, 200, { saved: true });
      }
      case 'note': {
        if (typeof body.card !== 'string' || typeof body.text !== 'string') throw new HttpError(400, 'card and text are required');
        s.notes.push({
          card: body.card,
          text: body.text,
          model: body.model ?? null,
          html: typeof body.html === 'string' ? body.html : null,
          thread: Array.isArray(body.thread) ? body.thread : [],
          board: { title: String(body.title ?? ''), brief: String(body.brief ?? '') },
          at: new Date().toISOString(),
        });
        deliver(s);
        return send(res, 200, { queued: true });
      }
      case 'ack': {
        const settle = s.acks.get(body.reqId);
        if (settle) {
          s.acks.delete(body.reqId);
          settle(body);
        }
        return send(res, 200, { ok: true });
      }
      default:
        throw new HttpError(404, 'no such endpoint');
    }
  }

  const server = createServer(async (req, res) => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs).unref();
    try {
      // Only answer to our own address, so a page on another site cannot reach us through DNS rebinding.
      const port = server.address().port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw new HttpError(421, 'wrong host');
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      const m = url.pathname.match(/^\/b\/([a-f0-9]{32})\/([a-z]*)$/);
      const s = m && sessions.get(m[1]);
      if (!s) throw new HttpError(404, 'no such board');
      return await browser(req, res, s, m[2]);
    } catch (err) {
      // Read any unread body to its end first; answering mid-upload resets the client's connection.
      if (!req.readableEnded && !req.destroyed) {
        await new Promise((done) => {
          req.on('end', done).on('error', done).on('close', done).resume();
        });
      }
      send(res, err.status ?? 500, { error: err.message });
    }
  });

  function stop() {
    for (const s of sessions.values()) for (const c of s.clients) c.end();
    server.close();
    server.closeAllConnections?.();
  }

  server.listen(port, '127.0.0.1');
  return { server, token, stop };
}

// Run as the detached background server: listen, then publish where we are.
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const { server, token } = startServer({ port: Number(process.env.HUDDLE_PORT) || 0 });
  server.on('listening', () => {
    mkdirSync(dirname(stateFile()), { recursive: true, mode: 0o700 });
    writeFileSync(stateFile(), JSON.stringify({ port: server.address().port, pid: process.pid, token }), { mode: 0o600 });
  });
  server.on('close', () => {
    try {
      const state = JSON.parse(readFileSync(stateFile(), 'utf8'));
      if (state.pid === process.pid) rmSync(stateFile(), { force: true });
    } catch {}
  });
}
