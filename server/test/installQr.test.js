/** The QR code on the install page opens the install page - run with `npm test`. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { INSTALL_URL, QR_FILE, installQrSvg } from '../../scripts/make-install-qr.mjs';

describe('install page QR code', () => {
  it('points at the install page on the live site', () => {
    assert.equal(INSTALL_URL, 'https://planetu-erp.onrender.com/install');
  });
  it('is the file that the script makes from that address', async () => {
    assert.equal(readFileSync(QR_FILE, 'utf8'), await installQrSvg());
  });
});
