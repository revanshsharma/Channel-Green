'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { BRAND } from '@channel-green/shared';
import { audio } from '@/game/audio';
import { registry } from '@/lib/registry';
import { HeroScene } from './HeroScene';
import { MapThumb } from './MapThumb';

const ROOM_ORDER = ['town-square', 'cafe', 'living-room', 'tv-lounge', 'garden', 'rooftop', 'listening-room', 'confession-wall', 'rain-room', 'quiet-nook'];

function useSound() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const a = audio();
    return a.onChange(() => setOn(a.enabled));
  }, []);
  return {
    on,
    toggle: () => {
      const a = audio();
      a.toggle();
      if (a.enabled) a.setSoundscape(registry.soundscapes['town-dusk'] ?? null);
      else a.setSoundscape(null);
    },
  };
}

function useStatus() {
  const [s, setS] = useState<{ online: boolean; players: number } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/status')
      .then((r) => r.json())
      .then((j) => alive && setS(j))
      .catch(() => alive && setS({ online: false, players: 0 }));
    return () => {
      alive = false;
    };
  }, []);
  return s;
}

export function Landing() {
  const router = useRouter();
  const sound = useSound();
  const status = useStatus();
  const [entering, setEntering] = useState(false);

  useEffect(
    () => () => {
      if (!window.location.pathname.startsWith('/play')) audio().setSoundscape(null);
    },
    [],
  );

  const enter = () => {
    if (entering) return;
    setEntering(true);
    setTimeout(() => router.push('/play'), 900);
  };

  return (
    <main>
      {entering && (
        <div className="fixed inset-0 z-50 bg-forest-deep grid place-items-center" role="status" aria-live="polite">
          <div className="text-center">
            <div className="mx-auto mb-4 h-3 w-48 bg-moss overflow-hidden">
              <div className="h-full bg-neon" style={{ animation: 'rise 0.9s linear both', width: '100%' }} />
            </div>
            <p className="font-pixel text-neon text-xl blink">tuning in to channel green...</p>
          </div>
        </div>
      )}

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-4 py-3 md:px-8">
        <span className="font-pixel text-lg text-neon">CHANNEL GREEN</span>
        <nav className="flex items-center gap-4 text-sm text-cream">
          <a href="#about" className="hover:text-neon">About</a>
          <a href="#rooms" className="hover:text-neon">Rooms</a>
          <a href="#contribute" className="hover:text-neon">Contribute</a>
          <a href="#guidelines" className="hover:text-neon">Guidelines</a>
          <button className="btn btn-sm btn-quiet" onClick={sound.toggle} aria-pressed={sound.on} title="Sound is off until you turn it on">
            Sound: {sound.on ? 'on' : 'off'}
          </button>
        </nav>
      </header>

      <section className="relative min-h-[88vh] overflow-hidden">
        <div className="absolute inset-0 opacity-90">
          <HeroScene className="h-full w-full object-cover" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-forest-deep via-forest-deep/50 to-forest-deep/20" />
        <div className="relative z-10 mx-auto flex min-h-[88vh] max-w-4xl flex-col items-center justify-end px-6 pb-16 text-center">
          <h1 className="font-pixel text-5xl md:text-7xl text-offwhite drop-shadow-[0_4px_0_#0b1f15]">
            CHANNEL <span className="text-neon">GREEN</span>
          </h1>
          <p className="mt-3 font-pixel text-xl md:text-2xl text-orange">{BRAND.tagline}</p>
          <p className="mt-4 max-w-xl text-cream">
            A small, cozy pixel world. Walk around, sit by a fire, watch something together, leave a note on the wall. No pressure, no feed, no score.
          </p>
          <button onClick={enter} className="btn btn-primary mt-8 px-8 py-4 text-2xl animate-[drift_3s_ease-in-out_infinite]">
            ENTER CHANNEL GREEN
          </button>
          <p className="mt-3 text-sm text-olive-soft" aria-live="polite">
            {status === null ? ' ' : status.online ? (status.players > 0 ? `${status.players} ${status.players === 1 ? 'person is' : 'people are'} wandering around right now` : 'The square is quiet right now. Be the first light on.') : 'The server is asleep right now, so you cannot walk in yet.'}
          </p>
          <p className="mt-1 text-xs text-olive-soft">No account needed. Sound stays off until you say so.</p>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-pixel text-3xl text-neon">Somewhere to belong</h2>
        <div className="prose-cg mt-4 text-lg">
          <p>
            Channel Green is a place for the evenings when you want company but not a crowd. You pick a look, you get a name, and you wander into a little town at dusk. There are a cafe, a living room with a fire, a rooftop, a garden, a room where it is always raining and a quiet corner where nobody has to talk.
          </p>
          <p>
            Nothing here is trying to hold your attention. There are no likes, no streaks and no ads. If someone is kind to you, they can wave. If you want to be left alone, you can go to the quiet nook and just be there.
          </p>
        </div>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {[
            ['Walk and meet', 'Move around, see other people as they are, sit down next to them, wave, hug if they say yes.'],
            ['Talk your way', 'Say it out loud with chat, whisper in private, or keep it to a small note in the quiet room.'],
            ['Watch and listen together', 'Share a video or a little tune in sync with everyone in the room.'],
            ['Say it on the wall', 'The confession wall is anonymous. Others can send a heart, and kind moderators keep it gentle.'],
          ].map(([t, d]) => (
            <li key={t} className="panel p-4">
              <h3 className="font-pixel text-xl text-orange">{t}</h3>
              <p className="mt-1 text-cream">{d}</p>
            </li>
          ))}
        </ul>
      </section>

      <section id="rooms" className="bg-forest py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="font-pixel text-3xl text-neon">Ten rooms to start with</h2>
          <p className="mt-2 max-w-2xl text-cream">Every room here is drawn from small data files, so anyone can add one. These pictures are the real rooms, not mock-ups.</p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {ROOM_ORDER.map((id) => {
              const m = registry.maps[id];
              if (!m) return null;
              return (
                <article key={id} className="panel overflow-hidden">
                  <div className="bg-forest-deep">
                    <MapThumb id={id} />
                  </div>
                  <div className="p-3">
                    <h3 className="font-pixel text-lg text-offwhite">{m.name}</h3>
                    <p className="text-sm text-cream">{m.blurb}</p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="contribute" className="mx-auto max-w-4xl px-6 py-20">
        <h2 className="font-pixel text-3xl text-neon">Build it with us</h2>
        <div className="prose-cg mt-4">
          <p>
            Channel Green is open source (MIT). The world is made of plain data: rooms, furniture, outfits, little songs and sounds all live in content packs that you can read in a text editor. You do not need to know how to code to add a bench, a hat or a lullaby.
          </p>
          <ul>
            <li>Draw a new room, a plant, a lamp or an outfit.</li>
            <li>Write a short tune for the listening room.</li>
            <li>Fix a bug, make it work better on a phone, improve how it reads with a screen reader.</li>
            <li>Help with kindness: read the community guidelines and tell us what is missing.</li>
          </ul>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="btn btn-warm" href={BRAND.repoUrl} target="_blank" rel="noreferrer">See the code on GitHub</a>
          <a className="btn" href={`${BRAND.repoUrl}/blob/main/CONTRIBUTING.md`} target="_blank" rel="noreferrer">How to contribute</a>
        </div>
      </section>

      <section id="guidelines" className="bg-forest py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="font-pixel text-3xl text-neon">House rules, short version</h2>
          <ul className="prose-cg mt-4">
            <li>Be kind. Disagree without being cruel.</li>
            <li>No harassment, hate, sexual content or sharing other people&apos;s private information.</li>
            <li>Ask before you hug. Take a no as a full answer.</li>
            <li>You can mute, block or report anyone, at any time, from the people panel.</li>
            <li>Voice and camera are always opt-in. Nothing starts without you pressing a button.</li>
          </ul>
          <Link href="/guidelines" className="btn mt-4 inline-block">Read the full guidelines</Link>
        </div>
      </section>

      <footer className="border-t-2 border-moss px-6 py-10 text-center text-sm text-olive-soft">
        <p className="font-pixel text-lg text-offwhite">CHANNEL GREEN</p>
        <p className="mt-1">
          A{' '}
          <a href={BRAND.parentUrl} target="_blank" rel="noreferrer" className="text-orange underline underline-offset-4">
            {BRAND.parent}
          </a>{' '}
          project. Open source, MIT licensed.
        </p>
        <p className="mt-2 space-x-4">
          <a href={BRAND.repoUrl} target="_blank" rel="noreferrer" className="hover:text-neon">GitHub</a>
          <Link href="/guidelines" className="hover:text-neon">Guidelines</Link>
          <Link href="/credits" className="hover:text-neon">Credits</Link>
        </p>
      </footer>
    </main>
  );
}
