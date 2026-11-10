# huddle-axi

Status: step 1 done. The single-file board runtime works on its own. The agent loop
(`poll` and `patch` from the CLI) is step 2 and isn't built yet. Step 0's measurements are
in [bench/RESULTS.md](bench/RESULTS.md).

A board for running a discussion on a shared screen. The facilitator comments on one card
and the agent rewrites just that card, in place, in a few seconds. The rest of the page
never reloads.

It builds on the ideas in [lavish-axi](https://github.com/kunchenguid/lavish-axi) but
goes its own way:

- **One portable HTML file.** The runtime is inlined. Save writes the live state back
  into the file, so it carries the cards, notes and change log with it.
- **Rigid cards.** Eight card kinds (goal, decision, risk, metric, idea, action, note, and
  html as the escape hatch) with a fixed set of tags. The agent never writes CSS or JS.
- **Card-level patches.** One card changes at a time, swapped in place with a glow that
  survives a screen share. In step 2 the agent will read and write cards as TOON, and the
  CLI will convert that to the restricted HTML in the file.
- **One writer.** Only the facilitator edits. The room watches the shared screen.

The reviewed plan is in `lavish-fast-plan.html`.

## Try it

```bash
node src/cli.mjs new my-board.html --sample
```

Open `my-board.html` in Chrome or Edge.

- **Leave a note for the agent:** hover a card and press **Note**.
- **Save:** press **Save** or Ctrl+S. This writes the board back to the file, notes included.

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

`lint` fails if any text file in the repo is over 1000 lines. Generated boards go wherever
you write them, and `dist/` (ignored) is used by `npm run demo`, so the cap applies to the
sources. The tests open real boards in a headless Chrome or Edge. Set `HUDDLE_BROWSER` to
the browser executable if it isn't in its usual place.

A pre-commit hook in `.githooks/` runs the lint check. Turn it on once per clone:

```bash
git config core.hooksPath .githooks
```
