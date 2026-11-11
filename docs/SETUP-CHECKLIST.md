# Setup checklist (for the owner, step by step)

Written for Revansh, who will click through the setup himself. Last updated 2026-11-11.

## Read this first

- Nothing in this list has been run by us yet. We have not tried Azure, Supabase, LiveKit Cloud or Vercel. Every step is written from the repository and from how those services normally work, so a screen may look a little different, or a step may need a small fix. If something does not match, stop and tell us what you see (a screenshot is fine, with any keys or codes hidden).
- Never send us your Azure login, passwords, API keys, secrets or tokens. Not in chat, not in screenshots. You paste them yourself into the service's own settings page. We only ever need addresses (URLs) and yes/no confirmations.
- Prices are approximate and change. Check the Azure pricing page and the pricing calculator before you create anything.
- Nothing here touches DNS or goes live under your own domain. Section 6 lists the records you would add later, and you add them yourself.
- Keep a private note (a password manager, not a shared document) for the values you create along the way.

Words used below: the **web app** is the website people open (goes on Vercel). The **realtime server** is the always-on program that moves people around the world and carries chat (goes on Azure). **Supabase** stores accounts and saved data (optional). **LiveKit** carries voice and video (optional).

## Recommended order, in one glance

1. Azure: cost alert, resource group, realtime server. Test it alone. (Section 1)
2. LiveKit Cloud: create project, add its three values to the realtime server. (Section 3)
3. Vercel: preview deploy of the web app. (Section 4)
4. Tell the realtime server the Vercel address. Play together. (Section 4, last steps)
5. Supabase, only if you want sign-in and saved data. (Section 2) It is fine to skip this at first: the world works with guests.
6. Your own domain, last. (Section 6)

Why this order: the web app needs the realtime server's address, and the realtime server needs the web app's address, so one of them has to come first and then be updated. Starting with the realtime server lets you test it on its own with a single address in your browser.

---

## 1. Azure: the realtime server

### 1.1 Set a cost alert before anything else

1. Sign in at https://portal.azure.com with your student account.
2. Search for **Cost Management + Billing**, then **Cost Management**, then **Budgets**, then **Add**.
3. Scope: your student subscription. Name: `student-guard`. Reset period: **Monthly**. Amount: **20** (US dollars). Click Next.
4. Alert conditions: add one at **50%** of budget and one at **90%**, type **Actual**. Put your own email in the recipients. Create.

Expected result: the budget shows in the list, and you get a confirmation email later when thresholds are crossed. Note: budget alerts only warn you, they do not stop spending. The real brake is deleting or stopping things (section 5).

Also open **Subscriptions**, click your student subscription and note the credit balance and the end date, so you know your starting point.

### 1.2 Create a resource group

A resource group is a folder that holds everything for this project. Deleting the folder deletes everything inside it, which makes cleanup easy.

1. Search for **Resource groups**, then **Create**.
2. Subscription: your student one. Name: `channel-green-rg`.
3. Region: **Central India**. If it is not offered (student subscriptions sometimes allow only a few regions), pick the nearest one it does offer, for example **South India** or **Southeast Asia (Singapore)**. Review + create, then Create.

Expected result: `channel-green-rg` appears under Resource groups.

### 1.3 Which Azure option: the short comparison

| | Azure Container Apps (recommended) | Small Linux VM (B1s / B2s) |
|---|---|---|
| WebSockets | Supported by default on its web address | Supported, you set it up yourself |
| HTTPS | Automatic, free certificate on the address Azure gives you | You install and renew a certificate yourself (for example with Caddy) |
| Always on | Yes, if you set minimum replicas to 1 | Yes |
| Sticky sessions | Not an issue while we run exactly one copy (see below) | Not an issue, there is one machine |
| Upkeep | Azure patches the platform | You patch the operating system, open ports, manage SSH keys |
| Approx. cost, always on | about 4 to 8 US dollars a month at the small size below | B1s about 8 dollars a month for the machine, plus roughly 3 to 4 for a fixed public address and a few for the disk, so about 12 to 16 |
| Fit for 100 dollars over 12 months | Yes, with room to spare | Tight, about 150 to 190 dollars over 12 months in the worst case |

