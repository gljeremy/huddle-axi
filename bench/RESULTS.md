# Step 0: where stock Lavish spends its time

Measured 2026-11-10 on Windows 11 with lavish-axi from npm (`npx -y lavish-axi`), in
headless Chrome. The agent was Claude Opus 5.5 running in Claude Code.

## Verdict

The premise holds. For a card-sized change, **the agent rewriting the whole file took
about 45 s. Lavish's reload took about 1.1 s.** The rewrite is about 97% of the wait.

Card-sized changes made as targeted edits took about 5 s. That is roughly 6–11 times
faster than a rewrite, or more once you take out fixed overhead. Once the agent edits in
place, Lavish's 1.1 s reload is about a sixth of what's left. That makes it the next thing
worth removing.

## The board

[`board.html`](board.html) is a realistic meeting board:

- 17 cards: goals, metrics, decisions, risks, ideas, a timeline and an action table
- its own CSS
- two Lavish question forms
- 15.9 KB and 271 lines

That is smaller than many Lavish artifacts. The plan file, for comparison, is about 33 KB.
A rewrite should take longer as the file grows, so these numbers likely flatter stock
Lavish. This was not measured.

The file in this folder is the board after all six edits below.

## Agent time: rewrite the whole file vs edit one card

Each time runs from a timestamp taken just before the agent began the edit to one taken
just after the file was written. Each time includes:

- the agent deciding what to write
- the tool round trip, about **2.5 s**, which is how long an empty round trip took (two
  timestamps, nothing in between)

| Edit | How | Time |
| --- | --- | --- |
| c5: mark "progressive wizard" decided, reword options and footer | full rewrite | 45.0 s |
| c7: mark "short personal tour" decided, reword the card | full rewrite | 49.8 s |
| c9: add a third bullet | full rewrite | 45.2 s |
| c6: add a sentence | targeted edit | 4.7 s |
| c11: rewrite the card (title, body, new bullet, footer) | targeted edit | 5.3 s |
| c17: rewrite one action row | targeted edit | 7.9 s |

| | Full rewrite | Targeted edit |
| --- | --- | --- |
| Median | **45.2 s** | **5.3 s** |
| Median without the 2.5 s overhead | 42.7 s | 2.8 s |

**What these numbers can and can't show**

- **The edits are not matched pairs.** Each one touches a different card, and the sizes
  differ: the c6 edit adds one sentence, while the c11 edit rewrites a whole card. Treat
  the ratio between the two groups as the finding, not any single pair.
- **The targeted edits ran with the board already in the agent's context.** There was no
  Read step. A fresh agent would need one first.
- **The token count and speed are estimates, not measurements.** A rewrite is about 4.3k
  output tokens if you assume about 3.7 characters per token. At that size, a rewrite ran
  at roughly 100 tokens/s.

Creating the board from scratch took 57.7 s.

## Lavish time: save → visible

[`measure-reload.mjs`](measure-reload.mjs) drives the Lavish session page in headless
Chrome over CDP. Each run makes a change to the file that alters its content but not its
layout. The script records three moments:

- when the iframe `src` changes
- when the frame finishes loading
- when the layout gate lifts

It flags any run where the gate timed out or never appeared.

```bash
node bench/measure-reload.mjs <session url> bench/board.html 5
```

| Run | Reload starts | Frame loaded | Visible (gate lifted) |
| --- | --- | --- | --- |
| 1 | 252 ms | 287 ms | 1202 ms |
| 2 | 255 ms | 298 ms | 1110 ms |
| 3 | 256 ms | 290 ms | 1226 ms |
| 4 | 257 ms | 290 ms | 1099 ms |
| 5 | 255 ms | 291 ms | 1118 ms |

The median from save to visible is **1.1 s**. It breaks down like this:

- **About 0.25 s before the reload starts.** That matches Lavish's waits: 100 ms for the
  write to finish, a 50 ms poll and a 100 ms debounce.
- **About 0.04 s to load the frame.**
- **About 0.8 s with the layout gate up.** The source says the gate waits for fonts and a
  layout audit. The script doesn't time those steps separately, so this split is inferred.

"Visible" here means the gate's `hidden` attribute flipped. The first paint after that
is not timed.

**Measure in a visible or headless browser.** The first attempt ran in a hidden Claude
browser pane. There the gate stayed up for 12.0 s, which is exactly its maximum hold, so
it timed out rather than passed. That run is thrown out. The likely cause is that hidden
pages don't run `requestAnimationFrame`, which the gate relies on. That fits the source
but wasn't verified.

## One round, end to end

Measured:

| Path | Agent | Lavish | Total |
| --- | --- | --- | --- |
| Stock Lavish, agent rewrites the file | 45.2 s | 1.1 s | **46.3 s** |
| Stock Lavish, agent edits one card in place | 5.3 s | 1.1 s | **6.4 s** |

Projected, not measured: huddle-axi's card patch with a DOM swap and no reload. That
leaves agent time plus well under 0.1 s. The step 2 test gate stays at < 8 s from comment
to visible.

## What this changes in the plan

Measured:

- **Editing one card instead of rewriting the file is the big win.** On this board it cut
  the agent's time about 6–11 times.
- **Most of that win is available in stock Lavish today.** The agent just has to edit in
  place instead of rewriting.

Judgement calls, not measured:

- **The fork's job is to make card edits the only path.** Card ids, fixed tags and a
  `patch` command keep agents from falling back to a rewrite.
- **Removing the reload comes next.** It's 1.1 s of a 6.4 s round, so it belongs in
  step 1, but it isn't the headline.
- **Expect a small gain from TOON.** Its savings come on top of an edit that already takes
  about 3 s. Step 2 tests that.

## Not measured

- **Only one model, and three edits of each kind.** Opus 5.5 is a premium model, and a
  fast model should shrink both agent rows.
- **Only one board size.**
- **The time for the poll to pick up feedback and for the agent to read it.** It's the
  same for both paths.
