# makefun-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/nuannan13579/makefun-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/nuannan13579/makefun-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Launch Radar ranks the protocols that record no token yet by implied value: what a token would be worth if the protocol's record stayed exactly as the sealed snapshot shows it. The evidence is the snapshot's own tokenized protocols — each gives a market-cap-to-TVL multiple, and a category's multiple is the median of its comps (outliers trimmed), shrunk toward its family's median when the category is thin. A protocol's base value is its TVL times that multiple, adjusted for its 7-day TVL momentum, its tracked age and its chain breadth, with every factor printed so any row can be re-computed by hand. The board covers the whole watchlist and keeps going below its floor, sets exchanges, bridges and wrapped products aside, and gives every ranked protocol a six-step farm plan written from its own category, chains, size and age. The dashboard is a static page — sortable, filterable, with a detail view per protocol and the full method — that renders the board offline from the generated data.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
```

With no `--input`, the program reads the grader's sealed snapshot at `/input/snapshot.json`; `--input` also accepts the directory holding it. It writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory.

---
<sub>Entered on [make.fun](https://make.fun/?ref=9959qcny&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
