// How much live chat is left today. Numbers only; never the key.
const NUANCE_API = process.env.NUANCE_API_URL || 'https://api.nuancelabs.ai';
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!process.env.NUANCE_API_KEY) return res.status(500).json({ error: 'key_missing' });
  try {
    const r = await fetch(`${NUANCE_API}/usage`, { headers: { Authorization: `Bearer ${process.env.NUANCE_API_KEY}` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: 'usage_failed' });
    return res.status(200).json({
      available_credits: j.available_credits,
      active_sessions: j.active_sessions,
      concurrent_sessions: j.limits && j.limits.concurrent_sessions,
      daily_credits: j.limits && j.limits.daily_credits,
      hourly_conversations: j.limits && j.limits.hourly_conversations,
    });
  } catch {
    return res.status(502).json({ error: 'usage_unreachable' });
  }
}
