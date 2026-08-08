// Photo upload. POST /api/upload?key=SYNC_KEY&filename=x.jpg with the image as the raw body.
// Returns {url} of the stored photo.
import { put } from '@vercel/blob';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if ((req.query.key || '') !== process.env.SYNC_KEY) {
    return res.status(401).json({ error: 'Wrong sync key.' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  if (!buf.length) return res.status(400).json({ error: 'No file received.' });
  if (buf.length > 4_400_000) return res.status(413).json({ error: 'Photo too large.' });

  const name = String(req.query.filename || 'photo.jpg').replace(/[^\w.\-]/g, '_').slice(-80);
  const blob = await put('crew-kitchen/photos/' + name, buf, {
    access: 'public',
    addRandomSuffix: true,
    contentType: req.headers['content-type'] || 'image/jpeg'
  });
  return res.status(200).json({ url: blob.url });
}
