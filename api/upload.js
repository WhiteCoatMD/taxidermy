import crypto from 'crypto';
import { put } from '@vercel/blob';
import { getManifest, saveManifest } from './gallery.js';

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { image, filename, category, customCategory, caption } = req.body;

  if (!image || !category) {
    return res.status(400).json({ error: 'Image and category are required' });
  }

  try {
    // Decode base64 image
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Generate unique filename
    const id = crypto.randomUUID();
    const ext = filename?.split('.').pop()?.toLowerCase() || 'jpg';
    const blobPath = `gallery/${id}.${ext}`;

    // Upload to Vercel Blob
    const blob = await put(blobPath, buffer, {
      access: 'public',
      contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    });

    // Create manifest entry
    const entry = {
      id,
      url: blob.url,
      category,
      customCategory: category === 'other' ? (customCategory || '') : '',
      caption: caption || '',
      uploadedAt: new Date().toISOString(),
    };

    // Update manifest
    const manifest = await getManifest();
    manifest.unshift(entry);
    await saveManifest(manifest);

    return res.status(200).json({ success: true, entry });
  } catch (error) {
    console.error('Upload failed:', error);
    return res.status(500).json({ error: 'Upload failed' });
  }
}
