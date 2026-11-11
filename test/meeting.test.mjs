// The meeting tools in a real headless browser: quick actions, per-card undo, the change
// glow, present mode and the two exports. Expected values come from the hand-written sample
// board in src/sample.mjs and from what each action is defined to do.
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from './helpers/chrome.mjs';

const CLI = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'huddle-meeting-'));
let browser;
let boards = 0;

before(async () => {
  browser = await launchBrowser();
});
after(async () => {
  await browser?.close();
});
beforeEach(async () => {
  const file = join(dir, `sample-${++boards}.html`);
  execFileSync(process.execPath, [CLI, 'new', file, '--sample']);
  await browser.open(pathToFileURL(file).href);
});

const call = (fn, ...args) => browser.call(fn, ...args);
const order = (lane) => call((lane) => [...document.querySelectorAll(`[data-lane="${lane}"] > [data-card]`)].map((el) => el.dataset.card), lane);
const click = (card, action, index) => call((card, action, index) => {
  const scope = document.querySelector(`[data-card="${card}"]`);
  const sel = index == null ? `.huddle-quick [data-quick="${action}"]` : `.huddle-opt [data-quick="${action}"][data-index="${index}"]`;
  const el = scope.querySelector(sel);
  if (!el) throw new Error(`no ${action} control on #${card}`);
  el.click();
}, card, action, index);

test('votes and choosing an option, from the controls on the card', async () => {
  await click('c5', 'vote-up', 1);
  assert.equal((await call(() => huddle.model('c5'))).options[1].votes, 6, 'Progressive wizard had 5 votes');
  await click('c5', 'vote-down', 2);
  await click('c5', 'vote-down', 2);
  assert.equal((await call(() => huddle.model('c5'))).options[2].votes, 0, 'Import from CSV had 1 vote and stops at 0');

  await click('c5', 'choose', 1);
  let m = await call(() => huddle.model('c5'));
  assert.equal(m.status, 'decided');
  assert.deepEqual(m.options.map((o) => o.chosen), [false, true, false]);
  await click('c5', 'choose', 0);
  assert.deepEqual((await call(() => huddle.model('c5'))).options.map((o) => o.chosen), [true, false, false], 'one option is chosen at a time');
  await click('c5', 'choose', 0);
  m = await call(() => huddle.model('c5'));
  assert.equal(m.status, 'open', 'choosing the chosen option again reopens the decision');
  assert.deepEqual(m.options.map((o) => o.chosen), [false, false, false]);

  await click('c6', 'decide');
  assert.equal((await call(() => huddle.model('c6'))).status, 'decided');
  assert.equal(await call(() => document.querySelector('[data-card="c6"] [data-quick="decide"]').textContent), 'Reopen');
  assert.equal(await call(() => huddle.dirty), true);
  assert.deepEqual(browser.errors, []);
});

