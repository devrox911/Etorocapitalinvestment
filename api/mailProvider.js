import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const EMAIL_PROVIDER = (process.env.EMAIL_PROVIDER || 'turbosmtp').trim().toLowerCase();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOGO_CID = 'etoro-trust-capital-logo';
const LOGO_FILENAME = 'email-logo.png';

export const htmlToText = (html = '') =>
  html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const getSender = () => ({
  email:
    process.env.EMAIL_FROM ||
    process.env.EMAIL_FROM_ADDRESS ||
    process.env.SMTP_FROM ||
    `no-reply@${process.env.APP_DOMAIN || 'ciphervault.example'}`,
  name:
    process.env.EMAIL_FROM_NAME ||
    process.env.SMTP_FROM_NAME ||
    'eToro Trust Capital',
});

const getReplyTo = (replyToEmail, replyToName) => {
  const email =
    replyToEmail ||
    process.env.EMAIL_REPLY_TO ||
    process.env.EMAIL_FROM ||
    process.env.SMTP_FROM ||
    'noreply@etorocapital.online';
  if (!email) return null;

  return {
    email,
    name: replyToName || process.env.EMAIL_REPLY_TO_NAME || 'eToro Trust Capital',
  };
};

const normalizeRecipients = (to, fallbackName) => {
  const recipients = Array.isArray(to) ? to : [to];
  return recipients
    .filter(Boolean)
    .map((recipient) => {
      if (typeof recipient === 'string') {
        return { email: recipient, name: fallbackName || recipient.split('@')[0] };
      }

      return {
        email: recipient.email,
        name: recipient.name || fallbackName || recipient.email?.split('@')[0] || 'Recipient',
      };
    })
    .filter((recipient) => recipient.email);
};

const getLogoAttachment = () => {
  const candidatePaths = [
    path.join(process.cwd(), 'public', 'images', LOGO_FILENAME),
    path.join(__dirname, '..', 'public', 'images', LOGO_FILENAME),
  ];

  const logoPath = candidatePaths.find((candidate) => fs.existsSync(candidate));
  if (!logoPath) return null;

  return {
    filename: LOGO_FILENAME,
    path: logoPath,
    cid: LOGO_CID,
    contentType: 'image/png',
  };
};

const inlineStandardLogo = (html = '') => {
  const logoAttachment = getLogoAttachment();
  if (!logoAttachment || !/\/images\/email-logo\.png/i.test(html)) {
    return { html, attachments: [] };
  }

  return {
    html: html.replace(/src=(["'])[^"']*\/images\/email-logo\.png\1/gi, `src="cid:${LOGO_CID}"`),
    attachments: [logoAttachment],
  };
};

const hasSmtp = () => !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);

const getSmtpProviderLabel = () =>
  (process.env.SMTP_HOST || '').toLowerCase().includes('turbo-smtp') ? 'turbosmtp' : 'smtp';

const resolveProvider = () => {
  if (EMAIL_PROVIDER === 'none' || EMAIL_PROVIDER === 'mock') return null;
  if (hasSmtp()) return 'smtp';
  return null;
};

export const getEmailProviderStatus = () => {
  const sender = getSender();
  return {
    requestedProvider: EMAIL_PROVIDER,
    activeProvider: resolveProvider() ? getSmtpProviderLabel() : null,
    hasSmtp: hasSmtp(),
    smtpHost: process.env.SMTP_HOST || '',
    fromEmail: sender.email,
    fromName: sender.name,
  };
};

const sendViaSmtp = async ({ recipients, subject, html, text, replyTo, sender, attachments }) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const result = await transporter.sendMail({
    from: `${sender.name} <${sender.email}>`,
    to: recipients.map((recipient) => recipient.email).join(', '),
    replyTo: replyTo ? `${replyTo.name} <${replyTo.email}>` : undefined,
    subject,
    text,
    html,
    attachments,
  });

  return {
    provider: getSmtpProviderLabel(),
    messageId: result.messageId || null,
  };
};

export const sendTransactionalEmail = async ({
  to,
  toName,
  subject,
  html,
  text,
  replyToEmail,
  replyToName,
}) => {
  const recipients = normalizeRecipients(to, toName);
  if (!recipients.length) {
    throw new Error('No valid email recipients provided');
  }

  const provider = resolveProvider();
  if (!provider) {
    return { sent: false, provider: null, messageId: null };
  }

  const sender = getSender();
  const replyTo = getReplyTo(replyToEmail, replyToName);
  const { html: normalizedHtml, attachments } = inlineStandardLogo(html || '');
  const normalizedText = text || htmlToText(normalizedHtml);

  const result = await sendViaSmtp({
    recipients,
    subject,
    html: normalizedHtml,
    text: normalizedText,
    replyTo,
    sender,
    attachments,
  });

  return {
    sent: true,
    provider: result.provider,
    messageId: result.messageId,
    sender,
  };
};
