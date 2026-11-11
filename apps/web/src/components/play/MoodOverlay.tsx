'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { moodFor } from '@/game/mood';
import { useSnap } from '@/game/useSession';

/** One quiet line, shown a little after you settle in. Lowercase, small, and gone again on its own. */
const QUIET_LINES = ['stay a while.', 'somewhere to belong.', 'such is life.'];

/** Screen-space finish over the world: sunset wash, soft vignette and a little film grain. Never blocks clicks. */
export function MoodOverlay() {
  const { mapId, seated } = useSnap();
  const [line, setLine] = useState<string | null>(null);
  const turn = useRef(0);
  useEffect(() => {
    if (!seated) {
      setLine(null);
      return;
    }
    const text = QUIET_LINES[turn.current++ % QUIET_LINES.length]!;
    const on = setTimeout(() => setLine(text), 3200);
    const off = setTimeout(() => setLine(null), 10500);
    return () => {
      clearTimeout(on);
      clearTimeout(off);
    };
  }, [seated]);
  if (!mapId) return null;
  const m = moodFor(mapId).screen;
  const style = {
    '--mood-top': m.top,
    '--mood-bottom': m.bottom,
    '--mood-vignette': String(m.vignette),
    '--mood-grain': String(m.grain),
  } as CSSProperties;
  return (
    <div key={mapId} className="mood" data-seated={seated ? 'true' : 'false'} style={style} aria-hidden="true">
      <div className="mood-wash" />
      <div className="mood-vignette" />
      <div className="mood-glow" />
      <div className="mood-grain" />
      <div className="mood-line" data-on={line ? 'true' : 'false'}>
        {line ?? ''}
      </div>
    </div>
  );
}
