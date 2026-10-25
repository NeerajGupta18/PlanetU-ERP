/**
 * The institute's own look on printed papers (receipts, ID cards, reports): its logo and its colour, set in the
 * setup wizard. Load it inside the request's transaction (it reads the institute profile), then draw after commit.
 */
import { logoOf } from './setup.service.js';

/** PlanetU navy, used when the institute has not chosen a colour of its own. */
export const DEFAULT_BRAND = '#1E3A5F';

/** { color, logo } where logo is the PNG/JPEG bytes or null. */
export async function loadBrand(institute) {
  const logo = await logoOf();
  return { color: institute?.setup?.brandColor || DEFAULT_BRAND, logo: logo?.bytes ?? null };
}

/** Draws the logo fitted into a box; a broken picture is skipped rather than failing the whole PDF. Returns true if drawn. */
export function drawLogo(doc, logo, x, y, w, h = w) {
  if (!logo) return false;
  try { doc.image(logo, x, y, { fit: [w, h], align: 'center', valign: 'center' }); return true; } catch { return false; }
}
