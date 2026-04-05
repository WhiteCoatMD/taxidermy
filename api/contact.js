import sgMail from '@sendgrid/mail';
import { put, list } from '@vercel/blob';

const LEADS_KEY = 'leads-manifest.json';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, phone, email, species, message } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  // Save lead to Blob storage
  try {
    const leads = await getLeads();
    leads.unshift({
      id: Date.now().toString(),
      name, phone, email, species, message,
      submittedAt: new Date().toISOString(),
      read: false,
    });
    await saveLeads(leads);
  } catch (e) { console.error('Failed to save lead:', e); }

  const toEmail = process.env.CONTACT_EMAIL;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL;
  if (!toEmail || !fromEmail) {
    return res.status(200).json({ success: true });
  }

  sgMail.setApiKey(process.env.SENDGRID_API_KEY);

  const htmlBody = `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; background: #1a1208; color: #e8d5b0; padding: 32px; border: 1px solid rgba(196,135,47,0.3);">
      <h2 style="font-family: sans-serif; color: #c4872f; margin: 0 0 24px 0; font-size: 20px; text-transform: uppercase; letter-spacing: 2px; border-bottom: 1px solid rgba(196,135,47,0.3); padding-bottom: 12px;">
        New Quote Request
      </h2>
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 12px; color: #c4872f; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; vertical-align: top; width: 120px;">Name</td>
          <td style="padding: 8px 12px; color: #e8d5b0;">${name}</td>
        </tr>
        ${phone ? `<tr>
          <td style="padding: 8px 12px; color: #c4872f; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; vertical-align: top;">Phone</td>
          <td style="padding: 8px 12px; color: #e8d5b0;"><a href="tel:${phone}" style="color: #e0a84a;">${phone}</a></td>
        </tr>` : ''}
        ${email ? `<tr>
          <td style="padding: 8px 12px; color: #c4872f; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; vertical-align: top;">Email</td>
          <td style="padding: 8px 12px; color: #e8d5b0;"><a href="mailto:${email}" style="color: #e0a84a;">${email}</a></td>
        </tr>` : ''}
        ${species ? `<tr>
          <td style="padding: 8px 12px; color: #c4872f; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; vertical-align: top;">Mount Type</td>
          <td style="padding: 8px 12px; color: #e8d5b0;">${species}</td>
        </tr>` : ''}
        ${message ? `<tr>
          <td style="padding: 8px 12px; color: #c4872f; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; vertical-align: top;">Message</td>
          <td style="padding: 8px 12px; color: #e8d5b0; white-space: pre-wrap;">${message}</td>
        </tr>` : ''}
      </table>
      <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid rgba(196,135,47,0.3); font-size: 12px; color: #7a6a54;">
        Sent from lonelypinestaxidermy.com
      </div>
    </div>
  `;

  try {
    await sgMail.send({
      to: toEmail,
      from: fromEmail,
      subject: `New Quote Request from ${name}${species ? ` — ${species}` : ''}`,
      html: htmlBody,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Email send failed:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
