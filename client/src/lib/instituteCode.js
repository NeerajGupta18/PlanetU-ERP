// The institute code to start the sign-in form with. A plain function, so the tests can run it without a browser.

// Addresses shared with other sites, and first labels that name the site rather than an institute
const SHARED_HOSTS = /\.(onrender\.com|vercel\.app|netlify\.app|herokuapp\.com)$/;
const NOT_AN_INSTITUTE = ['www', 'app', 'erp', 'portal', 'campus', 'planetu'];

/** horizon.example.com gives "horizon". Otherwise the code this device saved last time, or nothing. */
export function initialInstituteCode(hostname = '', saved = '') {
  const parts = hostname.split('.');
  const isIp = /^\d+$/.test(parts[parts.length - 1]);
  if (parts.length >= 3 && !isIp && !SHARED_HOSTS.test(hostname) && !NOT_AN_INSTITUTE.includes(parts[0].toLowerCase())) return parts[0].toLowerCase();
  return saved || '';
}
