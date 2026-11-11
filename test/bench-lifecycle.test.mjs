import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const BENCH = fileURLToPath(new URL('../bench/real-model.mjs', import.meta.url));
const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const CHROME = new URL('./helpers/chrome.mjs', import.meta.url).href;

for (const failure of ['launch', 'open', 'close']) {
  test(`benchmark stops its real server after browser ${failure} failure`, async () => {
    const dir = mkdtempSync(join(process.cwd(), '.bench-lifecycle-test-'));
    const evidence = join(dir, 'lifecycle.json');
    let state;
    try {
      const browserModule = `
        import { readFileSync, writeFileSync } from 'node:fs';
        import { join } from 'node:path';
        export async function launchBrowser() {
          const stateFile = join(process.env.HUDDLE_STATE_DIR, 'server.json');
          const record = { stateFile, state: JSON.parse(readFileSync(stateFile, 'utf8')), closed: false };
          writeFileSync(process.env.LIFECYCLE_EVIDENCE, JSON.stringify(record));
          if (process.env.BROWSER_FAILURE === 'launch') throw new Error('injected launch failure');
          return {
            async open() { throw new Error('injected open failure'); },
            async close() {
              record.closed = true;
              writeFileSync(process.env.LIFECYCLE_EVIDENCE, JSON.stringify(record));
              if (process.env.BROWSER_FAILURE === 'close') throw new Error('injected close failure');
            },
          };
        }
      `;
      const loader = join(dir, 'browser-loader.mjs');
      writeFileSync(loader, `
        export async function resolve(specifier, context, nextResolve) {
          const result = await nextResolve(specifier, context);
          if (result.url === ${JSON.stringify(CHROME)}) {
            return { url: ${JSON.stringify(`data:text/javascript,${encodeURIComponent(browserModule)}`)}, shortCircuit: true };
          }
          return result;
        }
      `);
      const env = {
        ...process.env,
        TMP: dir, TEMP: dir, TMPDIR: dir,
        HUDDLE_STATE_DIR: join(dir, 'unused-state'),
        BROWSER_FAILURE: failure,
        LIFECYCLE_EVIDENCE: evidence,
      };
      const result = spawnSync(process.execPath, ['--experimental-loader', pathToFileURL(loader).href, BENCH, 'toon', join(dir, 'results.json')], {
        env, encoding: 'utf8', timeout: 20000,
      });
      const record = JSON.parse(readFileSync(evidence, 'utf8'));
      state = record.stateFile;
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, new RegExp(`injected ${failure} failure`));
      assert.equal(record.closed, failure !== 'launch');
      for (let i = 0; i < 100 && existsSync(state); i++) await new Promise((r) => setTimeout(r, 20));
      assert.equal(existsSync(state), false, 'server removes its published state on shutdown');
      await assert.rejects(fetch(`http://127.0.0.1:${record.state.port}/api/health`, {
        headers: { authorization: `Bearer ${record.state.token}` },
        signal: AbortSignal.timeout(2000),
      }), 'the benchmark server must no longer accept connections');
    } finally {
      if (state && existsSync(state)) {
        spawnSync(process.execPath, [CLI, 'stop'], {
          env: { ...process.env, HUDDLE_STATE_DIR: join(state, '..') }, encoding: 'utf8',
        });
      }
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  });
}
