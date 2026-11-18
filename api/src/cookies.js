/** Read one cookie from the request (no cookie-parser needed for the two cookies the API uses). */
export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/** The web app identifies itself with this header. A cross-site page can't send it without a CORS preflight, which is refused. */
export const isWebClient = (req) => req.get('x-lorelai-client') === 'web';

export const REFRESH_COOKIE = 'lorelai_rt';
export const TRIAL_COOKIE = 'lorelai_trial';
