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

// Only ever store known-safe raster image extensions. Prevents an uploaded
// filename like "x.svg"/"x.html" from setting an executable content-type on a
// public blob (stored-XSS). Client always sends compressed JPEG, so this never
// rejects a real upload — it just bounds the content-type.
const SAFE_IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

// A gallery reference must point at our own storage: a same-origin static path
// (public/...) or a Vercel Blob URL. Blocks arbitrary attacker-chosen URLs from
// being stored and later rendered on the homepage.
function isSafeGalleryUrl(url) {
  if (typeof url !== 'string') return false;
  if (/^public\/[^\s]+$/.test(url)) return true;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname.endsWith('.blob.vercel-storage.com');
  } catch {
    return false;
  }
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
      const rawExt = filename?.split('.').pop()?.toLowerCase() || 'jpg';
      const ext = SAFE_IMAGE_EXT.includes(rawExt) ? rawExt : 'jpg';
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
      if (!isSafeGalleryUrl(url)) return res.status(400).json({ error: 'Invalid image URL' });
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
