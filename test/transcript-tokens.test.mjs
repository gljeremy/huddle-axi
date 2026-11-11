import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../bench/transcript-tokens.mjs', import.meta.url));
const tool = (command) => ({ type: 'tool_use', name: 'Bash', input: { command } });
const turn = (id, output, content) => ({
  type: 'assistant',
  message: { id, usage: { output_tokens: output }, content },
});

test('transcript CLI counts combined and streamed patch/poll turns independently', () => {
  const dir = mkdtempSync(join(process.cwd(), '.transcript-test-'));
  try {
    const transcript = join(dir, 'transcript.jsonl');
    const records = [
      turn('combined', 10, [tool("node bench/patch.mjs board.html <<'CARD'\n<section></section>\nCARD\nnode src/cli.mjs poll board.html")]),
      turn('separate-blocks', 20, [tool('node bench/patch.mjs board.html < card'), tool('node src/cli.mjs poll board.html')]),
      turn('streamed', 5, [{ type: 'thinking', thinking: 'Choose the edit.' }, tool('node src/cli.mjs poll board.html')]),
      turn('streamed', 30, [tool('node bench/patch.mjs board.html < card')]),
      turn('patch-only', 40, [tool('node bench/patch.mjs board.html < card')]),
      turn('poll-only', 50, [tool('node src/cli.mjs poll board.html')]),
      turn('neither', 60, [{ type: 'text', text: 'Done.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'card' } }]),
      { ...turn('user', 999, [tool('node bench/patch.mjs board.html; node src/cli.mjs poll board.html')]), type: 'user' },
    ];
    writeFileSync(transcript, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
    const result = spawnSync(process.execPath, [SCRIPT, transcript], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {
      turns: 6,
      patchTurns: 4,
      patchTurnsThatThink: 1,
      patchTurnsThatAlsoPoll: 3,
      patchTurnOutputMedian: 25,
      allOutputTotal: 210,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
