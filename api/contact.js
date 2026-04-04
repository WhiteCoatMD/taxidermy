import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, phone, email, species, message } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }

  const toEmail = process.env.CONTACT_EMAIL;
  if (!toEmail) {
    return res.status(500).json({ error: 'Contact email not configured' });
  }

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
    await resend.emails.send({
      from: 'Lonely Pines Taxidermy <onboarding@resend.dev>',
      to: toEmail,
      subject: `New Quote Request from ${name}${species ? ` — ${species}` : ''}`,
      html: htmlBody,
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Email send failed:', error);
    return res.status(500).json({ error: 'Failed to send message' });
  }
}
