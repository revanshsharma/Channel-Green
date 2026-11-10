'use client';
import { useState } from 'react';
import { Gate } from '../Gate';
import { useGame } from '@/game/useSession';

export function AvatarPanel() {
  const game = useGame();
  const [saved, setSaved] = useState(false);
  return (
    <div>
      {saved && <p className="mb-2 text-neon" role="status">Saved. Stepping back in.</p>}
      <Gate
        compact
        initial={game.profile}
        title="Your look"
        cta="Save"
        onDone={(p) => {
          setSaved(true);
          void game.changeAvatar(p);
          game.closePanel();
        }}
      />
    </div>
  );
}
