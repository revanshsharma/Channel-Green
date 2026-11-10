# Contributing to Channel Green

Thank you for helping make somewhere to belong. You do not need to write code to contribute: most of the world is plain data in content packs.

## Setup

    npm install
    npm run dev          # site on :3000, world server on :4001
    npm run content:check
    npm run typecheck && npm run lint && npm test

Work on a branch and open a pull request. Keep changes small and say what you tried.

## Content packs

Everything lives in `packages/content/packs/<pack-id>/`. The core pack is `core`. A pack has a `pack.json` (id, name, version, author, licence, description) and any of these:

- `maps/*.json` rooms
- `furniture/*.json` furniture sprites
- `avatar/*.json` avatar parts: hair, hats, tops, bottoms, shoes, face, neck, swatches
- `tiles.json` floor and wall tiles
- `soundscapes.json` ambient sound recipes
- `emotes.json` and `tapes.json`

After any change run:

    npm run content:check    # validates every pack and fails if the registry is out of date
    npm run content:build    # regenerates packages/content/generated/registry.json (commit it)
    npm run content:preview  # look at your content

All art is drawn from data (rectangles with colours), so there are no image files to license. Do not copy artwork, sprites or audio from other games or artists.

### Add a room (map)

Copy a small map such as `maps/quiet-nook.json`. A map has an id, name, short blurb, category, capacity, whether private rooms are allowed, a voice setting (`off` for quiet rooms), an ambience (a soundscape id), tiles, `objects` (furniture placed by id at pixel positions), `portals` (rectangles in tiles that lead to another map and spawn point), `spawns`, and optional `effects`. Every portal must point to a map and spawn that exist, and rooms must have a way back. The validator tells you what is wrong.

### Add furniture

Add an entry to `furniture/furniture.json` with an id, name, `size` in pixels and `parts`, a list of `[x, y, width, height, colour]` rectangles. Keep it readable at small size and stay inside the palette (forest green, olive, cream, off-white, soft orange, charcoal; neon green sparingly).

### Add avatar parts

Add an entry to the right file in `avatar/`: id, name, slot, and `views` for `down`, `up` and `side`, each a list of rectangles. Use the palette letters (such as `C` and `c`) so the wearer's colour choice applies. Provide all three views.

### Add a soundscape

Add a recipe to `soundscapes.json`: an id, a name and `layers` such as `noise`, `crickets` or `chimes`, each with a `gain` and its own settings. Keep gains low. These play in the browser, so sounds are made from code, not recordings. If you do contribute a recording, it must be your own or openly licensed, and listed in ATTRIBUTIONS.md.

## Code changes

- Shared rules that both sides need go in `packages/shared` with tests.
- Server behaviour and safety go in `apps/realtime` with tests. Never trust the browser.
- Do not add tracking, ads, or anything that records voice or video.
- Voice and video must stay opt-in. Watch Together may only use links people supply; no ripping, no DRM bypassing.
- Update the README status section when something moves between done and not done. Do not claim what you did not test.

## Pull requests

Describe what changed and how you checked it. Include a screenshot for anything visual. By contributing you agree your code is MIT licensed and your content pack data is licensed as stated in its `pack.json`.
