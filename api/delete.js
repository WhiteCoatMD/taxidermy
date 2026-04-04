import crypto from 'crypto';
import { del } from '@vercel/blob';
import { getManifest, saveManifest } from './gallery.js';

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'Image ID is required' });
  }

  try {
    const manifest = await getManifest();
    const entry = manifest.find(e => e.id === id);

    if (!entry) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Delete from Vercel Blob
    await del(entry.url);

    // Remove from manifest
    const updated = manifest.filter(e => e.id !== id);
    await saveManifest(updated);

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete failed:', error);
    return res.status(500).json({ error: 'Delete failed' });
  }
}
