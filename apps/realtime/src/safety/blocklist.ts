/**
 * A deliberately small starter list: slurs, self-harm bait and threats.
 * It is a safety net, not a moderation system. Communities extend it with EXTRA_BLOCKED_TERMS.
 * Matching is done on normalised text (see normalizeForFilter in @channel-green/shared).
 */
export const STARTER_BLOCKLIST: readonly string[] = [
  'kys',
  'kill yourself',
  'kill urself',
  'go die',
  'nazi',
  'heil hitler',
  'faggot',
  'nigger',
  'nigga',
  'tranny',
  'retard',
  'chink',
  'kike',
  'spic',
  'rape you',
  'i will rape',
  'dox you',
  'doxx',
  'swat you',
  'send nudes',
  'cp link',
];
