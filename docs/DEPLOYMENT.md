# Deployment

Status: deployment-ready on paper, not deployed. Nothing here has been run against real hosting accounts. Do not deploy until you have seen a preview and agreed.

Two services plus two optional ones:

1. Web app on Vercel
2. Realtime server on a host that stays running
3. Supabase (optional): accounts and saved data
4. LiveKit (optional): voice and video

## 1. Realtime server

It needs a persistent Node host with WebSocket support (Fly.io, Render, Railway, a VPS). Not Vercel.

Build and run the container from the repository root:

    docker build -f apps/realtime/Dockerfile -t channel-green-realtime .
    docker run -p 4001:4001 --env-file apps/realtime/.env channel-green-realtime

(The Dockerfile has not been built in our environment yet; expect a small fix on the first try.) Without Docker: `npm ci && npm run build -w @channel-green/realtime && node apps/realtime/dist/index.js`.

Set the variables from [ENV.md](ENV.md). Run a single instance for now: room state lives in that process memory. Check `GET /health` returns `ok`. Give it a public https address such as `realtime.zerotheoryapp.tech`.

## 2. Supabase (optional)

1. Create a project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor.
3. Put the URL and service-role key on the realtime host, and the URL and anon key on Vercel.
4. Enable the sign-in methods you want.

## 3. LiveKit (optional)

Create a LiveKit Cloud project (or self-host). Copy the URL, API key and secret to the realtime host only.

## 4. Web app on Vercel

1. Import the GitHub repository.
2. Root directory `apps/web`. Install command `cd ../.. && npm ci`. Build command `cd ../.. && npm run content:build && npm run build -w @channel-green/web`. Check these on the first build.
3. Add the web variables from ENV.md.
4. Add `https://<your vercel address>` and the final domain to `ALLOWED_ORIGINS` on the realtime host.

## 5. DNS for zerotheoryapp.tech

Decide the layout, for example the site on `zerotheoryapp.tech` or a subdomain, the realtime server on `realtime.zerotheoryapp.tech`. Vercel and the realtime host each show the exact records to add (usually an A or CNAME). Wait for https to turn on, then update `ALLOWED_ORIGINS`, `NEXT_PUBLIC_SITE_URL` and `NEXT_PUBLIC_REALTIME_URL`.

## What the owner must create or approve

- A Vercel account and project linked to the repository
- A host for the realtime server
- Optional: a Supabase project, a LiveKit project
- DNS access for zerotheoryapp.tech
- A long random SERVER_SECRET (generate it yourself and keep it private)
- Approval of the preview before anything goes live
