# Channel Green

*Somewhere to belong.*

Channel Green is an open-source social universe by [ZeroTheory](https://zerotheoryapp.tech): a cozy pixel-art 2D world where you walk around with friends and strangers, sit in a cafe, watch something together, share a quiet pond, or leave an anonymous note on the confession wall. It is built to feel like a late-evening room, not a dashboard.

Status: early MVP. It runs, two people can walk around and talk in it, but it has not been deployed anywhere and several parts are unfinished. See the honest status below.

## What is in the world

- A walkable pixel-art town and nine other rooms: Cafe, Confession Wall, Garden, Listening Room, Living Room, Quiet Pond, Rain Room, Rooftop, TV Lounge.
- A small avatar editor (hair, hats, tops, bottoms, shoes, colours).
- Emotes, room chat and a people list with block and report.
- Voice and video through LiveKit, only after you explicitly say yes. Off by default.
- Watch Together and a Listening Room: synchronised playback of links you supply (YouTube embeds, direct video or audio links). No ripping, no DRM tricks.
- Calm soundscapes generated in the browser. All art and sound is code or data in this repository.

## Quickstart

You need Node 20.9 or newer.

    npm install
    npm run dev

Open http://localhost:3000, press Play and join as a guest. Open a second browser window to see yourselves meet. With no keys at all the world runs in guest mode with in-memory storage and voice/video shown as unavailable.

Useful commands:

    npm run typecheck   # types across all packages
    npm run lint
    npm test            # unit and integration tests
    npm run e2e         # two real clients against a real server
    npm run build       # content registry, realtime server, web app
    npm run content:check

Copy `apps/realtime/.env.example` and `apps/web/.env.example` if you want to change anything. Every variable is explained in [docs/ENV.md](docs/ENV.md).

## How it is built

    apps/web         Next.js site and the Phaser game client
    apps/realtime    Socket.IO world server (rooms, movement, chat, safety, tokens)
    packages/shared  Pure game logic used by both sides (geometry, text rules, media parsing)
    packages/content Content packs (maps, furniture, avatar parts, sounds) and the registry builder
    supabase         Database schema for optional accounts and persistence

Why the realtime server is a separate service: the world needs long-lived WebSocket connections and shared in-memory room state. Vercel-style serverless hosting does not keep connections open, so the web app goes on Vercel and the realtime server runs on a host that stays on (a container on Fly, Render, Railway or any VPS). The web app only needs to know the realtime server's public address.

Safety is enforced on the server, not the browser: rate limits, word filtering, per-player blocks, reports, bans, and guide (moderator) powers.

## Honest feature status

Checked by running it (typecheck, lint, tests and a real browser session):
- Install, typecheck, lint, unit and integration tests, and production build all pass.
- Landing page, guest entry, avatar editor, walking in Town Square.
- Two browser windows in the same room see each other, see each other move, and exchange chat messages.
- The server health check and the site's "is the world awake" indicator.
- The server runs without Supabase or LiveKit keys.

Built and covered by automated tests, but not clicked through in a browser by us:
- Watch Together and Listening Room sync, room switching and private rooms, confession wall, blocking and reporting, moderation tools.

Built but never run against the real service:
- Voice and video with LiveKit (needs keys; the interface shows as disabled without them).
- Supabase sign-in and the database store (the schema is written but has not been applied to a real project).
- The realtime Dockerfile (written, not built here).

Known rough edges:
- Some labels (for example the Quiet Pond portal) overlap the emote bar on small screens.
- Movement speed is tied to frame rate on very slow devices.
- Mobile touch controls are not built.
- Accessibility has had a first pass only (no full audit).

## Roadmap

Not done yet:
- [ ] Real deployment (nothing is live; see docs/DEPLOYMENT.md)
- [ ] Apply and test the Supabase schema with real sign-in
- [ ] Test voice and video with a real LiveKit project
- [ ] Browser end-to-end tests for panels beyond chat
- [ ] Touch controls for phones
- [ ] Keyboard-only and screen-reader audit
- [ ] Proper moderation dashboard for guides
- [ ] More rooms, more avatar parts, community content packs
- [ ] Persistent furniture placement for home rooms

## Contributing

Rooms, furniture, avatar parts and soundscapes are plain data files, so you can add to the world without touching game code. See [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Community Guidelines](COMMUNITY_GUIDELINES.md). Security issues go through [SECURITY.md](SECURITY.md).

## Credits and licence

Code is MIT licensed. Core content pack data is CC-BY-SA-4.0. Fonts are open source under the SIL Open Font License. Full list in [ATTRIBUTIONS.md](ATTRIBUTIONS.md). The mood is inspired by quiet, warm, late-night music; no artwork or audio from any artist is used.
