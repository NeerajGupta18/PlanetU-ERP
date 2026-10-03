/**
 *   npm run create-vendor -- --login=owner --email=you@example.com --name="Your Name" [--reset]
 *
 * The password is read from the VENDOR_PASSWORD environment variable, or typed at a hidden prompt.
 * It is never taken from the command line (that would end up in shell history) and never printed.
 */
import readline from 'node:readline';
import { createVendor } from './vendor.js';
import { closePool } from './pool.js';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const flag = (k) => process.argv.includes(`--${k}`);

function ask(prompt, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

try {
  const login = arg('login') || process.env.VENDOR_LOGIN || await ask('Vendor login: ');
  const email = arg('email') || process.env.VENDOR_EMAIL || await ask('Vendor email: ');
  const name = arg('name') || process.env.VENDOR_NAME || 'Platform Owner';
  const password = process.env.VENDOR_PASSWORD || await ask('Password (hidden): ', { hidden: true });
  const r = await createVendor({ login, name, email, password, reset: flag('reset') });
  console.log(r.created ? `Vendor account "${r.login}" created. Sign in with no institute code.` : `Password for "${r.login}" changed.`);
} catch (e) {
  console.error(`Not done: ${e.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
