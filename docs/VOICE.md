# Voice and video

Voice and video use [LiveKit](https://livekit.io), which is open source. The realtime server holds the LiveKit keys and hands each player a short-lived token for one room. The browser connects to LiveKit directly. Nothing is recorded or stored by Channel Green.

## What the player sees (the rules the code follows)

- Joining the voice room is listen-only. The microphone and the camera are never asked for until the player presses their own button ("Turn microphone on", "Turn camera on"). Opening the panel, ticking a consent box, and joining do not touch the devices.
- While the microphone or camera is live, a banner at the top of the panel says so, and the people list shows who is speaking and who has a camera on.
- One click turns each off again. Turning off releases the device, so the browser's recording light goes out.
- Closing the panel, pressing "Leave voice", leaving the world, or closing the tab stops every track and leaves the voice room.
- Players you block or mute are not listed, not heard and not shown on video. We unsubscribe from their tracks, so their audio and video are not received at all. Blocking works both ways. Unblocking brings them back.
- In rooms with proximity voice (Town Square, Cafe, Garden, Rooftop) voices fade with distance in the world. Full volume within 48 pixels, silent beyond 240. Rooms set to "off" (Confession Wall, Rain Room, Quiet Nook) have no voice at all.
- Clear messages for: permission denied, no microphone or camera found, device busy, could not get a token, could not reach LiveKit, connection lost and retrying, removed from the room, joined from another tab.
- Without keys the panel says voice is not set up. It never pretends.

## Settings that turn it on

Realtime server only. All three are needed, otherwise voice stays off.

    LIVEKIT_URL=wss://<your-project>.livekit.cloud
    LIVEKIT_API_KEY=<key>
    LIVEKIT_API_SECRET=<secret>

The web app needs no LiveKit setting. It learns the address from the realtime server. Never put the secret in the web app or commit it.

### LiveKit Cloud (easiest)

1. Create a free project at https://cloud.livekit.io.
2. In the project, open Settings, then Keys, and create a key. Copy the WebSocket URL (starts with `wss://`), the API key and the API secret.
3. Put the three values into the environment of the realtime server (for example in the host's environment variables page) and restart it.
4. Open the site, go to a room that allows voice, open the Voice panel. It should now offer "Join voice".

### Self-hosting livekit-server

Follow https://docs.livekit.io/home/self-hosting/deployment/. You need a public host with a domain and a TLS certificate (browsers only allow microphone and camera on https pages, and an https page can only connect to `wss://`), and open ports for the signalling (443 or 7880), TCP 7881 and UDP media. Create a key pair in its config file (`keys: { <key>: <secret> }`) and use the same pair in the three settings above.

## Running a local LiveKit for development

No account needed. `livekit-server` is a single binary.

1. Download the release for your system from https://github.com/livekit/livekit/releases (for Linux: `livekit_<version>_linux_amd64.tar.gz`), unpack it somewhere outside the repository.
2. Start it in dev mode. Dev mode uses the fixed local-only keys `devkey` and `secret`:

       ./livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1

3. Start the realtime server with those keys:

       LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret npm run dev -w @channel-green/realtime

   (`ws://` is fine on localhost. Browsers treat localhost as secure, so the microphone and camera work.)
4. Start the web app (`npm run dev -w @channel-green/web`), open http://localhost:3000/play in two windows, pick the Voice panel in each.

The dev keys are public knowledge. Never use them on a server reachable from the internet.

If your machine uses an HTTP proxy for outgoing traffic, exclude localhost (`NO_PROXY=localhost,127.0.0.1`) or the realtime server cannot reach LiveKit.

## Automated two-browser check

`scripts/voice-e2e.mjs` drives two Chromium windows against a local LiveKit with fake microphone and camera devices (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, so no hardware is needed). It checks that the devices are never opened before a click, mute and unmute, camera on and off, the indicators, proximity volume, blocked and muted players, and that closing the panel, leaving and closing the tab stop all tracks. It also checks the denied-permission, no-device and bad-token messages.

    # needs: livekit-server --dev running, realtime and web running as above,
    # and playwright-core installed somewhere (it is not a project dependency)
    NODE_PATH=<folder containing node_modules/playwright-core> CHROMIUM=/usr/bin/chromium node scripts/voice-e2e.mjs

Screenshots go to `$SHOTS` (default `/tmp/voice-shots`). It is not part of `npm test` because it needs a browser and a running LiveKit.

Fake devices play a beeping tone and a moving test pattern. This proves the plumbing, not how real hardware or real networks behave.

## Manual test with your own LiveKit keys

Do this once after setting the three values on the realtime server. Use two different browsers (or one normal and one private window) and two guests, on https.

1. Open the site in both, join as two guests, stay in Town Square.
2. Both open Voice. Without ticking anything, "Join voice" is greyed out. Tick the consent box, press Join. Check that your browser did NOT ask for the microphone yet (no permission popup, no recording light).
3. In window A press "Turn microphone on". Now the browser asks. Allow. A banner says your microphone is live. Say something. In window B you should hear A, and A's row shows "speaking".
4. Press "Turn microphone off". The banner goes, the browser's recording light goes out, B stops hearing A.
5. In A tick the camera consent box, press "Turn camera on", allow. B sees a video tile and "camera on" for A. Press "Turn camera off": the tile disappears for both.
6. Walk A away from B (more than a few screens). B hears A get quieter until silent. Walk back and it returns.
7. In B open People and block A. B should stop hearing A and stop seeing A's video. Unblock to restore.
8. In A press "Leave voice", then repeat step 3 and close the Voice panel: the recording light must go out and B must see A leave.
9. Denied permission: in A's browser site settings block the microphone, press "Turn microphone on". You should see a calm message and the microphone stays off.
10. Disconnect A's network for a few seconds: status says it is trying to get back, and recovers on its own (or says it could not and offers Join again).
11. On a phone, repeat steps 2 to 5 (Safari and Chrome). Autoplay rules differ: if you hear nothing, a button "Press to hear others" appears.
