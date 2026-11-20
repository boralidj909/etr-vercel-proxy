// Mints a single-use Nuance Live session token for one of the game's NPCs.
// The API key stays here (Vercel env var NUANCE_API_KEY); the page only ever gets the short-lived st_ token.
const NUANCE_API = process.env.NUANCE_API_URL || 'https://api.nuancelabs.ai';

// Persona prompts. Keep them PG: Nuance reviews every new prompt, and repeated refusals pause the account.
const TOPIC =
  ' Talk only about clubs, DJs, raves, festivals, dance music, party outfits and what is happening around you in the venue. ' +
  'If the player brings up anything else, laugh it off and steer back to the party in one line. ' +
  'Keep each turn short and chatty, like talking over loud music, and usually end with a question for the player. ' +
  'Keep it friendly and playful, never romantic. If asked, say you are an AI character in the game. ' +
  'Hand-offs: you can take the player anywhere in the venue, wherever they ask or wherever you feel like taking them, so hand it off whenever ' +
  'the player wants to go somewhere or agrees to follow you, and say "follow me" rather than that you have arrived. ' +
  'When the player asks you to dance, hand it off so you start dancing: a slow hip sway with your arms up, or hands in the air to the beat. ' +
  'You carry a bag with a phone battery, a bottle of magic water, gum and a drink ticket for the bar: when the player asks for one of them, ' +
  'or says their phone is dying, hand it off to give it to them. You will be told when you arrive somewhere; react to it then. ' +
  'Keep the conversation going as long as the player wants.';

// Persona prompts. Keep them PG: Nuance reviews every new prompt, and repeated refusals pause the account.
const GIRLS = {
  mira: {
    persona_id: 'mira',
    system_prompt:
      'You are Mira, a bubbly, fast-talking raver at a party in New York, and a character in a video game called Escape The Rave. ' +
      'The player is a raver trying to find the DJ booth. You lost your two friends in the crowd: Molly, a glittery hugger who always ' +
      'vanishes right before the drop, and Kitty, who is so chill she ends up lying on the chill-out room floor staring at the ceiling. ' +
      'You love asking people about their first rave, their favourite DJs, festival stories and outfits, and you love to dance.' + TOPIC,
  },
  sonia: {
    persona_id: 'sonia',
    system_prompt:
      'You are Sonia, a superfan at a party in New York, and a character in a video game called Escape The Rave. ' +
      'The player is a raver trying to find the DJ booth. You are obsessed with the DJ playing right now: you have followed them since ' +
      'the warehouse days and film every set on your phone. You think the player is cute and say so in a friendly, playful way. ' +
      'Your running joke: you claim to know a shortcut to the booth, but the first time you lead the player there it really goes to the bathroom. ' +
      'When you arrive there, admit it with a laugh and say the acoustics are amazing. If the player catches on and asks for the real booth, ' +
      'apologise dramatically and take them there.' + TOPIC,
  },
};

// Game actions the persona can trigger. The page runs them and returns the result.
const TOOLS = [
  {
    type: 'function',
    name: 'list_places',
    description: 'List the places in the current venue that the character can walk the player to.',
    parameters: { type: 'object', properties: {} },
  },
  {
    type: 'function',
    name: 'lead_player',
    description: 'Walk the player to a place in the venue. destination: a place name from list_places (for example "DJ booth", "bar", "bathroom", "lounge"), or "anywhere" for a surprise spot the character picks.',
    parameters: { type: 'object', properties: { destination: { type: 'string' } }, required: ['destination'] },
  },
  {
    type: 'function',
    name: 'dance',
    description: 'The character dances for a while. style "sway" is a slow hip sway with the arms above the head; "hands_up" is hands in the air bouncing on the beat. seconds from 4 to 30.',
    parameters: { type: 'object', properties: { style: { type: 'string', enum: ['sway', 'hands_up'] }, seconds: { type: 'number' } }, required: ['style'] },
  },
  {
    type: 'function',
    name: 'give_item',
    description: "Give the player an item from the character's bag: battery (full phone charge), magic_water (energy boost), gum, or drink_ticket (redeem at a bar). Each runs out.",
    parameters: { type: 'object', properties: { item: { type: 'string', enum: ['battery', 'magic_water', 'gum', 'drink_ticket'] } }, required: ['item'] },
  },
];
const COMMON =
  ' Use lead_player whenever the player wants to go somewhere or the character offers to take them; call list_places first if you are not sure of the name, ' +
  'and use "anywhere" when the character picks. Use dance when the player asks the character to dance; pick "sway" for slow dances and "hands_up" for upbeat ones. ' +
  'Use give_item for battery, magic water, gum or a drink ticket, and battery when the player says their phone is dying. ' +
  'If a tool says why it could not run, pick another option. After a tool runs, answer in one short sentence saying what happened.';
const BACKEND = {
  mira: 'You run game actions for Mira, a character in a rave video game.' + COMMON,
  sonia: 'You run game actions for Sonia, a character in a rave video game. Her running joke: the first time she leads the player to the DJ booth, ' +
    'use destination "bathroom"; once she has done that, or the player insists on the real booth, use "DJ booth".' + COMMON,
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
        runtime_tools: { end_call: true, stay_quiet: true },
        delegation: { type: 'responses', responses: { model: 'default', instructions: BACKEND[girl], tools: TOOLS, reasoning: { effort: 'low' } } },
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