These are rough figures from our understanding of Azure's usual prices. They change, and student subscriptions can have size or region limits. Check https://azure.microsoft.com/pricing/calculator/ and the Container Apps and Virtual Machines pricing pages for your region before you create anything.

**Recommendation: Azure Container Apps**, one copy, always on. Reasons:

- It gives a ready HTTPS address, so the browser can connect with `https://` and secure WebSockets with no certificate work. This matters because the website is https and a browser will refuse to connect it to an insecure server.
- It runs our existing container image as it is. No machine to look after.
- It is the cheaper of the two for an always-on server this small.
- Sticky sessions (the same visitor always reaching the same copy) only matter when there are several copies. Our realtime server keeps room state in its own memory, so it must run as **exactly one copy** anyway. Setting minimum and maximum copies both to 1 removes the problem. The downside is the same as any single server: if it restarts, people are dropped for a few seconds and rooms reset.
- If Container Apps turns out not to be available on your student subscription (the portal will show an error when you create the environment), the VM is the fallback. Tell us and we will write the VM steps.

### 1.4 Get the container image somewhere Azure can pull it from

The repository has a Dockerfile (`apps/realtime/Dockerfile`) that builds the realtime server. It has not been built by us yet, so the first build may need a small fix on our side.

Cheapest route, no paid registry: publish the image to GitHub's free container registry (`ghcr.io`), as a public image. The code is open source (MIT), so a public image is fine. Do not bake any secrets into the image; the secrets are added as settings in step 1.5.

- Option A (recommended): ask us to add a small GitHub Actions workflow to the repository that builds the image and publishes it to `ghcr.io/revanshsharma/channel-green-realtime`. After it runs once, on GitHub open your profile, Packages, the package, Package settings, and set visibility to **Public**. Expected result: the package page shows a `latest` tag. (We have not added this workflow yet and have not run it.)
- Option B: build on your own computer with Docker Desktop from the repository root: `docker build -f apps/realtime/Dockerfile -t channel-green-realtime .` and push to a registry. This needs a registry login on your side (a GitHub token or an Azure Container Registry), which is more fiddly. Option A is simpler.
- Azure Container Registry (ACR) also works, but its Basic tier costs about 5 dollars a month, which is a big share of the budget. Only use it if the GitHub route does not work.

### 1.5 Create the Container App

1. Search for **Container Apps**, then **Create**.
2. Basics: resource group `channel-green-rg`. Name `channel-green-realtime`. Region the same as the resource group. Container Apps environment: **Create new**, name `channel-green-env`, plan **Consumption** only (leave the dedicated plans off). If a message asks to register a provider (Microsoft.App), accept it.
3. Container tab: untick **Use quickstart image**. Image source **Docker Hub or other registries**, registry type **Public**, registry login server `ghcr.io`, image and tag `revanshsharma/channel-green-realtime:latest`. CPU and memory: **0.25 CPU, 0.5 Gi** to start (go to 0.5 CPU, 1 Gi if it feels slow or restarts).
4. Environment variables (still on the Container tab). Use these exact names. Placeholders only here; type your real values in the portal:

   | Name | Value | Notes |
   |---|---|---|
   | `NODE_ENV` | `production` | |
   | `SERVER_SECRET` | choose **Reference a secret**, create secret with a long random value | 32+ characters, keep a private copy. Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` on any computer with Node, or a password manager's generator. Changing it logs out every guest. |
   | `ALLOWED_ORIGINS` | `http://localhost:3000` for now | You replace this in step 4.6 with the real site addresses. No spaces, comma between addresses, no trailing slash, no `*`. |
   | `TRUST_PROXY` | `true` | The Azure front door sets the forwarded-for header. |

   Leave `PORT` out: the server defaults to 4001, which is what the image listens on. Voice and Supabase values are added later in sections 2 and 3.
5. Ingress tab: tick **Enabled**. Ingress traffic **Accepting traffic from anywhere**. Ingress type **HTTP**. Target port **4001**. Insecure connections: **off**.
6. Create. When it finishes (a few minutes), open the app, then Scale (under Application): set **Min replicas = 1** and **Max replicas = 1**, save. This keeps it always on and a single copy. (If the create screen offers the scale setting, set it there.)

