// Email sender (nodemailer). When SMTP is not configured it degrades to
// writing a .eml file into ./outbox so you can develop/demo without a mail
// server. Same call signature either way.
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import { env, envBool, envInt } from '../../config/env.js';

let cachedTransport;

function getTransport() {
  if (cachedTransport !== undefined) return cachedTransport;
  const host = env('SMTP_HOST');
  if (!host) {
    cachedTransport = null; // outbox mode
    return null;
  }
  cachedTransport = nodemailer.createTransport({
    host,
    port: envInt('SMTP_PORT', 587),
    secure: envBool('SMTP_SECURE', false),
    auth: env('SMTP_USER')
      ? { user: env('SMTP_USER'), pass: env('SMTP_PASS') }
      : undefined,
  });
  return cachedTransport;
}

/**
 * Send an email with optional attachments.
 * @returns {Promise<{ delivered: boolean, mode: 'smtp'|'outbox', ref: string }>}
 */
export async function sendMail({ to, subject, html, text, attachments = [] }) {
  const from = env('MAIL_FROM', 'Sprout Events <events@sprout.ph>');
  const bcc = env('MAIL_BCC') || undefined;
  const transport = getTransport();

  if (!transport) {
    // Outbox fallback — write a readable .eml-ish file.
    const dir = path.resolve('./outbox');
    fs.mkdirSync(dir, { recursive: true });
    const safe = String(subject).replace(/[^\w.-]+/g, '_').slice(0, 60);
    const file = path.join(dir, `${Date.now()}_${safe}.eml`);
    const attachNote = attachments
      .map((a) => `Attachment: ${a.filename} (${a.content?.length ?? 0} bytes)`)
      .join('\n');
    fs.writeFileSync(
      file,
      [
        `From: ${from}`,
        `To: ${to}`,
        bcc ? `Bcc: ${bcc}` : '',
        `Subject: ${subject}`,
        '',
        text || '',
        '',
        attachNote,
        '',
        '--- HTML ---',
        html || '',
      ].join('\n')
    );
    // Also drop the PDF next to it for easy inspection.
    for (const a of attachments) {
      if (a.content) fs.writeFileSync(path.join(dir, a.filename), a.content);
    }
    console.warn(`[email] SMTP not configured — wrote ${file}`);
    return { delivered: false, mode: 'outbox', ref: file };
  }

  const info = await transport.sendMail({
    from,
    to,
    bcc,
    subject,
    text,
    html,
    attachments,
  });
  return { delivered: true, mode: 'smtp', ref: info.messageId };
}
