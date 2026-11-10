# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private vulnerability reporting on this repository (Security tab, "Report a vulnerability"). Tell us what you found, how to reproduce it, and what you think the impact is. We will acknowledge within a few days and keep you updated.

## Scope

- The realtime server (tokens, rooms, rate limits, moderation)
- The web app (including the status endpoint)
- The Supabase schema and Dockerfile

## Things to know

- The Supabase service-role key, LiveKit secret and server secret belong only on the realtime server. They must never be in the browser, in git, or in logs.
- Only `NEXT_PUBLIC_*` values are shipped to browsers; none of them are secret.
- The realtime server refuses to start in production without a server secret.
- This is an early MVP and has not had an external security audit.

Please give us reasonable time to fix an issue before you share it publicly.
