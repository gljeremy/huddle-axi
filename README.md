# huddle-axi

Status: step 2 done. The agent loop (`open`, `poll`, `patch`) works end to end.
See [bench/REAL-MODEL.md](bench/REAL-MODEL.md) for the real-model measurements,
TOON vs HTML comparison and limitations, and [bench/RESULTS.md](bench/RESULTS.md)
for step 0's measurements of stock Lavish.

A board for running a discussion on a shared screen. The facilitator leaves notes on
cards; an agent picks each note up, rewrites that one card, and the card changes in place
without the page reloading.

It builds on the ideas in [lavish-axi](https://github.com/kunchenguid/lavish-axi) but
goes its own way:

- **One portable HTML file.** The runtime is inlined. Save writes the live state back
  into the file, so it carries the cards, notes and change log with it.
- **Rigid cards.** Restricted HTML with fixed tags, plus an `html` escape hatch for
  diagrams and one-offs. See the card rules below for the authoritative restrictions.
- **Card-level patches.** One card changes at a time, swapped in place with a glow that
  survives a screen share. See the live-session instructions below for card formats.
- **One writer.** Only the facilitator edits. The room watches the shared screen.

The reviewed plan is in `lavish-fast-plan.html`.

## Try it

```bash
node src/cli.mjs new my-board.html --sample
```

Creating a board requires Node.js 22 or later. Open `my-board.html` in Chrome or Edge.

- **Leave a note for the agent:** hover a card, press **Note**, type the note and press
  Enter to submit it (Shift+Enter adds a line; Esc closes the editor).
- **Save:** press **Save** or Ctrl+S (Cmd+S on macOS). With the File System Access API,
  choose the destination on the first save; later saves reuse it. Without that API,
  Save downloads a copy instead. Cards, notes and the change log are included.
  Changes made while a save is in progress remain unsaved; save again to include them.

## Run a live session with an agent

```bash
node src/cli.mjs open my-board.html
```

This starts a small background server on 127.0.0.1 (it stops by itself after 4 idle
hours) and opens the board from it. Keep one facilitator tab open per board; this is
not a multi-viewer sync service. Do not edit the HTML file directly during a live
session: the browser is the source of truth and saves its state over that file.
While served, the board is live:

- Each note is sent to the agent as well as saved.
- Every change is written back into `my-board.html` within a fraction of a second, so
  there is no Save step. The file stays a plain portable board you can open later
  without the server.
- A card the agent is working on gets a dashed, pulsing outline.

The agent runs a loop:

```bash
node src/cli.mjs poll my-board.html --out card.toon
```

`poll` waits for the next note (8 minutes by default, `--timeout-ms` to change) and prints
the note, the earlier notes on that card, the board's title and brief, and the card
itself. At delivery it asks the browser for the current card, so queued notes include
previous rewrites; if the browser does not answer within a second, it uses the snapshot
captured when the note was submitted. With `--out`, the card goes to that file, ready
for a targeted edit. A card looks like this:

```
id: c5
kind: decision
status: open
title: How do we collect setup data?
body[1]: "We need the data source, team size and main use case before the first dashboard is useful."
options[3]{label,detail,votes,chosen}:
  Long form up front,Everything on one page before the product loads,2,false
  Progressive wizard,"Three short steps, skippable, resumable later",5,false
  Import from CSV,Fastest for teams that already have a spreadsheet,1,false
meta[1]{key,value}:
  decide by,end of session
```

The field reference and HTML mapping live in [src/card-model.mjs](src/card-model.mjs).
An `html` card uses the `html` field for its content, alongside its card attributes.
`poll --format toon` is the default: a card whose markup doesn't fit the model is
printed as its `<section>` HTML instead (`format: html`). `poll --format html` prints
every card that way, including when using `--out`.

```bash
node src/cli.mjs patch my-board.html --card-file card.toon --note "marked decided"
```

`patch` takes the edited card as TOON or as one `<section>`, from `--card-file` or
stdin. It returns once the card has changed on screen and the file is saved. A bad card
is refused with the reason (a TOON line number, or the card rule it breaks), and the
board is left as it was. If saving fails after applying a valid card, `patch` exits
unsuccessfully with the save error and warns that the card already changed on screen.
`node src/cli.mjs stop` stops the server.

## Page API

From the browser console, `huddle` is the page API:

```js
huddle.patch('<section data-card="c5" data-kind="decision" data-status="decided"><h3>Setup data: progressive wizard</h3></section>')
huddle.cards()          // [{ id, kind, lane, title }]
huddle.model('c5')      // the card as the fields above, or null if it doesn't fit them
huddle.context()        // brief, protocol, threads (notes), revisions (change log)
```

A patch that breaks the card rules throws a `HuddleError` and leaves the card unchanged.
The rules live in `src/rules.mjs`, and every board carries them in plain words in its
context block.

## Checks

```bash
npm run lint
```

```bash
npm test
```

`lint` fails if any tracked or untracked, non-ignored text file is over 1000 lines.
Generated boards outside ignored directories are checked too; `npm run demo` writes to
ignored `dist/`. The tests open real boards in a headless Chrome or Edge. Set
`HUDDLE_BROWSER` to the browser executable if it isn't in its usual place.

A pre-commit hook in `.githooks/` runs the lint check. Turn it on once per clone:

```bash
git config core.hooksPath .githooks
```
