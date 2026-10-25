// "Your institute, your look": the institute's own colour replaces the PlanetU navy (--brand and its shades) on
// every screen. The server only accepts colours dark enough for white text (setup.service.js), so buttons stay
// readable. Called with null it goes back to the default navy from global.css.
const VARS = {
  '--brand': (c) => c,
  '--brand-hover': (c) => `color-mix(in srgb, ${c} 82%, black)`,
  '--brand-50': (c) => `color-mix(in srgb, ${c} 7%, white)`,
  '--brand-100': (c) => `color-mix(in srgb, ${c} 15%, white)`,
  '--brand-500': (c) => `color-mix(in srgb, ${c} 80%, white)`,
  '--brand-600': (c) => `color-mix(in srgb, ${c} 92%, black)`,
  '--brand-700': (c) => `color-mix(in srgb, ${c} 78%, black)`,
  '--brand-900': (c) => `color-mix(in srgb, ${c} 50%, black)`,
  '--brand-shadow': (c) => `color-mix(in srgb, ${c} 25%, transparent)`,
};

export function applyBrandColor(color) {
  const root = document.documentElement.style;
  const ok = typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && CSS.supports?.('color', 'color-mix(in srgb, red 50%, white)');
  for (const [name, make] of Object.entries(VARS)) {
    if (ok) root.setProperty(name, make(color)); else root.removeProperty(name);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', ok ? color : '#1E3A5F');
}

/** The URL of the institute's logo, or null. The version makes browsers fetch a new picture after a change. */
export const logoUrl = (institute) => (institute?.logoVersion ? `/api/me/logo?v=${institute.logoVersion}` : null);

/** Contrast of white text on a #RRGGBB colour (the server refuses anything under 4.5). */
export function whiteContrast(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}
