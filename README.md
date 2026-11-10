# huddle-axi

Status: planning. No code yet.

A planned board for running a discussion on a shared screen. The facilitator comments
on one card and the agent rewrites just that card, in place, in a few seconds. The rest
of the page never reloads.

It builds on the ideas in [lavish-axi](https://github.com/kunchenguid/lavish-axi) but
goes its own way. The plan:

- **One portable HTML file.** The runtime is inlined. Save writes the live state back
  into the file, so it carries the cards, threads and decisions with it.
- **Rigid cards.** A fixed set of card types with fixed tags. The agent never writes
  CSS or JS.
- **Card-level patches.** The agent reads and writes one card at a time as TOON, and
  the CLI converts that to restricted HTML in the file.
- **One writer.** Only the facilitator edits. The room watches the shared screen.

The reviewed plan is in `lavish-fast-plan.html`.

## Checks

```bash
npm run lint
```

Fails if any text file in the repo is over 1000 lines. The single-file board is built
into `dist/` (ignored) from smaller source files, so the cap applies to the sources.
A pre-commit hook in `.githooks/` runs the same check. Turn it on once per clone:

```bash
git config core.hooksPath .githooks
```