Expected result: the app overview shows a status of Running and an **Application URL** like `https://channel-green-realtime.<random-words>.centralindia.azurecontainerapps.io`. Write this down. This is your realtime address.

### 1.6 Health check

1. Open `<Application URL>/health` in your browser.
2. Expected result: a short line of data that contains `"ok":true` (it also shows uptime, store type and whether voice is on). Right now `store` says `memory` and `voice` is `false`, which is correct before sections 2 and 3.
3. The image also has its own built-in health check, so Azure can see if the process stops answering.
4. If the page does not load: open the app, **Monitoring**, **Log stream** and look for errors. Common causes: wrong image name, image still private, target port not 4001, `NODE_ENV` set to production without `SERVER_SECRET`. Send us the log lines (hide any secret).

### 1.7 Notes on ports, HTTPS and WebSockets

- The only port to open is the web port 4001, and the ingress step does that. You do not open any other ports. Container Apps handles https on 443 for you.
- Browser connections to the realtime server use `https://` and the Socket.IO WebSocket upgrade runs over the same address. Always use the `https://` address in `NEXT_PUBLIC_REALTIME_URL`, never `http://`.
- Idle connections are kept alive by Socket.IO's own pings. We have not tested a long session through Azure's front door. The smoke test in section 5 includes staying connected for 15 minutes.
- Do not set more than one copy. Room state lives in memory, so two copies would split people into separate worlds.

---

## 2. Supabase (optional, can wait)

Skip this on the first run. Without Supabase everyone plays as a guest and data lives in memory (and is lost when the server restarts). Add it when you want sign-in and saved avatars, blocks, reports and confessions. We have not applied the database file to a real project yet, and the sign-in screens have not been tried against a real Supabase project.

1. Go to https://supabase.com, sign in, **New project**. Organization: your personal one. Name `channel-green`. Database password: let it generate one and save it in your private note (the realtime server does not use it). Region: the nearest to India that is offered (for example **Mumbai** or **Singapore**). Plan: **Free**. Create.
   Expected result: after a minute or two the project dashboard opens.
2. Open **SQL Editor**, **New query**. Paste the whole contents of `supabase/migrations/0001_init.sql` from the repository (it is the only migration so far). Click **Run**.
   Expected result: "Success. No rows returned". Open **Table Editor**: seven tables appear: `profiles`, `bans`, `blocks`, `reports`, `confessions`, `confession_hearts`, `confession_reports`. Row level security is on and there are no public rules, on purpose: the browser can read nothing from them.
3. Open **Project Settings**, **API** (or **API Keys**). Copy these and put each in the right place:

   | Value | Public? | Goes to | Setting name |
   |---|---|---|---|
   | Project URL | public | Vercel and Azure | `NEXT_PUBLIC_SUPABASE_URL` on Vercel, `SUPABASE_URL` on Azure |
   | anon / publishable key | public by design | Vercel only | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | service_role / secret key | **SECRET** | Azure only, as a secret | `SUPABASE_SERVICE_ROLE_KEY` |

   The service-role key bypasses all protection. It must never go into Vercel, the web app, a `NEXT_PUBLIC_` setting, GitHub, a screenshot or a chat message.
4. On Azure: open the Container App, **Settings**, **Environment variables** (or **Containers**, **Edit and deploy**), add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (as a secret reference), save, and let a new revision start. `SUPABASE_JWT_SECRET` is only for old projects; new ones do not need it.
5. Under **Authentication**, **Providers**, switch on the sign-in methods you want (email is the simplest). Under **URL Configuration**, set the Site URL to your Vercel address (and later your own domain).
6. Check: reload `<Application URL>/health`. Expected result: `"store"` now says `supabase` instead of `memory`.
   Also open `<Application URL>/config`: `accounts` should be `true`.

Optional later: `MODERATOR_USER_IDS` is a comma-separated list of Supabase user ids (shown under Authentication, Users) who act as guides.

---

## 3. LiveKit Cloud (voice and video, optional)

Voice and video are off until all three values are set on the realtime server. Full details and a manual test are in [VOICE.md](VOICE.md). Not yet tried against LiveKit Cloud by us; only against a local test server.

