# etr-vercel-proxy

Server side for Escape The Rave's live NPCs. The Nuance API key lives only in the
Vercel environment variable `NUANCE_API_KEY`; the game page never sees it.

- `GET /api/health` reports whether the key is configured (never its value).
