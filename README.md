# SKYRING — Coral Chain Ring-Run

Fly the Kestrel through 12 gold rings over the Coral Chain, then land on the Gull Island runway before the 240-second clock runs out.

## The game

A 3D arcade flight game (Three.js, vendored under game/vendor/three). Chase view over a seeded island archipelago: Turtle Rock, Twin Peaks, Coral Bay, Palm Cay, Anchor Rock, Mist Point and Gull Island. Rings pay 1000 x combo; missing one breaks the combo. Wind veers through the run. Crash into terrain or the sea, or run out of time, and the run ends. A clean landing after all 12 rings wins, with a time bonus.

## Controls

W/S throttle, Arrow Up/Down pitch, Arrow Left/Right bank, mouse steers, R restart, P pause. Enter or click to take off.

## Screenshots

The cover (1-play.jpg) is a dense mid-flight moment: the Kestrel banking through a ring over the islands, HUD lit with altitude, speed, heading, ring count, score and combo. 2-start is the briefing over the runway, 3-approach the final approach with the runway ahead, 4-end the WIN screen with the final score.

## Run it

```
node serve.ts            # http://localhost:8080
node playtest.mjs        # rules + headless browser playtest
node capture.mjs         # screenshots/ from the real game
MAKEFUN_OUTPUT_DIR=out node main.ts   # package game + screenshots + dossier
```

## Entry

Owner + payout: 9vSzBPphkDoHMBPy3Q3nLRKxzT5fwDcyDVhxHnq6bk9n

Competition: best-flight-game-20261126-0057 — "Make the best flight game you can"

No entry fee. Deadline 28 Nov 2026 07:57 WIB.

[![make.fun](https://make.fun/badge/best-flight-game-20261126-0057.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Rank](https://make.fun/badge/best-flight-game-20261126-0057/ayukwulan/flight-game-best/rank.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)
[![Reward](https://make.fun/badge/best-flight-game-20261126-0057/ayukwulan/flight-game-best/reward.svg)](https://make.fun/bounty/best-flight-game-20261126-0057)

SPDX-License-Identifier: MIT
Copyright (c) 2026 ayukwulan
