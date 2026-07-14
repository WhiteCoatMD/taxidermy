import crypto from 'crypto';
import { put, get } from '@vercel/blob';

const LEADS_KEY = 'leads-manifest.json';
// Leads contain customer PII, so they live in a separate PRIVATE Blob store
// (not the public gallery store). Reads/writes require this store's token.
const LEADS_TOKEN = process.env.LEADS_READ_WRITE_TOKEN;

function isAuthenticated(req) {
  const expected = crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
  const cookies = req.headers.cookie || '';
  const match = cookies.split(';').find(c => c.trim().startsWith('admin_token='));
  if (!match) return false;
  return match.split('=')[1].trim() === expected;
}

async function getLeads() {
  const result = await get(LEADS_KEY, { access: 'private', token: LEADS_TOKEN });
  if (!result) return []; // get() returns null when the blob doesn't exist yet
  const text = await new Response(result.stream).text();
  return text ? JSON.parse(text) : [];
}

async function saveLeads(leads) {
  await put(LEADS_KEY, JSON.stringify(leads), {
    access: 'private',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/json',
    token: LEADS_TOKEN,
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
