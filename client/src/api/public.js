import { ApiError } from './http.js';

/** Calls the public (no sign-in) admissions API of one institute. `accessCode` proves ownership of an application. */
export async function pub(code, path, { method = 'GET', body, form, accessCode } = {}) {
  const headers = {};
  if (accessCode) headers['x-access-code'] = accessCode;
  if (body) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(`/api/public/${encodeURIComponent(code)}/admissions${path}`, {
      method, headers, body: form ?? (body ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError('Cannot reach the server. Please try again.', 0);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw new ApiError(data?.message || 'Something went wrong. Please try again.', res.status, data);
  return data;
}
