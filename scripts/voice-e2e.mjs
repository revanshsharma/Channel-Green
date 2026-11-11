// Two-browser voice and camera check against a LOCAL livekit-server in dev mode.
// Needs: realtime server (with LIVEKIT_URL=ws://127.0.0.1:7880 and the dev keys), the web app on :3000,
// livekit-server --dev running, and playwright-core + chromium available (see docs/VOICE.md).
// Run:  NODE_PATH=<dir with node_modules/playwright-core> node scripts/voice-e2e.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
const { chromium } = createRequire(import.meta.url)('playwright-core');
const BASE = process.env.WEB ?? 'http://localhost:3000';
const SHOTS = process.env.SHOTS ?? '/tmp/voice-shots';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  -> ' + extra : ''}`);
  return !!cond;
};
const BASEARGS = ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--disable-webgl', '--disable-3d-apis', '--disable-extensions'];
// Without a granted media permission Chromium hides host ICE candidates behind mDNS names, which a loopback-only server cannot resolve. Switch that off for the browsers that never get permission.
const MDNS_OFF = '--disable-features=WebRtcHideLocalIpsWithMdns';
const launch = (extra = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']) =>
  chromium.launch({ executablePath: process.env.CHROMIUM ?? '/usr/bin/chromium', args: [...BASEARGS, ...extra] });

const INIT = () => {
  // count every request for the microphone or camera, and remember the tracks so we can check they end
  const g = (window.__gum = { calls: [], tracks: [] });
  const md = navigator.mediaDevices;
  if (!md) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async (c) => {
    g.calls.push({ audio: !!c?.audio, video: !!c?.video, at: Date.now() });
    const s = await orig(c);
    s.getTracks().forEach((t) => g.tracks.push(t));
    return s;
  };
};

async function guest(br, name) {
  const ctx = await br.newContext({ viewport: { width: 1100, height: 720 } });
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
  await ctx.route('http://localhost:4001/**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-forwarded-for': ip } }));
  await ctx.addInitScript(INIT);
  const page = await ctx.newPage();
  page.nm = name;
  page.on('pageerror', (e) => console.log(`[${name}] pageerror: ${e.message.slice(0, 160)}`));
  await page.goto(BASE + '/play', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('input.field').first().fill(name);
  await page.getByRole('button', { name: 'Walk in' }).click();
  await page.waitForFunction(() => window.__cgDev && window.__cgDev.session.me, null, { timeout: 120000, polling: 500 });
  await sleep(800);
  return { ctx, page };
}
const gum = (p) => p.evaluate(() => window.__gum.calls.length);
const liveTracks = (p) => p.evaluate(() => window.__gum.tracks.filter((t) => t.readyState === 'live').length);
const tid = (p, id) => p.getByTestId(id);
const panelBtn = (p) => p.getByRole('button', { name: /^Voice\s*\d*$/ });
async function openVoice(p) {
  if ((await panelBtn(p).getAttribute('aria-pressed')) !== 'true') await panelBtn(p).click();
  await tid(p, 'voice-panel').waitFor({ timeout: 10000 });
}
async function closeVoice(p) {
  if ((await panelBtn(p).getAttribute('aria-pressed')) === 'true') await panelBtn(p).click();
  await sleep(400);
}
async function joinVoice(p) {
  await p.getByRole('checkbox').first().check();
  await p.getByRole('button', { name: /Join voice/ }).click();
  await p.waitForFunction(() => document.querySelector('[data-testid=voice-panel]')?.dataset.phase === 'on', null, { timeout: 30000 });
}
const rows = (p) => p.evaluate(() => [...document.querySelectorAll('[data-testid=voice-person]')].map((e) => ({ self: e.dataset.self === '1', name: e.textContent.split(/speaking|mic o/)[0].trim(), speaking: e.dataset.speaking === '1', cam: e.dataset.cam === '1', mic: e.dataset.mic === '1', volume: +e.dataset.volume })));
const waitFor = async (fn, ms = 15000, step = 300) => { const t = Date.now(); while (Date.now() - t < ms) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(step); } return false; };
const otherRow = async (p) => (await rows(p)).find((r) => !r.self);

