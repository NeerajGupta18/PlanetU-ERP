// Writes client/public/install-qr.svg, the QR code that opens the install page on a phone. It is a plain file, so the
// QR library never reaches a visitor. Run `node scripts/make-install-qr.mjs` again if the site gets a new address.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

export const INSTALL_URL = 'https://planetu-erp.onrender.com/install';
export const QR_FILE = fileURLToPath(new URL('../client/public/install-qr.svg', import.meta.url));

export const installQrSvg = () => QRCode.toString(INSTALL_URL, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: { dark: '#0F172A', light: '#FFFFFF' } });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(QR_FILE, await installQrSvg());
  console.log(`Wrote ${QR_FILE} for ${INSTALL_URL}`);
}
