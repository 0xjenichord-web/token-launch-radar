# Token Launch Radar

A token launch radar: protocols that record no token, ranked by an
implied launch value worked out from the sealed snapshot alone.

## What it is

`main.ts` (Node 22, standard library only) reads the snapshot at
`/input/snapshot.json`, scores every pre-token protocol, and writes:

- `board.json` — 200 ranked rows, all 40 watchlist slugs covered
- `data.js` — the dashboard's dataset, offline
- `dashboard/` — the static page (no network)
- `screenshots/` — three views of the dashboard
- `dossier.json` — built with `vendor/makefun-board.ts`

## The model

Implied value = TVL x peer multiple x growth factor x age factor x
chain-breadth factor, where the peer multiple is the median
mcap/TVL of tokenised protocols in the same category (overall median
when fewer than three peers exist). Growth is the seven-day TVL
change clipped to -30%..+30%. Age is days since first tracked.
No protocol name is special-cased, and a protocol that records no
token is never described as having no token: that is not a
prediction that a token will launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

## Screenshots

The three images in `screenshots/` are placeholders rendered without
a browser. Replace them with real renders of this dashboard before
submitting: the board, a protocol detail view, and a filtered view.
