import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
