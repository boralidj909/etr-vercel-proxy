export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(200).json({ ok: true, service: 'etr-vercel-proxy', nuanceKey: !!process.env.NUANCE_API_KEY });
}
