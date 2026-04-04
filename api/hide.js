import crypto from 'crypto';
import { put, list } from '@vercel/blob';

const HIDDEN_KEY = 'hidden-images.json';

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

export async function getHiddenIds() {
  const { blobs } = await list({ prefix: HIDDEN_KEY });
  if (blobs.length === 0) return [];
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveHiddenIds(ids) {
  await put(HIDDEN_KEY, JSON.stringify(ids), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const hidden = await getHiddenIds();
      return res.status(200).json(hidden);
    } catch {
      return res.status(200).json([]);
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id, action } = req.body;
  if (!id) return res.status(400).json({ error: 'ID required' });

  try {
    const hidden = await getHiddenIds();

    if (action === 'unhide') {
      const updated = hidden.filter(h => h !== id);
      await saveHiddenIds(updated);
    } else {
      if (!hidden.includes(id)) hidden.push(id);
      await saveHiddenIds(hidden);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Hide failed:', error);
    return res.status(500).json({ error: 'Failed to update' });
  }
}