1. Go to https://cloud.livekit.io and sign up. Create a project, name `channel-green`. Choose the plan **Free** (check its current limits on the pricing page).
2. In the project open **Settings**, then **Keys**, **Create key** (or use the one shown). Copy three things:

   | Value | Looks like | Goes to | Setting name |
   |---|---|---|---|
   | WebSocket URL | `wss://<project>.livekit.cloud` | Azure realtime server | `LIVEKIT_URL` |
   | API key | short text | Azure realtime server | `LIVEKIT_API_KEY` |
   | API secret | long text, **SECRET** | Azure realtime server, as a secret | `LIVEKIT_API_SECRET` |

   None of the three goes into Vercel or the web app. The web app learns about voice from the realtime server. The secret is shown only once, so copy it into your private note straight away.
3. On Azure add the three settings to the Container App (same place as before), save and wait for the new revision to run.
4. Check: `<Application URL>/health` now shows voice on (`"voice":true`), and `<Application URL>/config` shows `"voice":true`.
5. Real-world test is in the smoke test (section 5). Allow the microphone only when you press its button; that is how the app is designed.

---

## 4. Vercel: the web app

1. Sign in at https://vercel.com with your GitHub account (Hobby plan is free; it is meant for personal, non-commercial use, so check Vercel's terms if the site ever earns money).
2. **Add New**, **Project**, import `revanshsharma/Channel-Green`. Allow Vercel to read that one repository.
3. Settings on the import screen:
   - Branch to deploy: `build/mvp` for now (production branch can be changed later).
   - Framework preset: **Next.js**.
   - **Root Directory: `apps/web`**.
   - Install command (override): `cd ../.. && npm ci`
   - Build command (override): `cd ../.. && npm run content:build && npm run build -w @channel-green/web`
   - These come from docs/DEPLOYMENT.md and have not been tried on Vercel. If the first build fails, send us the build log's last lines.
4. Environment variables (Production and Preview). Only `NEXT_PUBLIC_` ones, because everything with that prefix is visible to anyone in the browser:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_REALTIME_URL` | your Azure Application URL (the `https://` one, no trailing slash) |
   | `NEXT_PUBLIC_SITE_URL` | your Vercel address for now (`https://<project>.vercel.app`) |
   | `NEXT_PUBLIC_SUPABASE_URL` | only if you did section 2 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | only if you did section 2 (the anon key, never the service-role key) |

   Do not add `SERVER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `LIVEKIT_API_KEY` or `LIVEKIT_API_SECRET` to Vercel. If Vercel shows a warning about a `NEXT_PUBLIC_` name containing the word KEY or SECRET, stop and check which value you pasted.
5. **Deploy**. Expected result: a build log ending in success, then a preview address like `https://channel-green-<random>.vercel.app`. Open it: you should see the landing page. This is a preview, nothing is on your own domain.
6. Tell the realtime server about the site. On Azure edit the `ALLOWED_ORIGINS` setting to the exact address(es), comma separated, no trailing slash, for example `https://<project>.vercel.app,http://localhost:3000`. Use your project's stable `.vercel.app` address. Individual deploy preview addresses with random names are not allowed unless you add each one, because the list does not accept wildcards.
7. Save, wait for the new revision, then open the Vercel address, press Play and join as a guest. Expected result: you walk into Town Square. If it says it cannot reach the world, the likely causes are a typo in `ALLOWED_ORIGINS` or `NEXT_PUBLIC_REALTIME_URL`. Note that `NEXT_PUBLIC_` values are baked in when the site is built, so after changing one on Vercel you must **redeploy** (Deployments, the three dots, Redeploy).

---

## 5. Smoke test, and staying safe on cost

### Final smoke test

Do these on the preview address, with two browsers (or one normal and one private window).

1. `<Application URL>/health` shows `"ok":true`.
2. The landing page loads and the "is the world awake" indicator says awake.
3. Press Play in both windows as guests, pick a name. Both land in Town Square.
4. Window A walks. Window B sees A move.
5. Chat a message in A. B sees it.
6. Go to the Confession Wall, post a note. It appears for the other player without an author.
7. If LiveKit is set up: follow the manual test in [VOICE.md](VOICE.md) steps 2 to 5 (join voice listen-only, microphone on, camera on). Try once on a phone.
8. If Supabase is set up: create an account, save an avatar, reload, check the avatar is still there. Check `/health` shows `"store":"supabase"`.
9. Leave both windows open for 15 minutes. Both should still see each other (checks long WebSocket connections through Azure).
10. In the Azure portal open the Container App, **Log stream**: no repeated error lines.
11. Open **Cost Management**, **Cost analysis** for `channel-green-rg`: note the cost after day one and day three and compare with your estimate.

