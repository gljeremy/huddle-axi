# huddle-axi

Status: step 1 done. The single-file board runtime works on its own. The agent loop
(`poll` and `patch` from the CLI) is step 2 and isn't built yet. Step 0's measurements are
in [bench/RESULTS.md](bench/RESULTS.md).

A board for running a discussion on a shared screen. The facilitator leaves notes on
cards and can patch one card in place through the browser console, without reloading the
page. The planned agent loop will turn those notes into card rewrites.

It builds on the ideas in [lavish-axi](https://github.com/kunchenguid/lavish-axi) but
goes its own way:

- **One portable HTML file.** The runtime is inlined. Save writes the live state back
  into the file, so it carries the cards, notes and change log with it.
- **Rigid cards.** Restricted HTML with fixed tags, plus an `html` escape hatch for
  diagrams and one-offs. See the card rules below for the authoritative restrictions.
- **Card-level patches.** One card changes at a time, swapped in place with a glow that
  survives a screen share. In step 2 the agent will read and write cards as TOON, and the
  CLI will convert that to the restricted HTML in the file.
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

From the browser console, `huddle` is the page API, which step 2 will drive:

```js
huddle.patch('<section data-card="c5" data-kind="decision" data-status="decided"><h3>Setup data: progressive wizard</h3></section>')
huddle.cards()          // [{ id, kind, lane, title }]
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
