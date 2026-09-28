# Vaishnav Jan: gratitude tree

The landing page for Indian Ocean's *Vaishnav Jan*. Visitors tie anonymous thank-yous and wishes to a banyan tree.

It runs entirely on Cloudflare:
- **Workers** serves the page and a small API.
- **D1** (Cloudflare's database) stores the threads.

For a campaign of this size, it should stay within Cloudflare's free tier.

## What's in the folder

| Path | What it is |
|---|---|
| `public/index.html` | The landing page |
| `public/_headers` | Basic security headers |
| `src/worker.js` | The API: list, add, hold a wish, moderate |
| `schema.sql` | Database tables |
| `wrangler.jsonc` | Cloudflare configuration |

## One-time setup (about 10 minutes)

You need a free Cloudflare account and Node.js 18 or newer on your computer.

**1. Install and log in.** Open a terminal in this folder and run:

```bash
npm install
npx wrangler login
```

A browser window opens. Approve access to your Cloudflare account.

**2. Create the database.**

```bash
npx wrangler d1 create vaishnav-jan
```

This prints a `database_id`. Open `wrangler.jsonc` and paste it in place of `REPLACE_WITH_YOUR_DATABASE_ID`.

**3. Create the tables.**

```bash
npm run db:init:remote
```

**4. Set two secrets.** Each command asks you to paste a value.

```bash
npx wrangler secret put ADMIN_TOKEN
npx wrangler secret put HASH_SALT
```

- `ADMIN_TOKEN` is the moderator password. Use a long random string, for example the output of `openssl rand -hex 24`. Share it only with the people who will moderate.
- `HASH_SALT` is any other long random string. It is used for rate-limiting only.

**5. Deploy.**

```bash
npm run deploy
```

Wrangler prints the live address, something like `https://vaishnav-jan.<your-subdomain>.workers.dev`.

## Using your own domain

If your domain is already on Cloudflare (for example `indianoceanmusic.com`):

1. Go to **Workers & Pages → vaishnav-jan → Settings → Domains & Routes**.
2. Add a custom domain such as `vaishnavjan.indianoceanmusic.com`.

Cloudflare creates the DNS record and SSL certificate automatically.

## Moderating

Open the page with your token after a `#`:

```
https://your-site/#admin=YOUR_ADMIN_TOKEN
```

This turns on moderator mode:
- A **Review queue** appears near the bottom of the page, with Approve and Reject buttons.
- Every thread on the tree gains a **Hide from the tree** button.

The token is removed from the address bar straight away, so it won't end up in screenshots. Anything after `#` is never sent to servers or analytics.

### Choosing a moderation mode

Set `MODERATION` in `wrangler.jsonc`, then run `npm run deploy` again.

- **`"pre"` (default).** New threads wait in the review queue and appear only after approval. This is recommended for launch week, when attention and trolling both peak.
- **`"post"`.** Threads appear instantly and moderators hide anything that slips through. Switch to this once the volume is manageable and you trust the filters.

In both modes, the page and the API block phone numbers, emails, links, social handles and common abuse in Hindi and English before a thread is ever saved.

## Privacy

- Threads store only what the visitor typed: type, "who it's for", message, colour and time. No name, email or account is stored.
- IP addresses are never stored. A salted hash that changes every day is kept for up to 24 hours, only to limit a visitor to 20 threads per 10 minutes. The limit is generous because many Indian mobile users share one IP address.

## Handy commands

```bash
# Test locally at http://localhost:8787
cp .dev.vars.example .dev.vars   # local-only admin token and salt
npm run db:init:local
npm run dev

# Count threads by status
npx wrangler d1 execute vaishnav-jan --remote --command "SELECT status, COUNT(*) FROM notes GROUP BY status"

# Export every thread (for a lyric video, a live-show projection or an archive)
npx wrangler d1 execute vaishnav-jan --remote --json --command "SELECT kind, to_whom, body, color, created_at, holds FROM notes WHERE status='live' ORDER BY created_at" > threads.json
```

## Updating the page later

Edit `public/index.html`, then run `npm run deploy`. The threads live in the database, so redeploying never erases them.
