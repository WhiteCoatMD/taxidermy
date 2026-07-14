import sgMail from '@sendgrid/mail';
import { put, get } from '@vercel/blob';

const LEADS_KEY = 'leads-manifest.json';
// Leads contain customer PII, so they live in a separate PRIVATE Blob store
// (not the public gallery store). Reads/writes require this store's token.
const LEADS_TOKEN = process.env.LEADS_READ_WRITE_TOKEN;

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
      from: { email: fromEmail.trim(), name: 'Lonely Pines Taxidermy' },
      subject: `New Quote Request from ${name}${species ? ' - ' + species : ''}`,
      html: htmlBody,
    });
    return res.status(200).json({ success: true, emailSent: true });
  } catch (error) {
    const sgError = error?.response?.body || error?.message || 'Unknown error';
    console.error('Email send failed:', JSON.stringify(sgError));
    // Lead is already saved to Blob — return success with email status
    return res.status(200).json({ success: true, emailSent: false, emailError: sgError });
  }
}
