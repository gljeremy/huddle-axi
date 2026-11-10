# Agent notes

- Run `npm run lint` and `npm test` before you finish. Lint fails if any text file is over
  1000 lines: split the file instead of raising the cap. The tests drive a headless Chrome
  or Edge; set `HUDDLE_BROWSER` if neither is in its usual place.
- A board is built from `src/` by `huddle-axi new`. Edit the sources (`runtime.js`,
  `runtime.css`, `board-template.html`, `rules.mjs`), not a generated board.
- `src/rules.mjs` is the single source for the card rules. The runtime's validator and the
  protocol text inside each board are both generated from it.