const br = await launch();
try {
  // -------- 1. nothing touches the devices before a click
  const A = await guest(br, 'Amber');
  const B = await guest(br, 'Dusk');
  const a = A.page, b = B.page;
  const uidB = await b.evaluate(() => window.__cgDev.session.me.uid);
  await openVoice(a); await openVoice(b);
  await sleep(1500);
  ok('no mic/camera request while the panel is just open', (await gum(a)) === 0 && (await gum(b)) === 0);
  ok('Join stays disabled until the consent box is ticked', await a.getByRole('button', { name: /Join voice/ }).isDisabled());
  await a.screenshot({ path: `${SHOTS}/01-before-join.png` });
  await joinVoice(a); await joinVoice(b);
  await sleep(1500);
  ok('joining the voice room (listen only) asks for no mic and no camera', (await gum(a)) === 0 && (await gum(b)) === 0, `gum A=${await gum(a)} B=${await gum(b)}`);
  ok('nobody is live after joining: no banner', (await tid(a, 'live-banner').count()) === 0);
  ok('both players are listed in voice for each other', await waitFor(async () => (await rows(a)).length === 2 && (await rows(b)).length === 2), JSON.stringify(await rows(a)));

  // -------- 2. mic: only on its own click; others see it; speaking indicator; off releases the device
  await tid(a, 'mic-toggle').click();
  ok('mic request happens only after the mic button click', (await waitFor(async () => (await gum(a)) === 1)), `calls=${await gum(a)}`);
  ok('"you are live" banner shows for the speaker', await waitFor(async () => /microphone is live/.test((await tid(a, 'live-banner').textContent().catch(() => '')) ?? '')));
  ok('the other player sees the mic is on', await waitFor(async () => (await otherRow(b))?.mic === true));
  ok('the other player sees the speaking indicator', await waitFor(async () => (await otherRow(b))?.speaking === true, 20000), JSON.stringify(await rows(b)));
  ok('the speaker sees their own speaking indicator', await waitFor(async () => (await rows(a)).find((r) => r.self)?.speaking === true, 20000));
  await a.screenshot({ path: `${SHOTS}/02-mic-live-A.png` });
  const liveBefore = await liveTracks(a);
  await tid(a, 'mic-toggle').click();
  ok('one click turns the mic off and the banner goes', await waitFor(async () => (await tid(a, 'live-banner').count()) === 0));
  ok('turning the mic off really releases the device', await waitFor(async () => (await liveTracks(a)) < liveBefore), `live before=${liveBefore} after=${await liveTracks(a)}`);
  ok('the other player sees the mic go off', await waitFor(async () => (await otherRow(b))?.mic === false));
  await tid(a, 'mic-toggle').click();
  ok('the mic can be turned on again', await waitFor(async () => (await rows(a)).find((r) => r.self)?.mic === true));
  await tid(a, 'mic-toggle').click();
  await waitFor(async () => (await rows(a)).find((r) => r.self)?.mic === false);

  // -------- 3. camera
  ok('camera button disabled until the camera consent box is ticked', await tid(a, 'cam-toggle').isDisabled());
  const gumBeforeCam = await gum(a);
  await a.getByRole('checkbox').nth(0).check();
  await sleep(500);
  ok('ticking the camera consent alone does not start the camera', (await gum(a)) === gumBeforeCam && (await a.evaluate(() => window.__gum.calls.every((c) => !c.video))));
  await tid(a, 'cam-toggle').click();
  ok('camera request happens only after the camera button click', await waitFor(async () => (await a.evaluate(() => window.__gum.calls.some((c) => c.video)))));
  ok('camera banner shows', await waitFor(async () => /camera is live/.test((await tid(a, 'live-banner').textContent().catch(() => '')) ?? '')));
  ok('own preview tile is shown', await waitFor(async () => (await a.locator('[data-testid=video-tile][data-self="1"]').count()) === 1));
  await b.getByRole('checkbox').first().isVisible();
  ok('the other player sees who has a camera on', await waitFor(async () => (await otherRow(b))?.cam === true));
  ok('the other player gets a video tile', await waitFor(async () => (await b.locator('[data-testid=video-tile][data-self="0"]').count()) === 1));
  const playing = await waitFor(() => b.evaluate(() => { const v = document.querySelector('[data-testid=video-tile][data-self="0"] video'); return !!v && v.videoWidth > 0 && v.readyState >= 2; }), 20000);
  ok('the remote video is actually decoding frames', playing);
  await sleep(800);
  await b.screenshot({ path: `${SHOTS}/03-camera-seen-by-B.png` });
  const liveCam = await liveTracks(a);
  await tid(a, 'cam-toggle').click();
  ok('one click turns the camera off, tile gone for both', await waitFor(async () => (await a.locator('[data-testid=video-tile]').count()) === 0 && (await b.locator('[data-testid=video-tile]').count()) === 0));
  ok('turning the camera off releases the camera', await waitFor(async () => (await liveTracks(a)) < liveCam), `before=${liveCam} after=${await liveTracks(a)}`);

  // -------- 4. proximity: walk away and the volume falls
  const posA = await a.evaluate(() => window.__cgDev.pos());
  const near = await otherRow(b);
  ok('proximity: full volume when standing close', near && near.volume > 0.99, `volume=${near?.volume}`);
  await a.evaluate(async () => {
    const d = window.__cgDev; const c = d.controls; const t0 = performance.now();
    const start = d.pos();
    while (performance.now() - t0 < 5000) { c.touch = { x: -1, y: 0 }; await new Promise((r) => setTimeout(r, 16)); const p = d.pos(); if (Math.hypot(p.x - start.x, p.y - start.y) > 300) break; }
    c.touch = { x: 0, y: 0 };
  });
  await sleep(1200);
  const posA2 = await a.evaluate(() => window.__cgDev.pos());
  const moved = Math.hypot(posA2.x - posA.x, posA2.y - posA.y);
  const far = await waitFor(async () => { const r = await otherRow(b); return r && r.volume < 1 ? r : false; }, 6000);
  const audioVol = await b.evaluate(() => [...document.querySelectorAll('audio')].map((e) => e.volume));
  ok('proximity: volume falls as the other player walks away', !!far, `moved=${Math.round(moved)}px volume=${far?.volume} audioEls=${JSON.stringify(audioVol)}`);
  await a.screenshot({ path: `${SHOTS}/04-proximity-A.png` });
  // bring A back close for the next steps
  await a.evaluate(async () => { const d = window.__cgDev; const c = d.controls; const t0 = performance.now(); const target = d.__home ?? null; void target; while (performance.now() - t0 < 5000) { c.touch = { x: 1, y: 0 }; await new Promise((r) => setTimeout(r, 16)); } c.touch = { x: 0, y: 0 }; });

  // -------- 5. blocked and muted players are not received
  await tid(a, 'mic-toggle').click();
  await tid(a, 'cam-toggle').click();
  await waitFor(async () => (await otherRow(b))?.cam === true);
  await sleep(1500);
  const heardBefore = await b.evaluate(() => document.querySelectorAll('audio').length);
  await b.evaluate((u) => window.__cgDev.session.mute(u, false), uidB).catch(() => {});
  const uidA = await a.evaluate(() => window.__cgDev.session.me.uid);
  await b.evaluate((u) => window.__cgDev.session.mute(u, true), uidA);
  ok('muting a player removes their audio, video and row', await waitFor(async () => !(await otherRow(b)) && (await b.locator('[data-testid=video-tile][data-self="0"]').count()) === 0 && (await b.evaluate(() => document.querySelectorAll('audio').length)) === 0), `audio elements before=${heardBefore}`);
  await b.evaluate((u) => window.__cgDev.session.mute(u, false), uidA);
  ok('un-muting brings them back', await waitFor(async () => (await otherRow(b))?.cam === true, 20000));
  await b.evaluate((u) => window.__cgDev.session.block(u), uidA);
  ok('blocking a player removes their audio and video too', await waitFor(async () => !(await otherRow(b)) && (await b.locator('[data-testid=video-tile][data-self="0"]').count()) === 0 && (await b.evaluate(() => document.querySelectorAll('audio').length)) === 0));
  ok('the blocked player no longer receives the blocker either', await waitFor(async () => !(await otherRow(a)) && (await a.locator('[data-testid=video-tile][data-self="0"]').count()) === 0), JSON.stringify(await rows(a)));
  await b.screenshot({ path: `${SHOTS}/05-blocked-B.png` });
  await b.evaluate((u) => window.__cgDev.session.unblock(u), uidA);
  ok('unblocking restores audio and video', await waitFor(async () => (await otherRow(b))?.cam === true, 25000));

  // -------- 6. closing the panel and leaving stop everything
  ok('A has live capture before closing the panel', (await liveTracks(a)) >= 2, `live=${await liveTracks(a)}`);
  await closeVoice(a);
  ok('closing the panel stops every microphone and camera track', await waitFor(async () => (await liveTracks(a)) === 0), `live=${await liveTracks(a)}`);
  ok('closing the panel removes A from the voice room for B', await waitFor(async () => !(await otherRow(b))));
  await openVoice(a);
  ok('reopening the panel does not silently go live again', (await tid(a, 'live-banner').count()) === 0 && (await tid(a, 'voice-panel').getAttribute('data-phase')) === 'off');
  await joinVoice(a);
  await tid(a, 'mic-toggle').click();
  await waitFor(async () => (await liveTracks(a)) >= 1);
  await tid(a, 'leave-voice').click();
  ok('"Leave voice" stops all tracks and clears the banner', await waitFor(async () => (await liveTracks(a)) === 0 && (await tid(a, 'live-banner').count()) === 0));
  await joinVoice(a);
  await tid(a, 'mic-toggle').click();
  await waitFor(async () => (await liveTracks(a)) >= 1);
  await a.goto('about:blank');
  ok('closing the tab removes A from voice for B', await waitFor(async () => !(await otherRow(b)), 30000));

  // -------- 7. failure states
  const C = await guest(br, 'Cedar');
  const c = C.page;
  await openVoice(c);
  await c.evaluate(() => { window.__cgDev.session.voiceToken = async () => null; });
  await c.getByRole('checkbox').first().check();
  await c.getByRole('button', { name: /Join voice/ }).click();
  ok('token failure shows a clear message and no stuck spinner', await waitFor(async () => /Could not ask for a voice seat/.test(await tid(c, 'voice-error').textContent().catch(() => ''))) && (await tid(c, 'voice-panel').getAttribute('data-phase')) === 'off');
  await c.evaluate(() => { window.__cgDev.session.voiceToken = async () => ({ ok: true, enabled: true, url: 'ws://127.0.0.1:7880', token: 'not-a-real-token', room: 'x', proximity: false }); });
  await c.getByRole('button', { name: /Join voice/ }).click();
  ok('a refused token gives a calm message', await waitFor(async () => /voice/i.test(await tid(c, 'voice-error').textContent().catch(() => '')), 20000), await tid(c, 'voice-error').textContent().catch(() => ''));
  await c.screenshot({ path: `${SHOTS}/07-token-failure.png` });
  await C.ctx.close();

  await b.close(); await A.ctx.close(); await B.ctx.close();

  // denied permission: real prompt path, nobody to click Allow, so the browser refuses
  const brDenied = await launch(['--use-fake-device-for-media-stream', MDNS_OFF]);
  const D = await guest(brDenied, 'Dove');
  await openVoice(D.page); await joinVoice(D.page);
  await tid(D.page, 'mic-toggle').click();
  ok('denied microphone permission shows a clear message and stays off', await waitFor(async () => /blocked|allow/i.test(await tid(D.page, 'voice-error').textContent().catch(() => ''))) && (await tid(D.page, 'live-banner').count()) === 0, await tid(D.page, 'voice-error').textContent().catch(() => ''));
  await D.page.screenshot({ path: `${SHOTS}/06-mic-denied.png` });
  await brDenied.close();

  // no device at all
  const brNone = await launch(['--use-fake-ui-for-media-stream', MDNS_OFF]);
  const E = await guest(brNone, 'Elm');
  await openVoice(E.page); await joinVoice(E.page);
  await tid(E.page, 'mic-toggle').click();
  const msg = await waitFor(async () => (await tid(E.page, 'voice-error').textContent().catch(() => '')) || false);
  ok('no microphone present shows a clear message and stays off', !!msg && (await tid(E.page, 'live-banner').count()) === 0, String(msg));
  await brNone.close();
} catch (e) {
  failed++;
  console.log('SCRIPT ERROR', e.message);
} finally {
  await br.close().catch(() => {});
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
