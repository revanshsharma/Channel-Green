# Environment variables

Nothing is required for local play. Copy the `.env.example` file in each app to `.env` (realtime) or `.env.local` (web). Never commit them. Values below are placeholders.

## Web app (`apps/web`)

All `NEXT_PUBLIC_*` values are visible in the browser. Nothing here is secret.

- `NEXT_PUBLIC_REALTIME_URL`: public address of the realtime server, for example `https://realtime.example.com`. Empty means `http://localhost:4001`.
- `NEXT_PUBLIC_SITE_URL`: the public address of the site.
- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`: optional, for sign-in. The anon key is public by design. The service-role key never goes in the web app.

## Realtime server (`apps/realtime`)

- `PORT`: listening port (hosts usually set it for you). Default 4001.
- `NODE_ENV`: set `production` when deployed. In production `SERVER_SECRET` is required.
- `SERVER_SECRET`: 32+ random characters; signs guest tokens and derives anonymous ids. Changing it logs out all guests.
- `ALLOWED_ORIGINS`: comma-separated list of site addresses allowed to connect, for example `https://zerotheoryapp.tech`.
- `TRUST_PROXY`: `true` when behind a proxy that sets the forwarded-for header (most hosts).
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: turn on the database store. Both needed. Server only.
- `SUPABASE_JWT_SECRET`: only for older Supabase projects with the legacy signing secret.
- `MODERATOR_USER_IDS`: comma-separated Supabase user ids that act as guides.
- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: turn on voice and video. All three needed. Setup and a manual test: docs/VOICE.md.
- `EXTRA_BLOCKED_TERMS`: extra filtered words.
- `MAX_CONNECTIONS_PER_IP`: default 8.
- `CONFESSION_TTL_DAYS`: how long confessions stay, default 7.

## Example (placeholders only)

    # realtime host
    NODE_ENV=production
    SERVER_SECRET=<long random string>
    ALLOWED_ORIGINS=https://zerotheoryapp.tech
    TRUST_PROXY=true
    SUPABASE_URL=https://<project>.supabase.co
    SUPABASE_SERVICE_ROLE_KEY=<service role key>
    LIVEKIT_URL=wss://<project>.livekit.cloud
    LIVEKIT_API_KEY=<key>
    LIVEKIT_API_SECRET=<secret>

    # Vercel (web)
    NEXT_PUBLIC_REALTIME_URL=https://<realtime host address>
    NEXT_PUBLIC_SITE_URL=https://zerotheoryapp.tech
    NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
    NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
