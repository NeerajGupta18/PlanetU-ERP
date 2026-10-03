import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let cached = { key: null, transport: null };

/** 'smtp' -> real delivery via SMTP_URL. Anything else -> print to the console (development only). */
export function getTransport() {
  const key = `${env.MAIL_TRANSPORT}|${env.SMTP_URL}`;
  if (cached.key === key) return cached.transport;
  let transport;
  if (env.MAIL_TRANSPORT === 'smtp') {
    if (!env.SMTP_URL) throw new Error('MAIL_TRANSPORT=smtp needs SMTP_URL (e.g. smtps://user:pass@smtp.example.com)');
    transport = nodemailer.createTransport(env.SMTP_URL, { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000 });
  } else {
    transport = {
      sendMail: async (m) => {
        // The body holds one-time links, so it is only ever printed outside production
        console.log(`[mail] to=${m.to} subject="${m.subject}"${env.isProd ? '' : `\n${m.text}\n`}`);
      },
    };
  }
  cached = { key, transport };
  return transport;
}
