import crypto from 'crypto';

function getAuthToken() {
  return crypto.createHash('sha256').update(process.env.ADMIN_PASSWORD + '_lonely_pines_salt').digest('hex');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body;

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Admin password not configured' });
  }

  if (String(password).trim() !== String(process.env.ADMIN_PASSWORD).trim()) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = getAuthToken();

  res.setHeader('Set-Cookie', `admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`);
  return res.status(200).json({ success: true });
}
