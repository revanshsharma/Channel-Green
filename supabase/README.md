# Supabase

`migrations/0001_init.sql` creates every table the realtime server uses. Row level security is on and there are no public policies, so only the realtime server (service-role key) can touch the data.

Apply it with the SQL editor in your Supabase dashboard (paste the file and run it), or with the Supabase CLI: `supabase link` then `supabase db push`.

Supabase is optional. Without it the world runs with guests and in-memory storage.