### Stop and cost safety

- **Check cost weekly** for the first month in Cost Management, Cost analysis. Your budget alert at 20 dollars is a warning only.
- **Pause the server without deleting it**: open the Container App, Scale, set **Min replicas = 0** (and keep Max at 1), save. When no one visits, it stops costing compute; the first visitor after a pause waits a few seconds while it starts. Set Min back to 1 to make it always on again.
- **If you choose a VM instead**: use **Stop** on the VM page and make sure the status says **Stopped (deallocated)**. A VM that is only stopped inside its operating system keeps costing money. Its disk and public address keep a smaller charge until deleted.
- **Delete everything**: Resource groups, `channel-green-rg`, **Delete resource group**, type the name to confirm. This removes the server, the environment and anything else inside, and stops the charges. (It cannot be undone, and anything saved only in the server's memory is gone.)
- **Other services**: Vercel Hobby, Supabase Free and LiveKit Free should not charge you, but they have usage limits and Supabase's free projects can pause after a period of inactivity. Do not add a card to them unless you decide to upgrade.
- Never leave the Azure credit unattended near its end date: when credit runs out or expires, Azure may disable the subscription, and the realtime server stops.

---

## 6. Your own domain (do this last, yourself)

We do not touch DNS and we do not have access to it. When the preview works and you are ready, you add the records at the company where you manage `zerotheoryapp.tech`. The exact values are shown in each service's own screen, and they are what you copy, not what we guess here. Expect:

| Name | Type | Value | Where you get it |
|---|---|---|---|
| `@` (the bare domain) or `www` | A or CNAME | shown by Vercel | Vercel project, Settings, Domains, add `zerotheoryapp.tech` |
| `realtime` | CNAME | the Azure Application URL host name (without `https://`) | Container App, Settings, Custom domains, Add custom domain |
| `asuid.realtime` | TXT | a verification code shown by Azure | the same Azure screen |

Steps, in order:

1. In Vercel add the domain and copy the records it shows. Add them at your DNS provider. Wait until Vercel shows a green tick and https works.
2. In Azure add the custom domain `realtime.zerotheoryapp.tech`. Choose the free **managed certificate**. Add the CNAME and TXT records it shows, then validate. Wait for https to work on `https://realtime.zerotheoryapp.tech/health`.
3. Only then change the settings: Vercel `NEXT_PUBLIC_SITE_URL=https://zerotheoryapp.tech` and `NEXT_PUBLIC_REALTIME_URL=https://realtime.zerotheoryapp.tech` (then redeploy); Azure `ALLOWED_ORIGINS=https://zerotheoryapp.tech` plus the Vercel address if you still want it. Add the same site address to the Supabase Site URL if you use Supabase.
4. Repeat the smoke test on the real domain.

DNS changes can take from minutes to a day to spread. If you get stuck, tell us the exact message on the screen.

---

## What we will need from you later

Only confirmations and addresses, never secrets:

- "The realtime address is `https://...`" (the Azure Application URL). It is not a secret.
- "The Vercel preview address is `https://...`".
- "`/health` shows ok" and whether voice and store say what you expect.
- "Voice works / does not work, and this is the message I see".
- A yes or no on whether you are doing Supabase now or later.
- A screenshot of any error message, with keys, codes and email addresses hidden.
- Your yes when you have seen the preview and want it on your own domain.

Please never send: Azure, GitHub, Vercel, Supabase or LiveKit passwords; any key, secret or token; the `SERVER_SECRET`; login codes.

## What was not tested by us

Not one step on this page has been run on a real Azure, Supabase, LiveKit Cloud or Vercel account. Specifically untested: building the Docker image, running it on Container Apps, WebSockets through Azure's front door, long idle sessions, the Vercel build settings, applying the database file on Supabase, sign-in, LiveKit Cloud on a real network, and the DNS records. What has been tested: the app and server run locally, the automated tests pass, and voice and video work against a local test LiveKit server.
