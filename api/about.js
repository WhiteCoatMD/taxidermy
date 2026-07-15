import crypto from 'crypto';
import { put, del, list } from '@vercel/blob';

const MANIFEST_KEY = 'about-slideshow.json';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

async function getSlides() {
  const { blobs } = await list({ prefix: MANIFEST_KEY });
  if (blobs.length === 0) return [];
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveSlides(slides) {
  await put(MANIFEST_KEY, JSON.stringify(slides), {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  // Public read — never throws, so the homepage can always fall back.
  if (req.method === 'GET') {
    try {
      const slides = await getSlides();
      res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
      return res.status(200).json(slides);
    } catch (error) {
      console.error('Failed to load slideshow:', error);
      return res.status(200).json([]);
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { action } = req.body || {};

  try {
    const slides = await getSlides();

    if (action === 'add-upload') {
      const { image, filename } = req.body;
      if (!image) return res.status(400).json({ error: 'Image is required' });

      const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      const id = crypto.randomUUID();
      const ext = filename?.split('.').pop()?.toLowerCase() || 'jpg';
      const blob = await put(`about/${id}.${ext}`, buffer, {
        access: 'public',
        contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
      });

      const entry = { id, url: blob.url, source: 'upload', refId: null };
      slides.push(entry);
      await saveSlides(slides);
      return res.status(200).json({ success: true, entry });
    }

    if (action === 'add-gallery') {
      const { refId, url } = req.body;
      if (!refId || !url) return res.status(400).json({ error: 'refId and url are required' });
      if (slides.some(s => s.refId === refId)) {
        return res.status(200).json({ success: true, duplicate: true });
      }
      const entry = { id: crypto.randomUUID(), url, source: 'gallery', refId };
      slides.push(entry);
      await saveSlides(slides);
      return res.status(200).json({ success: true, entry });
    }

    if (action === 'remove') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'ID is required' });
      const entry = slides.find(s => s.id === id);
      if (entry && entry.source === 'upload') {
        try { await del(entry.url); } catch (e) { console.error('Blob delete failed:', e); }
      }
      await saveSlides(slides.filter(s => s.id !== id));
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (error) {
    console.error('Slideshow update failed:', error);
    return res.status(500).json({ error: 'Update failed' });
  }
}
