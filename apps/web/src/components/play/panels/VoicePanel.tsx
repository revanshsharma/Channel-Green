'use client';
import { useEffect, useRef, useState } from 'react';
import type { Room as LKRoom } from 'livekit-client';
import { useGame, useSnap } from '@/game/useSession';

type Phase = 'off' | 'joining' | 'on';

export function VoicePanel() {
  const game = useGame();
  const s = useSnap();
  const [consent, setConsent] = useState(false);
  const [camConsent, setCamConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>('off');
  const [err, setErr] = useState('');
  const [micOn, setMicOn] = useState(false);
  const [camOn, setCamOn] = useState(false);
  const [heard, setHeard] = useState<string[]>([]);
  const room = useRef<LKRoom | null>(null);
  const audioHost = useRef<HTMLDivElement>(null);
  const videoHost = useRef<HTMLDivElement>(null);
  const prox = useRef(false);

  const leave = () => {
    room.current?.disconnect();
    room.current = null;
    if (audioHost.current) audioHost.current.innerHTML = '';
    if (videoHost.current) videoHost.current.innerHTML = '';
    setPhase('off');
    setMicOn(false);
    setCamOn(false);
    setHeard([]);
    game.setVoiceStop(null);
  };

  useEffect(() => () => {
    // closing the panel does not hang up; leaving the world does (session.dispose calls the stop fn)
  }, []);

  // proximity: scale each remote voice by distance
  useEffect(() => {
    if (phase !== 'on') return;
    const t = setInterval(() => {
      const r = room.current;
      if (!r || !prox.current || !game.me) return;
      r.remoteParticipants.forEach((p) => {
        const o = game.players.get(p.identity);
        if (!o) return;
        const d = Math.hypot(o.x - game.me!.x, o.y - game.me!.y);
        const v = d < 48 ? 1 : d > 240 ? 0 : 1 - (d - 48) / 192;
        p.setVolume(Math.max(0, Math.min(1, v)));
      });
    }, 400);
    return () => clearInterval(t);
  }, [phase, game]);

  const join = async () => {
    setErr('');
    setPhase('joining');
    const t = await game.voiceToken();
    if (!t) {
      setPhase('off');
      setErr('Could not ask for a voice seat just now.');
      return;
    }
    if (!t.enabled) {
      setPhase('off');
      setErr(t.reason);
      return;
    }
    prox.current = t.proximity;
    try {
      const lk = await import('livekit-client');
      const r = new lk.Room({ adaptiveStream: true, dynacast: true });
      r.on(lk.RoomEvent.TrackSubscribed, (track, _pub, participant) => {
        const el = track.attach();
        if (track.kind === lk.Track.Kind.Audio) audioHost.current?.appendChild(el);
        else {
          el.className = 'w-full rounded border-2 border-moss bg-black';
          const wrap = document.createElement('div');
          wrap.dataset.pid = participant.identity;
          wrap.appendChild(el);
          videoHost.current?.appendChild(wrap);
        }
      });
      r.on(lk.RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((e) => e.parentElement?.dataset.pid ? e.parentElement.remove() : e.remove()));
      r.on(lk.RoomEvent.ActiveSpeakersChanged, (sp) => setHeard(sp.map((x) => game.players.get(x.identity)?.name ?? '').filter(Boolean)));
      r.on(lk.RoomEvent.Disconnected, () => leave());
      await r.connect(t.url, t.token);
      room.current = r;
      game.setVoiceStop(leave);
      setPhase('on');
      try {
        await r.localParticipant.setMicrophoneEnabled(true);
        setMicOn(true);
      } catch {
        setErr('The microphone was not allowed. You can still listen.');
      }
    } catch {
      setPhase('off');
      setErr('Could not connect to voice right now.');
    }
  };

  const toggleMic = async () => {
    const r = room.current;
    if (!r) return;
    try {
      await r.localParticipant.setMicrophoneEnabled(!micOn);
      setMicOn(!micOn);
    } catch {
      setErr('The microphone was not allowed.');
    }
  };
  const toggleCam = async () => {
    const r = room.current;
    if (!r) return;
    if (!camOn && !camConsent) return;
    try {
      await r.localParticipant.setCameraEnabled(!camOn);
      setCamOn(!camOn);
    } catch {
      setErr('The camera was not allowed.');
    }
  };

  if (!s.features.voice) {
    return (
      <div className="space-y-2 text-sm">
        <p className="rounded border-2 border-moss p-3">{s.features.voiceReason || 'Voice and video are switched off here.'}</p>
        <p className="text-olive-soft">Text chat, emotes and everything else still work. Voice and video use LiveKit, and only start when you choose to join.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 text-sm">
      {phase !== 'on' ? (
        <>
          <p>Talk with the people in this room. Nothing is sent from your microphone or camera until you press Join, and your browser will ask too.</p>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1" />
            <span>I understand others in this room will hear my voice, and I agree to the community guidelines.</span>
          </label>
          <button className="btn btn-primary" disabled={!consent || phase === 'joining'} onClick={() => void join()}>
            {phase === 'joining' ? 'Joining...' : 'Join voice'}
          </button>
        </>
      ) : (
        <>
          <p className="text-neon">You are in voice.{heard.length ? ` Speaking: ${heard.join(', ')}` : ''}</p>
          <div className="flex flex-wrap gap-1">
            <button className="btn btn-sm" aria-pressed={micOn} onClick={() => void toggleMic()}>{micOn ? 'Mute mic' : 'Unmute mic'}</button>
            <button className="btn btn-sm" aria-pressed={camOn} disabled={!camConsent && !camOn} onClick={() => void toggleCam()}>{camOn ? 'Camera off' : 'Camera on'}</button>
            <button className="btn btn-sm btn-warm" onClick={leave}>Leave voice</button>
          </div>
          <label className="flex items-start gap-2">
            <input type="checkbox" checked={camConsent} onChange={(e) => { setCamConsent(e.target.checked); if (!e.target.checked && camOn) void toggleCam(); }} className="mt-1" />
            <span>I am happy for people in this room to see my camera when I switch it on.</span>
          </label>
        </>
      )}
      {err && <p role="alert" className="text-orange">{err}</p>}
      <div ref={videoHost} className="space-y-2" />
      <div ref={audioHost} className="hidden" />
    </div>
  );
}
