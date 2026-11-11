# huddle-axi

Status: step 3 built. The agent loop (`open`, `poll`, `patch`) works end to end, and the
meeting tools (quick actions, undo, change highlights, present mode, export) are in and
tested in a headless browser. They haven't been used in a real meeting yet. See [bench/REAL-MODEL.md](bench/REAL-MODEL.md) for the real-model measurements,
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

## In the meeting

These work with or without an agent, and none of them calls a model.

- **Quick actions:** hover a card for a bar of buttons along its bottom edge.
  - Every card: **↑** and **↓** reorder it in its lane, and **Move to…** sends it to
    another lane.
  - Decisions: **Decide** / **Reopen**, and **+Option** (type the label, then Enter).
    Each option has **−** and **+** for votes and **✓** to choose it. Choosing an option
    decides the card; choosing it again reopens the decision.
  - Risks: **Severity** steps through high, medium and low.
  - Metrics: **−10** and **+10** move the progress bar.
  - Actions: **Status** steps through not started, in progress and done.
  - Cards with two or more bullets: **Split** turns each bullet into its own card.
- **Undo:** **Undo** on a card puts back its previous version, whether the change came from
  you or the agent. Each card remembers its last 10 versions in the file, so undo still
  works after a reload. Undo on a card made by Split removes that card. Moves are not
  undone; move the card back instead.
- **What changed:** a changed card gets a thick yellow ring for a few seconds, and each
  part that is new or different (a title, a bullet, an option) is highlighted. It's loud
  on purpose, so it still shows through a compressed screen share.
- **Present:** **Present** in the toolbar switches to projector-size type (28px, with
  **A−** and **A+** to adjust) and lets the board use the full width. It's never saved
  into the file.
- **Export:** **Export** in the toolbar downloads either:
  - meeting notes as Markdown: every card grouped by kind, chosen options ticked, details
    and notes included;
  - a read-only snapshot: the board as it looks now, notes included, as plain HTML with
    no runtime, controls or saved context. It's safe to email.

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
node src/cli.mjs poll my-board.html --out card.html
```

`poll` waits for the next note (8 minutes by default, `--timeout-ms` to change) and prints
the note, the earlier notes on that card, the board's title and brief, and the card
itself. At delivery it asks the browser for the current card, so queued notes include
previous rewrites; if the browser does not answer within a second, it uses the snapshot
captured when the note was submitted. With `--out`, the card goes to that file, ready
for a targeted edit.

The card comes as its `<section>` HTML, following the card rules below. This default
follows the [step 2 format comparison](bench/REAL-MODEL.md#verdict).
`poll --format toon` opts into TOON instead. A card in TOON looks like this:

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
With `--format toon`, a card whose markup doesn't fit the model is still printed as its
`<section>` HTML (`format: html`). The header's `format` always says which you got.

```bash
node src/cli.mjs patch my-board.html --card-file card.html --note "marked decided"
```

`patch` takes the edited card as one `<section>` or as TOON, from `--card-file` or
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
huddle.context()        // brief, protocol, threads (notes), revisions (change log), history (undo)
huddle.undo('c5')       // put back the card's previous version
huddle.add(html, { lane: 'plan' })   // or { after: 'c14' }; huddle.newId() gives a free id
huddle.move('c5', { before: 'c7' })  // or { lane: 'plan' } for the end of a lane
huddle.quick.vote('c5', 1, +1)       // also choose, decide, addOption, severity, progress,
                                     // actionStatus, split, up, down, moveTo
huddle.present(true)    // projector-size type; huddle.present(false) to leave
huddle.exportNotes()    // the Markdown notes, as a string
huddle.exportSnapshot() // the read-only snapshot, as a string
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
