# Channel Green

*Somewhere to belong.*

**SUCH IS LIFE.** is our quote.

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
- Install, typecheck, lint and tests passed before the latest pass; in the latest pass only the typecheck was confirmed on the build machine (see the roadmap). A fresh production build was not re-run.
- Landing page, guest entry, avatar editor, walking in Town Square.
- Two browser windows in the same room see each other, see each other move, and exchange chat messages.
- The server health check and the site's "is the world awake" indicator.
- The server runs without Supabase or LiveKit keys.

Also clicked through in a real browser earlier: private rooms, Watch Together sync, the People panel, the Rooftop, the disabled voice panel, and frame-rate independent walking.

Built and covered by automated tests, but not re-checked in a browser in the latest pass:
- Confession wall, Listening Room sync, blocking and reporting, moderation tools. A two-window browser run of these was started but the test browser kept dropping out on the build machine, so it was not completed.

Added in the latest pass and looked at in screenshots only (no automated checks):
- The dusk look: per-room light and colour, vignette, grain and drifting dust, the warm landing page with cream typography and pool-water shimmer. Everything respects the reduced-motion setting.
- Touch controls (move pad, interact and chat buttons, phones only) and an accessibility pass (focus outlines, labels, Escape closes panels, skip link).

Built but never run against the real service:
- Voice and video with LiveKit (needs keys; the interface shows as disabled without them).
- Supabase sign-in and the database store (the schema is written but has not been applied to a real project).
- The realtime Dockerfile (written, not built here).

Known rough edges:
- Portal labels no longer sit under the emote bar (the camera now leaves room), but this was only eyeballed on a few screen sizes.
- Touch controls exist but have not been tried on a real phone.
- Accessibility has had a second pass, not a full audit with a screen reader.
- The grain can look strong on large grass areas; the colours and strengths are first guesses.

## Roadmap

Not done yet:
- [ ] Real deployment (nothing is live; see docs/DEPLOYMENT.md)
- [ ] Apply and test the Supabase schema with real sign-in
- [ ] Test voice and video with a real LiveKit project
- [ ] Browser end-to-end tests for panels beyond chat
- [x] Touch controls for phones (first version, needs a real-phone test)
- [ ] Full keyboard-only and screen-reader audit
- [ ] Browser test of confession wall, Listening Room and block/mute with two players
- [ ] Proper moderation dashboard for guides
- [ ] More rooms, more avatar parts, community content packs
- [ ] Persistent furniture placement for home rooms

## Contributing

Rooms, furniture, avatar parts and soundscapes are plain data files, so you can add to the world without touching game code. See [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Community Guidelines](COMMUNITY_GUIDELINES.md). Security issues go through [SECURITY.md](SECURITY.md).

## Credits and licence

Our quote: SUCH IS LIFE. Code is MIT licensed. Core content pack data is CC-BY-SA-4.0. Fonts are open source under the SIL Open Font License. Full list in [ATTRIBUTIONS.md](ATTRIBUTIONS.md). The mood is inspired by quiet, warm, late-night music; no artwork or audio from any artist is used.
