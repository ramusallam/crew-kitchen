// Cloud copy of the app's data, stored as one JSON blob.
// GET  /api/state?key=SYNC_KEY          -> the saved state (404 if none yet)
// POST /api/state?key=SYNC_KEY  {json}  -> overwrite the saved state
import { put, head } from '@vercel/blob';

const PATH = 'crew-kitchen/state.json';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if ((req.query.key || '') !== process.env.SYNC_KEY) {
    return res.status(401).json({ error: 'Wrong sync key.' });
  }

  if (req.method === 'GET') {
    try {
      const info = await head(PATH);
      const data = await fetch(info.downloadUrl + '?t=' + Date.now(), { cache: 'no-store' }).then(r => r.json());
      return res.status(200).json(data);
    } catch {
      return res.status(404).json({ error: 'No cloud data yet.' });
    }
  }

  if (req.method === 'POST') {
    const body = req.body;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Bad data.' });
    await put(PATH, JSON.stringify(body), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json'
    });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
}
