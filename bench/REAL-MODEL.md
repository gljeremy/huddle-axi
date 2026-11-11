# Step 2: a real model on the live loop

Measured 2026-11-10 on Windows 11. The agent was Claude Haiku 5.5 running in Claude Code
as a subagent and using the real CLI. The board ran in headless Chrome.

## Verdict

- **Every round was visible in under 8 s.** That is the plan's target. All 80 rounds made
  it: 20 notes, in each of two formats, run twice. The median from note to card on screen
  was 3.0–4.1 s, and the slowest single round took 6.3 s.
- **Both formats were reliable.** All 80 edits did what the note asked, and no patch was
  rejected in either format.
- **HTML was faster than TOON, against the plan's guess.** The median was 3.0–3.2 s for
  HTML and 4.0–4.1 s for TOON, and both pairs of runs agree. TOON cards are about 20%
  shorter, but the model spent more output tokens on each TOON edit, not fewer.

## How it was run

To start a run (Node.js 22 or later, with Chrome or Edge as described in the
[README checks](../README.md#checks)):

```bash
node bench/real-model.mjs toon real-model-toon-local.json
```

Use `html` instead of `toon` for the other format. The script prints a Bash setup
command exporting a run-specific `HUDDLE_STATE_DIR`, followed by the agent's `poll`
and patch-wrapper commands and `ready: <board>`. Run the agent separately, with that
export applied to **both** commands: each run has its own server, isolated from normal
live sessions. The script stops only that server on exit.

[`real-model.mjs`](real-model.mjs) plays the facilitator:

1. It makes a fresh sample board, opens it live and loads it in headless Chrome.
2. For each of the 20 notes in [`tasks.mjs`](tasks.mjs), it waits until the agent is in
   `poll`, leaves the note on the card, and times it until the patched card is on screen
   and saved.
3. It checks the result against what the note asked for. For example, "Mark it decided"
   must leave `data-status="decided"` and the chosen option.

The notes are realistic small edits:
- mark a decision, add or remove a bullet, change a number or a progress value;
- retitle a card, add an option or a detail row, change an owner.

The agent got the same instructions in every run. Only the board path and the format
changed. The instructions said:
- use `poll` in the run's format;
- send the whole edited card back through [`patch.mjs`](patch.mjs), which is `patch` with
  a log of every attempt so rejected patches can be counted;
- follow the board's card rules.

Each run used a fresh agent and a fresh board. The order was TOON, HTML, HTML, TOON, so
neither format always went first.

[`summarize.mjs`](summarize.mjs) makes the timing and character-count tables from the
result files (`real-model-*.json`):

```bash
node bench/summarize.mjs bench/real-model-toon.json bench/real-model-toon-2.json bench/real-model-html.json bench/real-model-html-2.json
```

[`transcript-tokens.mjs`](transcript-tokens.mjs) reads the output token counts the API
reported in each agent's transcript; those counts are not in the result JSON files.

## Time

| | TOON 1 | TOON 2 | HTML 1 | HTML 2 |
| --- | --- | --- | --- | --- |
| Rounds visible in under 8 s | 20/20 | 20/20 | 20/20 | 20/20 |
| Note to visible, median | **4.1 s** | **4.0 s** | **3.0 s** | **3.2 s** |
| Note to visible, 90th percentile | 5.0 s | 4.6 s | 3.4 s | 3.9 s |
| Note to visible, slowest | 5.5 s | 6.3 s | 4.2 s | 5.3 s |
| Note reaches the agent (median) | 12 ms | 12 ms | 11 ms | 12 ms |
| Agent writes the patch (median) | 3.9 s | 3.8 s | 2.8 s | 3.0 s |
| Patch sent to visible and saved (median) | 0.2 s | 0.2 s | 0.2 s | 0.2 s |

Almost all of the time is the model's turn:
- **Before the turn:** the note reaches the waiting agent in about 12 ms.
- **The turn:** "Agent writes the patch" runs from the poll handing over the note to the
  agent's patch command starting. It includes the model's thinking, its writing the card
  and Claude Code's own tool round trip.
- **After the turn:** the CLI starts, the card is swapped on screen and the file is
  saved, about 0.2 s in all.

For comparison, step 0 measured stock Lavish:
- 46.3 s for a round where Opus rewrote the whole file;
- 6.4 s for a round where Opus edited one card in place.

## Tokens and failures

| | TOON 1 | TOON 2 | HTML 1 | HTML 2 |
| --- | --- | --- | --- | --- |
| Rejected patches | 0 | 0 | 0 | 0 |
| Card handed to the agent, median characters | 206 | 206 | 255 | 255 |
| Card sent back, median characters | 206 | 206 | 256 | 256 |
| Output tokens of the turn that writes the patch, median | 534 | 512 | 332 | 314 |
| Patch turns where the model thought first | 14/20 | 13/20 | 6/20 | 6/20 |
| Output tokens for the whole run | 11,288 | 11,808 | 11,481 | 11,066 |

The output token counts include the model's thinking. That is why they are well above
the card's own size.

## Why TOON was slower

Two things show up in the transcripts:

- **The model thought more often before a TOON patch.** It thought first in 2 of 3 TOON
  patches, and in fewer than 1 of 3 HTML patches. That is the main cost. A plausible
  reason is that the model has seen far less TOON, so counting `[N]` and deciding what
  to quote takes deliberation. The transcripts don't show what it was thinking about.
- **The TOON agent sent each patch and its next poll in the same turn.** The HTML agent
  used separate turns. Both agents got the same instructions. Putting the poll in the
  patch turn adds a few dozen tokens to every timed turn. That is a small part of the
  roughly 200-token gap. Over a whole run, both formats came to about 11k output tokens.

The character savings are real but small: about 50 characters, or roughly 15 tokens, per
card. Here they were outweighed by the extra thinking.

## Not measured

- **Only one model.** A model that knows TOON better might close the gap. A premium
  model is likely slower in both formats.
- **Only one agent harness.** Claude Code adds its own tool round trip to every turn.
  A direct API loop would be faster in both formats.
- **Only small cards.** The biggest card in the runs was about 600 characters as HTML
  and 500 as TOON. TOON's savings
  grow with the card, and a board with long cards could change the result.
- **Two runs of each format.** Model latency varies with load, but the gap held in both
  pairs and in either order.
