import crypto from 'crypto';
import { put, list } from '@vercel/blob';

const LEADS_KEY = 'leads-manifest.json';

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

async function getLeads() {
  const { blobs } = await list({ prefix: LEADS_KEY });
  if (blobs.length === 0) return [];
  const res = await fetch(blobs[0].url);
  return res.json();
}

async function saveLeads(leads) {
  await put(LEADS_KEY, JSON.stringify(leads), {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json',
  });
}

export default async function handler(req, res) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  if (req.method === 'GET') {
    try {
      const leads = await getLeads();
      return res.status(200).json(leads);
    } catch {
      return res.status(200).json([]);
    }
  }

  if (req.method === 'POST') {
    const { id, action } = req.body;

    try {
      const leads = await getLeads();

      if (action === 'markRead') {
        const lead = leads.find(l => l.id === id);
        if (lead) lead.read = true;
        await saveLeads(leads);
      } else if (action === 'delete') {
        const updated = leads.filter(l => l.id !== id);
        await saveLeads(updated);
      } else if (action === 'markAllRead') {
        leads.forEach(l => l.read = true);
        await saveLeads(leads);
      }

      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to update leads' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
