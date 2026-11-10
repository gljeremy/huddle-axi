// The TOON subset. Expected values come from the TOON spec's own examples and
// quoting rules (https://toonformat.dev), not from this encoder's output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToonError, decode, encode } from '../src/toon.mjs';

test('decodes the spec examples: primitives, inline arrays and tabular arrays', () => {
  const text = [
    'name: Ada',
    'age: 36',
    'active: true',
    'manager: null',
    'tags[3]: admin,ops,dev',
    'users[2]{id,name,role}:',
    '  1,Alice,admin',
    '  2,Bob,user',
    'empty[0]:',
  ].join('\n');
  assert.deepEqual(decode(text), {
    name: 'Ada',
    age: 36,
    active: true,
    manager: null,
    tags: ['admin', 'ops', 'dev'],
    users: [
      { id: 1, name: 'Alice', role: 'admin' },
      { id: 2, name: 'Bob', role: 'user' },
    ],
    empty: [],
  });
});

test('decodes list-form primitive arrays', () => {
  assert.deepEqual(decode('items[2]:\n  - first, with a comma\n  - "second"\n'), { items: ['first, with a comma', 'second'] });
});

test('quotes exactly the strings the spec says are ambiguous', () => {
  const cases = {
    plain: 'plain',
    spaced: 'two words',
    empty: '""',
    padded: '" padded "',
    bool: '"true"',
    nul: '"null"',
    num: '"42"',
    neg: '"-3.5"',
    dash: '"- item"',
    colon: '"a: b"',
    comma: '"a,b"',
    quote: '"say \\"hi\\""',
    slash: '"back\\\\slash"',
    brackets: '"[x]"',
    newline: '"one\\ntwo"',
  };
  const input = { plain: 'plain', spaced: 'two words', empty: '', padded: ' padded ', bool: 'true', nul: 'null', num: '42', neg: '-3.5', dash: '- item', colon: 'a: b', comma: 'a,b', quote: 'say "hi"', slash: 'back\\slash', brackets: '[x]', newline: 'one\ntwo' };
  const lines = encode(input).trimEnd().split('\n');
  assert.deepEqual(lines, Object.entries(cases).map(([k, v]) => `${k}: ${v}`));
  assert.deepEqual(decode(lines.join('\n')), input, 'quoted strings decode back to the same strings');
});

test('encodes uniform object arrays as tables and round-trips them', () => {
  const value = { options: [{ label: 'Long form, up front', votes: 2, chosen: false }, { label: 'Wizard', votes: null, chosen: true }] };
  const text = encode(value);
  assert.equal(text, 'options[2]{label,votes,chosen}:\n  "Long form, up front",2,false\n  Wizard,null,true\n');
  assert.deepEqual(decode(text), value);
});

test('an unquoted lone value keeps its commas and quotes', () => {
  assert.deepEqual(decode('title: Cut time, then scope\ncaption: the "fast" path'), { title: 'Cut time, then scope', caption: 'the "fast" path' });
});

test('count mismatches and bad syntax name the line', () => {
  const bad = [
    ['tags[3]: a,b', 1, /declares 3 values but has 2/],
    ['x: 1\nusers[2]{id,name}:\n  1,Ann', 2, /declares 2 rows but 1 follow/],
    ['users[1]{id,name}:\n  1,Ann,extra', 2, /3 values but users has 2 fields/],
    ['body[1]:\n  - a\n  - b', 3, /unexpected indented line/],
    ['title "no colon"', 1, /expected "key: value"/],
    ['a: 1\na: 2', 2, /duplicate key "a"/],
    ['title: "open', 1, /unterminated/],
    ['title: "bad \\q escape"', 1, /unknown escape/],
    ['title:x', 1, /put a space/],
    ['card:', 1, /nested objects are not supported/],
  ];
  for (const [text, line, message] of bad) {
    assert.throws(() => decode(text), (err) => err instanceof ToonError && err.line === line && message.test(err.message), text);
  }
});

test('accepts CRLF line endings and blank lines', () => {
  assert.deepEqual(decode('a: 1\r\n\r\nb[2]: x,y\r\n'), { a: 1, b: ['x', 'y'] });
});
