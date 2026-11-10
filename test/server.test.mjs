import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmodSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server.mjs';

test('cancelled polls preserve notes without claiming them', async (t) => {
  for (const completion of ['ack', 'timeout']) {
    await t.test(completion, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'huddle-delivery-'));
      const file = join(dir, 'board.html');
      writeFileSync(file, '<!doctype html><title>Delivery</title>');
      const { server, token, stop } = startServer();
      const streamController = new AbortController();
      try {
        await once(server, 'listening');
        const base = `http://127.0.0.1:${server.address().port}`;
        const post = (url, body, options = {}) => fetch(url, {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
          body: JSON.stringify(body), ...options,
        });
        const opened = await post(`${base}/api/open`, { file });
        const { url } = await opened.json();
        const stream = await fetch(`${url}events`, { signal: AbortSignal.any([streamController.signal, AbortSignal.timeout(10_000)]) });
        const reader = stream.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const nextEvent = async () => {
          while (true) {
            const boundary = buffer.indexOf('\n\n');
            if (boundary !== -1) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              if (!block.startsWith('event: ')) continue;
              const [event, data] = block.split('\n');
              return { event: event.slice(7), data: JSON.parse(data.slice(6)) };
            }
            const chunk = await reader.read();
            assert.equal(chunk.done, false);
            buffer += decoder.decode(chunk.value, { stream: true });
          }
        };
        const queued = { card: 'c1', text: 'Keep this note', model: { id: 'c1', kind: 'note', title: 'Original' }, html: '<section data-card="c1" data-kind="note"><h3>Original</h3></section>' };
        assert.equal((await post(`${url}note`, queued)).status, 200);
        let responseClosed;
        const closed = new Promise((ok) => { responseClosed = ok; });
        server.once('request', (req, res) => res.once('close', responseClosed));
        const cancelled = new AbortController();
        const first = post(`${base}/api/poll`, { file, timeoutMs: 5000 }, { signal: cancelled.signal }).catch((err) => err);
        const snapshot = await nextEvent();
        assert.equal(snapshot.event, 'snapshot');
        cancelled.abort();
        await first;
        await closed;
        const second = post(`${base}/api/poll`, { file, timeoutMs: 5000 }).catch((err) => err);
        if (completion === 'ack') {
          assert.equal((await post(`${url}ack`, { reqId: snapshot.data.reqId, ok: true, model: queued.model, html: queued.html, thread: [] })).status, 200);
        }
        const retry = await nextEvent();
        assert.equal(retry.event, 'snapshot', 'an undelivered note must not emit claimed');
        const fresh = { id: 'c1', kind: 'note', title: 'Current' };
        assert.equal((await post(`${url}ack`, { reqId: retry.data.reqId, ok: true, model: fresh, html: '<section data-card="c1" data-kind="note"><h3>Current</h3></section>', thread: [] })).status, 200);
        const response = await second;
        assert.equal(response.status, 200);
        const { note } = await response.json();
        assert.equal(note.text, 'Keep this note');
        assert.deepEqual(note.model, fresh);
        assert.equal((await nextEvent()).event, 'claimed');
        const empty = await post(`${base}/api/poll`, { file, timeoutMs: 10 });
        assert.deepEqual(await empty.json(), { note: null }, 'the restored note is delivered exactly once');
      } finally {
        streamController.abort();
        stop();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});

test('filesystem errors stay local to the request and atomic saves preserve access', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'huddle-files-'));
  const file = join(dir, 'board.html');
  const original = '<!doctype html><title>Original</title>';
  const updated = '<!doctype html><title>Updated</title>';
  writeFileSync(file, original);
  const { server, token, stop } = startServer();
  try {
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = (url, body) => fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
    });
    const opened = await post(`${base}/api/open`, { file });
    assert.equal(opened.status, 200);
    const { url } = await opened.json();

    await t.test('a missing board returns an error without losing its session or queued notes', async () => {
      assert.equal((await post(`${url}note`, { card: 'c1', text: 'Keep queued work' })).status, 200);
      renameSync(file, `${file}.backup`);
      const failed = await fetch(url, { signal: AbortSignal.timeout(5000) });
      assert.equal(failed.status, 500);
      assert.match((await failed.json()).error, /ENOENT/);
      const health = await fetch(`${base}/api/health`, { headers: { authorization: `Bearer ${token}` } });
      assert.equal(health.status, 200);
      assert.equal((await health.json()).sessions, 1);
      const poll = await post(`${base}/api/poll`, { file, timeoutMs: 100 });
      assert.equal((await poll.json()).note.text, 'Keep queued work');
      renameSync(`${file}.backup`, file);
      const restored = await fetch(url);
      assert.equal(restored.status, 200);
      assert.equal(await restored.text(), original);
    });

    await t.test('saving a private board never broadens its POSIX permissions', { skip: process.platform === 'win32' }, async () => {
      for (const mode of [0o600, 0o640]) {
        chmodSync(file, mode);
        const saved = await post(`${url}save`, { html: updated });
        assert.equal(saved.status, 200);
        assert.deepEqual(await saved.json(), { saved: true });
        assert.equal(statSync(file).mode & 0o777, mode & ~process.umask());
        assert.equal(readFileSync(file, 'utf8'), updated);
      }
    });

    await t.test('saving recreates a missing board with default permissions', async () => {
      rmSync(file);
      const saved = await post(`${url}save`, { html: updated });
      assert.equal(saved.status, 200);
      assert.deepEqual(await saved.json(), { saved: true });
      assert.equal(readFileSync(file, 'utf8'), updated);
      if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o666 & ~process.umask());
      const served = await fetch(url);
      assert.equal(served.status, 200);
      assert.equal(await served.text(), updated);
    });
  } finally {
    stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