test('+Option adds an option typed on the card, as plain text', async () => {
  await click('c7', 'add-option');
  await call(() => {
    const input = document.querySelector('[data-card="c7"] .huddle-option-input input');
    input.value = 'No onboarding <b>at all</b>';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  const m = await call(() => huddle.model('c7'));
  assert.equal(m.options.length, 3);
  assert.deepEqual(m.options[2], { label: 'No onboarding &lt;b&gt;at all&lt;/b&gt;', detail: '', votes: 0, chosen: false });
  assert.deepEqual(m.meta, [{ key: 'decide by', value: 'end of session' }], 'the details stay after the options');
  await assert.rejects(call(() => huddle.quick.addOption('c7', '   ')), /an option needs a label/);
});

test('status dials: severity, progress and an action\'s status', async () => {
  const severities = [];
  for (let i = 0; i < 3; i++) {
    await click('c8', 'severity');
    severities.push(await call(() => document.querySelector('[data-card="c8"]').dataset.severity));
  }
  assert.deepEqual(severities, ['medium', 'low', 'high'], 'c8 starts at high');

  await click('c3', 'progress-up');
  assert.equal((await call(() => huddle.model('c3'))).progress, 78, 'c3 starts at 68');
  for (let i = 0; i < 4; i++) await click('c3', 'progress-up');
  assert.equal((await call(() => huddle.model('c3'))).progress, 100, 'progress stops at 100');
  await click('c4', 'progress-down');
  await click('c4', 'progress-down');
  await click('c4', 'progress-down');
  assert.equal((await call(() => huddle.model('c4'))).progress, 0, 'c4 starts at 22 and stops at 0');

  await click('c14', 'status');
  assert.deepEqual((await call(() => huddle.model('c14'))).meta.at(-1), { key: 'status', value: 'done' }, 'c14 starts in progress');
  await click('c14', 'status');
  assert.deepEqual((await call(() => huddle.model('c14'))).meta.at(-1), { key: 'status', value: 'not started' });
  await call(() => huddle.add('<section data-card="c40" data-kind="action"><h3>Book the room</h3></section>', { lane: 'plan' }));
  await call(() => huddle.quick.actionStatus('c40'));
  assert.deepEqual((await call(() => huddle.model('c40'))).meta, [{ key: 'status', value: 'not started' }], 'a missing status row is added');
});

test('cards move up, down and to another lane', async () => {
  await click('c2', 'up');
  assert.deepEqual(await order('goals'), ['c2', 'c1', 'c3', 'c4']);
  await click('c2', 'up');
  assert.deepEqual(await order('goals'), ['c2', 'c1', 'c3', 'c4'], 'the first card stays first');
  await click('c1', 'down');
  await click('c1', 'down');
  assert.deepEqual(await order('goals'), ['c2', 'c3', 'c4', 'c1']);
  await click('c1', 'down');
  assert.deepEqual(await order('goals'), ['c2', 'c3', 'c4', 'c1'], 'the last card stays last');

  await call(() => {
    const select = document.querySelector('[data-card="c13"] select[data-quick="move-to"]');
    select.value = 'plan';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.deepEqual(await order('ideas'), ['c11', 'c12']);
  assert.deepEqual(await order('plan'), ['c14', 'c15', 'c16', 'c13']);
  const options = await call(() => [...document.querySelectorAll('[data-card="c13"] select option')].map((o) => o.value));
  assert.ok(!options.includes('plan') && options.includes('ideas'), 'the lane menu now offers the lane the card left');
  assert.equal((await call(() => huddle.context().revisions.at(-1))).op, 'move');
});

test('split turns each bullet into a card, and undo takes it back', async () => {
  const made = await call(() => huddle.quick.split('c9'));
  assert.deepEqual(made, ['c17', 'c18'], 'the sample board ends at c16');
  assert.deepEqual(await order('risks'), ['c8', 'c9', 'c17', 'c18', 'c10']);
  assert.equal((await call(() => huddle.model('c9'))).bullets, undefined);
  assert.deepEqual(await call(() => [huddle.model('c17'), huddle.model('c18')]), [
    { id: 'c17', kind: 'risk', title: 'Offer demo data so they can explore while they wait' },
    { id: 'c18', kind: 'risk', title: 'Send a ready-made request email they can forward to IT' },
  ]);
  await assert.rejects(call(() => huddle.quick.split('c1')), /needs at least two bullets/);

  await click('c18', 'undo');
  await click('c17', 'undo');
  await click('c9', 'undo');
  assert.deepEqual(await order('risks'), ['c8', 'c9', 'c10']);
  assert.equal((await call(() => huddle.model('c9'))).bullets.length, 2);
});

test('undo walks a card back one change at a time, including the agent\'s', async () => {
  const original = await call(() => huddle.get('c11'));
  assert.equal(await call(() => document.querySelector('[data-card="c11"] [data-quick="undo"]')), null, 'no Undo before any change');
  await call(() => huddle.patch('<section data-card="c11" data-kind="idea"><h3>Version 1</h3></section>'));
  assert.ok(await call(() => document.querySelector('[data-card="c11"] [data-quick="undo"]')), 'Undo appears after the first change');
  await call(() => huddle.patch('<section data-card="c11" data-kind="idea"><h3>Version 2</h3></section>', { by: 'facilitator' }));
  await click('c11', 'undo');
  assert.equal((await call(() => huddle.model('c11'))).title, 'Version 1');
  await click('c11', 'undo');
  assert.equal(await call(() => huddle.get('c11')), original);
  assert.equal(await call(() => document.querySelector('[data-card="c11"] [data-quick="undo"]')), null, 'no Undo button once there is nothing left');
  await assert.rejects(call(() => huddle.undo('c11')), /nothing to undo on #c11/);
  assert.deepEqual((await call(() => huddle.context().revisions.slice(-2))).map((r) => r.op), ['undo', 'undo']);
});

test('undo history is capped at 10 per card and survives saving and reopening', async () => {
  const html = await call(() => {
    for (let i = 1; i <= 12; i++) huddle.patch(`<section data-card="c12" data-kind="idea"><h3>Take ${i}</h3></section>`);
    return huddle.serialize();
  });
  const ctx = await call(() => huddle.context());
  assert.equal(ctx.history.c12.length, 10);
  assert.match(ctx.history.c12[0], /Take 2</, 'the oldest versions drop off first');
  const saved = html.match(/<main data-huddle-board[\s\S]*<\/main>/)[0];
  assert.doesNotMatch(saved, /huddle-quick|data-quick|huddle-opt|huddle-option-input|<button|<select|<input/, 'the controls are never saved');

  const file = join(dir, 'reopened.html');
  writeFileSync(file, html);
  await browser.open(pathToFileURL(file).href);
  assert.deepEqual(await call(() => huddle.problems), []);
  await call(() => huddle.undo('c12'));
  assert.equal((await call(() => huddle.model('c12'))).title, 'Take 11');
});

test('a change lights up the card and only the parts that changed, and none of it is saved', async () => {
  await call(() => huddle.patch(`<section data-card="c9" data-kind="risk" data-severity="high">
<h3>Data access is the real bottleneck</h3>
<p>Most of the 23 minutes is people waiting for credentials from their own IT team.</p>
<ul>
<li>Offer demo data so they can explore while they wait</li>
<li>Let admins pre-approve data access</li>
</ul>
<dl><dt>raised by</dt><dd>Support</dd></dl>
</section>`));
  const state = await call(() => {
    const el = document.querySelector('[data-card="c9"]');
    return {
      fresh: el.classList.contains('huddle-fresh'),
      changed: [...el.querySelectorAll('.huddle-changed')].map((n) => n.textContent),
      saved: huddle.get('c9') + huddle.serialize().match(/<main data-huddle-board[\s\S]*<\/main>/)[0],
    };
  });
  assert.equal(state.fresh, true);
  assert.deepEqual(state.changed, ['Let admins pre-approve data access']);
  assert.doesNotMatch(state.saved, /huddle-changed|huddle-fresh/);
});

test('present mode sets projector-size type without touching the file', async () => {
  const size = () => call(() => getComputedStyle(document.body).fontSize);
  assert.equal(await size(), '19px');
  await call(() => document.querySelector('.huddle-present').click());
  assert.equal(await size(), '28px');
  await call(() => [...document.querySelectorAll('.huddle-zoom')].at(-1).click());
  assert.equal(await size(), '32px');
  const state = await call(() => {
    const saved = new DOMParser().parseFromString(huddle.serialize(), 'text/html');
    return {
      presenting: huddle.presenting,
      maxWidth: getComputedStyle(document.querySelector('[data-huddle-board]')).maxWidth,
      styles: [...saved.querySelectorAll('style')].map((s) => s.getAttributeNames()),
      toolbars: saved.querySelectorAll('.huddle-toolbar, [data-present]').length,
    };
  });
  assert.equal(state.presenting, true);
  assert.equal(state.maxWidth, 'none');
  assert.deepEqual(state.styles, [['data-huddle-runtime']], 'the zoom style stays out of the file');
  assert.equal(state.toolbars, 0);
  await call(() => huddle.present(false));
  assert.equal(await size(), '19px');
});

test('meeting notes export as Markdown', async () => {
  await call(() => {
    huddle.quick.choose('c5', 1);
    huddle.comment('c5', 'Ship the wizard first.');
  });
  const md = await call(() => huddle.exportNotes());
  assert.match(md, /^# Q3 onboarding redesign\n\nDecide the setup flow/);
  const sections = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(sections, ['Decisions', 'Actions', 'Risks', 'Metrics', 'Goals', 'Ideas', 'Notes', 'Other cards']);
  const lines = md.split('\n');
  for (const line of [
    '- **How do we collect setup data?** (decided) — We need the data source, team size and main use case before the first dashboard is useful.',
    '  - [x] Progressive wizard — Three short steps, skippable, resumable later (5 votes)',
    '  - [ ] Import from CSV — Fastest for teams that already have a spreadsheet (1 vote)',
    '  - Note from facilitator: Ship the wizard first.',
    '- **Draft the three wizard steps as wireframes**',
    '  - owner: Design · due: before session 3 · status: in progress',
    '- **SSO users skip onboarding entirely** (high severity) — About a third of seats arrive by SSO and never see onboarding, so a self-serve redesign misses them.',
    '- **Activation rate**: 41% (68% progress) — target 60% · baseline last 90 days A dashboard with at least one live data source within 7 days of signup.',
    '- **Timeline** — see the board for this card',
  ]) assert.ok(lines.includes(line), `missing line: ${line}\n${md}`);
});

test('a read-only snapshot shows the board with no runtime or controls', async () => {
  await call(() => huddle.comment('c6', 'Lean towards the sample dashboard.'));
  const html = await call(() => huddle.exportSnapshot());
  assert.doesNotMatch(html, /<script|<button|<select|<textarea|<input/i);
  const file = join(dir, 'snapshot.html');
  writeFileSync(file, html);
  await browser.open(pathToFileURL(file).href);
  const state = await call(() => ({
    runtime: typeof window.huddle,
    cards: document.querySelectorAll('[data-card]').length,
    thread: document.querySelector('[data-card="c6"] .huddle-thread')?.textContent,
    stamp: document.querySelector('[data-huddle-snapshot]')?.textContent,
    styled: getComputedStyle(document.querySelector('[data-card]')).borderRadius,
  }));
  assert.equal(state.runtime, 'undefined');
  assert.equal(state.cards, 16);
  assert.match(state.thread, /Lean towards the sample dashboard\./);
  assert.match(state.stamp, /^Read-only snapshot, \d{4}-\d{2}-\d{2}\.$/);
  assert.equal(state.styled, '12px', 'the board styles come along');
  assert.deepEqual(browser.errors, []);
});
