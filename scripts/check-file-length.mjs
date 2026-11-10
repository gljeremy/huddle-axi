#!/usr/bin/env node
// Fails when any text file in the repo goes over MAX_LINES. Keeps files small
// enough for an agent to read and patch in one go. Binary files are skipped.
// Built single-file boards go in dist/, which is ignored; their sources are split.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const MAX_LINES = 1000;

let listing;
try {
  // Tracked plus untracked-but-not-ignored files, so new files are checked before
  // their first commit. -z keeps unusual names (unicode, quotes) unquoted.
  listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
} catch (err) {
  console.error(`check-file-length: could not list files with git (${err.message.split('\n')[0]}). Run it inside the repo.`);
  process.exit(2);
}
const files = listing.split('\0').filter(Boolean);

let checked = 0;
const tooLong = [];
for (const file of files) {
  let buf;
  try {
    buf = readFileSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') continue; // listed by git but deleted from the working tree
    if (err.code === 'EISDIR') continue; // submodule
    throw err;
  }
  if (buf.includes(0)) continue; // binary
  const text = buf.toString('utf8');
  const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
  checked++;
  if (lines > MAX_LINES) tooLong.push(`${file}: ${lines} lines`);
}

if (tooLong.length) {
  console.error(`Files over ${MAX_LINES} lines. Split them before going on:\n  ${tooLong.join('\n  ')}`);
  process.exit(1);
}
console.log(`ok: ${checked} text files, all at or under ${MAX_LINES} lines`);
