# etr-vercel-proxy

Hosted build of Escape The Rave with live NPCs (Mira and Sonia as Nuance Live personas).

- `index.html` + `assets/`: the game (same build as the claude.ai demo).
- `live.js`: runs the Nuance Live call in the page (`@nuancelabs/js-sdk`) and hands the persona's video to the game's sprite filter.
- `api/nuance-token.js`: mints the single-use session token. The API key lives only in the Vercel env var `NUANCE_API_KEY`.
- `GET /api/health`: says whether the key is configured (never its value).

The claude.ai demo can't run this part: that page blocks the microphone and WebRTC, so it stays on the scripted 30-second chatter.
