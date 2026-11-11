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
- Typecheck, lint, the content check and all automated tests (realtime, web and shared suites) passed in the latest pass. A fresh production build was not re-run.
- Landing page, guest entry, avatar editor, walking in Town Square.
- Two browser windows in the same room see each other, see each other move, and exchange chat messages.
- The server health check and the site's "is the world awake" indicator.
- The server runs without Supabase or LiveKit keys.

Also clicked through in a real browser earlier: private rooms, Watch Together sync, the People panel, the Rooftop, the disabled voice panel, and frame-rate independent walking.

Checked with two guest browsers in the latest pass (the test browser used the plain canvas fallback, no GPU):
- Confession wall: posting anonymously, the post appearing live for the other player with no author, hearts, reporting, and the posting limit.
- Listening Room: a tape picked by one player plays for the other, a pasted audio link plays in step on both, and pause carries over.
- Mute hides that player's chat for you only. Block hides both players from each other (no frozen ghost left behind) and unblock brings them back. This found and fixed a real bug.

Built and covered by automated tests only: moderation tools for guides, bans.

Added in the latest pass and looked at in screenshots only (no automated checks):
- The dusk look: per-room light and colour, vignette, grain (turned down in the latest pass and re-checked in Town Square, Rooftop and Rain Room) and drifting dust, the warm landing page with cream typography and pool-water shimmer. Everything respects the reduced-motion setting.
- Touch controls (move pad, interact and chat buttons, phones only) and an accessibility pass (focus outlines, labels, Escape closes panels, skip link).

Voice and video, checked with two real Chromium windows against a local LiveKit server in dev mode and fake microphone and camera devices (the repeatable script is `scripts/voice-e2e.mjs`, setup in docs/VOICE.md). All of it passed in the latest run:
- Nothing asks for the microphone or camera until you press its own button; joining is listen-only and needs a consent tick first.
- Mic and camera turn on and off with one click, the devices are really released when off, and the other player sees who is speaking, who has the mic on and who has a camera on (and the video is decoding).
- Volume in the proximity rooms falls with distance.
- Muted and blocked players are not heard or shown, and come back on unmute or unblock.
- Closing the panel, pressing Leave voice and closing the tab all stop every track and remove you from the room.
- Clear messages for a refused token, a blocked microphone and a missing microphone.
- The token logic and the pure client logic have unit tests.

Voice and video not yet checked: LiveKit Cloud or a self-hosted server on a real network (TURN, firewalls), real microphones and cameras, Safari and Firefox, phones, and many people in one room. The interface still shows as disabled, with the reason, when no LiveKit keys are set.

Built but never run against the real service:
- Supabase sign-in and the database store (the schema is written but has not been applied to a real project).
- The realtime Dockerfile (written, not built here).

Known rough edges:
- Portal labels no longer sit under the emote bar (the camera now leaves room), but this was only eyeballed on a few screen sizes.
- Touch controls exist but have not been tried on a real phone.
- Accessibility has had a second pass, not a full audit with a screen reader.
- The grain was turned down after looking strong on large grass areas; the colours and strengths are still first guesses and were judged by eye.
- The two-browser checks for voice and video are a script in this repository (`scripts/voice-e2e.mjs`) but need a local LiveKit server and a browser, so they are not part of `npm test`. The earlier checks for confessions, Listening Room and block/mute were run by a script kept outside the repository.

## Roadmap

Not done yet:
- [ ] Real deployment (nothing is live; see docs/DEPLOYMENT.md)
- [ ] Apply and test the Supabase schema with real sign-in
- [x] Test voice and video against a local LiveKit server with two browsers and fake devices (`scripts/voice-e2e.mjs`)
- [ ] Test voice and video with a LiveKit Cloud project, real devices and other browsers (steps in docs/VOICE.md)
- [ ] Browser end-to-end tests for panels beyond chat
- [x] Touch controls for phones (first version, needs a real-phone test)
- [ ] Full keyboard-only and screen-reader audit
- [x] Browser test of confession wall, Listening Room and block/mute with two players (done by hand-run script; not yet automated in the repo)
- [ ] Proper moderation dashboard for guides
- [ ] More rooms, more avatar parts, community content packs
- [ ] Persistent furniture placement for home rooms

## Contributing

Rooms, furniture, avatar parts and soundscapes are plain data files, so you can add to the world without touching game code. See [CONTRIBUTING.md](CONTRIBUTING.md). Please read the [Code of Conduct](CODE_OF_CONDUCT.md) and [Community Guidelines](COMMUNITY_GUIDELINES.md). Security issues go through [SECURITY.md](SECURITY.md).

## Credits and licence

Our quote: SUCH IS LIFE. Code is MIT licensed. Core content pack data is CC-BY-SA-4.0. Fonts are open source under the SIL Open Font License. Full list in [ATTRIBUTIONS.md](ATTRIBUTIONS.md). The mood is inspired by quiet, warm, late-night music; no artwork or audio from any artist is used.
