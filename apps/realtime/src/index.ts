import { loadConfig } from './config';
import { createRealtime } from './server';

const cfg = loadConfig();
const rt = createRealtime(cfg);

rt.listen().then((port) => {
  const bits = [
    `store=${rt.store.kind}`,
    `voice=${cfg.livekit ? 'livekit' : 'off'}`,
    `accounts=${cfg.supabase ? 'supabase' : 'guests-only'}`,
    `origins=${cfg.allowedOrigins.join(',')}`,
  ];
  console.log(`[channel-green] realtime listening on :${port} (${bits.join(' ')})`);
  if (cfg.secretGenerated) console.warn('[channel-green] SERVER_SECRET not set: using a temporary one. Guest sessions will not survive a restart.');
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    rt.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
