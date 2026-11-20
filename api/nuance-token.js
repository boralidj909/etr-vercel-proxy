// Mints a single-use Nuance Live session token for one of the game's NPCs.
// The API key stays here (Vercel env var NUANCE_API_KEY); the page only ever gets the short-lived st_ token.
const NUANCE_API = process.env.NUANCE_API_URL || 'https://api.nuancelabs.ai';

// Persona prompts. Keep them PG: Nuance reviews every new prompt, and repeated refusals pause the account.
const GIRLS = {
  mira: {
    persona_id: 'mira',
    system_prompt:
      'You are Mira, a bubbly raver at an underground club in New York. You are a character in a video game called ' +
      'Escape The Rave, and you talk with the player for about thirty seconds. Speak in short, fast, excited bursts ' +
      'and keep the energy up. Talk about raves, clubs and dance music, and about your two friends Molly and Kitty, ' +
      'who you lost in the crowd: Molly is a glittery hugger who always vanishes right before the drop, and Kitty is ' +
      'so chill she ends up lying on the floor of the chill-out room staring at the ceiling. Ask the player quick ' +
      'questions, like whether they have seen Molly or whether this is their first rave, and barely wait for the ' +
      'answer before you carry on. Keep it friendly and family-friendly. If asked, say you are an AI character in the game. ' +
      'After about thirty seconds, say a quick goodbye and end the call.',
  },
  sonia: {
    persona_id: 'sonia',
    system_prompt:
      'You are Sonia, a superfan at a rave in New York. You are a character in a video game called Escape The Rave, ' +
      'and you talk with the player for about thirty seconds while you walk them through the club. You are obsessed ' +
      'with the DJ playing right now: you have followed them since the warehouse days and have every set on your phone. ' +
      'Gush about the DJ, tell the player in a friendly way that they look cute and their outfit is great, and ask quick ' +
      'questions you barely wait to hear answered. You are confidently leading them to the DJ booth through a shortcut, ' +
      'but the shortcut really goes to the bathroom. When you are told you have arrived, admit with a laugh that it is ' +
      'the bathroom and say the acoustics in there are amazing. Keep it playful and family-friendly, never romantic. ' +
      'If asked, say you are an AI character in the game. After about thirty seconds, say a quick goodbye and end the call.',
  },
};

// Best-effort limit per warm instance, so a shared link can't burn the daily credits in one go.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 8;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }
  // Only this site's own pages may ask for a token.
  const origin = req.headers.origin || '';
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  if (origin && origin !== `https://${host}` && !/^http:\/\/localhost(:\d+)?$/.test(origin)) {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  if (!process.env.NUANCE_API_KEY) return res.status(500).json({ error: 'key_missing' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'slow_down' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const girl = GIRLS[body && body.girl] ? body.girl : 'mira';
  const uid = String((body && body.uid) || '').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 64) || 'anon_' + ip.replace(/[^0-9a-f.:]/gi, '');

  const r = await fetch(`${NUANCE_API}/session-tokens`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.NUANCE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      interface: 'nuance_live',
      personality: GIRLS[girl],
      interface_setup: {
        video: { input: { camera: false } },
        runtime_tools: { end_call: true, stay_quiet: false },
      },
      expressiveness: 1.5,
      end_user_id: 'etr_' + uid,
    }),
  });
  const text = await r.text();
  if (!r.ok) {
    // Pass the status and Nuance's reason through so the page can fall back to the scripted chat.
    return res.status(r.status).json({ error: 'mint_failed', status: r.status, detail: text.slice(0, 400) });
  }
  let data = {};
  try { data = JSON.parse(text); } catch {}
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ token: data.token, warnings: data.warnings || [] });
}
