import { list, put } from '@vercel/blob';

const MANIFEST_KEY = 'gallery-manifest.json';

export async function getManifest() {
  const { blobs } = await list({ prefix: MANIFEST_KEY });
  if (blobs.length === 0) {
    return [];
  }
  const res = await fetch(blobs[0].url);
  return res.json();
}

export async function saveManifest(entries) {
  await put(MANIFEST_KEY, JSON.stringify(entries), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const entries = await getManifest();
    res.setHeader('Cache-Control', 'public, s-maxage=10, stale-while-revalidate=30');
    return res.status(200).json(entries);
  } catch (error) {
    console.error('Failed to load gallery:', error);
    return res.status(500).json({ error: 'Failed to load gallery' });
  }
}
