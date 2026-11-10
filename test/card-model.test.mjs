// The card model. The oracle is the hand-written sample board (src/sample.mjs):
// a model written out by hand must render to the same markup a person wrote.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CardError, ToonError, cardToHtml, cardToToon, normalizeCard, toonToCard } from '../src/card-model.mjs';
import { SAMPLE } from '../src/sample.mjs';

const sampleCard = (id) => SAMPLE.lanes.flatMap((l) => l.cards).find((c) => c.includes(`data-card="${id}"`));
const squash = (html) => html.replace(/>\s+</g, '><').trim();

const MODELS = {
  c3: {
    id: 'c3', kind: 'metric', progress: 68, title: 'Activation rate', value: '41', display: '41%',
    caption: 'target 60% · baseline last 90 days',
    body: ['A dashboard with at least one live data source within 7 days of signup.'],
  },
  c5: {
    id: 'c5', kind: 'decision', status: 'open', title: 'How do we collect setup data?',
    body: ['We need the data source, team size and main use case before the first dashboard is useful.'],
    options: [
      { label: 'Long form up front', detail: 'Everything on one page before the product loads', votes: 2, chosen: false },
      { label: 'Progressive wizard', detail: 'Three short steps, skippable, resumable later', votes: 5, chosen: false },
      { label: 'Import from CSV', detail: 'Fastest for teams that already have a spreadsheet', votes: 1, chosen: false },
    ],
    meta: [{ key: 'decide by', value: 'end of session' }],
  },
  c9: {
    id: 'c9', kind: 'risk', severity: 'high', title: 'Data access is the real bottleneck',
    body: ['Most of the 23 minutes is people waiting for credentials from their own IT team.'],
    bullets: ['Offer demo data so they can explore while they wait', 'Send a ready-made request email they can forward to IT'],
    meta: [{ key: 'raised by', value: 'Support' }],
  },
};

test('a hand-written model renders to the hand-written sample card', () => {
  for (const [id, model] of Object.entries(MODELS)) {
    assert.equal(squash(cardToHtml(model)), squash(sampleCard(id)), id);
  }
});

test('an html card renders its markup verbatim inside the section', () => {
  const sample = sampleCard('c16');
  const inner = sample.slice(sample.indexOf('>') + 1, sample.lastIndexOf('</section>')).trim();
  assert.equal(squash(cardToHtml({ id: 'c16', kind: 'html', html: inner })), squash(sample));
});

test('a model survives the trip through TOON', () => {
  for (const model of Object.values(MODELS)) {
    assert.deepEqual(toonToCard(cardToToon(model)), normalizeCard(model));
  }
});

test('the TOON an agent sees is readable: options are a table', () => {
  const text = cardToToon(MODELS.c5);
  assert.match(text, /^options\[3\]\{label,detail,votes,chosen\}:\n {2}Long form up front,Everything on one page before the product loads,2,false$/m);
  assert.match(text, /^meta\[1\]\{key,value\}:\n {2}decide by,end of session$/m);
});

test('an agent can write a card by hand in TOON', () => {
  const card = toonToCard(`id: c7
kind: decision
status: decided
title: Do SSO seats get the wizard?
body[1]: "Decided: short tour, admin settings pre-filled."
options[2]{label,detail,votes,chosen}:
  Full wizard,"Same as self-serve, admin settings pre-filled",2,false
  Short personal tour,Skip workspace setup,6,true
`);
  assert.equal(
    squash(cardToHtml(card)),
    squash(`<section data-card="c7" data-kind="decision" data-status="decided">
<h3>Do SSO seats get the wizard?</h3>
<p>Decided: short tour, admin settings pre-filled.</p>
<ol><li data-votes="2">Full wizard<small>Same as self-serve, admin settings pre-filled</small></li>
<li data-votes="6" data-chosen>Short personal tour<small>Skip workspace setup</small></li></ol>
</section>`),
  );
});

test('a metric value with quotes is escaped in its attribute', () => {
  assert.match(cardToHtml({ id: 'm1', kind: 'metric', title: 'T', value: '5"&<' }), /<data value="5&quot;&amp;&lt;">5"&<<\/data>/);
});

test('bad cards are refused with a message the agent can act on', () => {
  const bad = [
    [{ kind: 'note', title: 'x' }, /not a valid card id/],
    [{ id: 'C1', kind: 'note', title: 'x' }, /not a valid card id/],
    [{ id: 'c1', kind: 'memo', title: 'x' }, /kind must be one of/],
    [{ id: 'c1', kind: 'note' }, /needs a title/],
    [{ id: 'c1', kind: 'note', title: 'x', colour: 'red' }, /unknown field: colour/],
    [{ id: 'c1', kind: 'note', title: 'x', status: 'closed' }, /status must be open or decided/],
    [{ id: 'c1', kind: 'metric', title: 'x', progress: 101 }, /progress must be/],
    [{ id: 'c1', kind: 'note', title: 'x', body: 'one' }, /body must be a list/],
    [{ id: 'c1', kind: 'decision', title: 'x', options: [{ label: 'a', votes: -1 }] }, /votes must be/],
    [{ id: 'c1', kind: 'note', title: 'x', html: '<p>' }, /only html cards/],
    [{ id: 'c1', kind: 'html', title: 'x', html: '<p>' }, /carries only html, not title/],
  ];
  for (const [card, message] of bad) assert.throws(() => normalizeCard(card), (err) => err instanceof CardError && message.test(err.message), JSON.stringify(card));
  assert.throws(() => toonToCard('id: c1\nkind: note\ntitle'), ToonError);
});
