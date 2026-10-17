const ORIGIN = 'https://foxprey.com';
const SHEET_ID = '1eEElGIXGydawPyUpGHtYwkO4UttjSoCOYdYXDOjqkck';
let cachedToken;

async function upstreamError(response) {
  const error = new Error('Upstream request failed');
  error.upstreamStatus = response.status;
  // Only retain known diagnostic codes, never raw upstream messages or bodies.
  const allowed = new Set(['SERVICE_DISABLED', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
    'PERMISSION_DENIED', 'NOT_FOUND', 'INVALID_ARGUMENT', 'UNAUTHENTICATED',
    'RESOURCE_EXHAUSTED', 'invalid_grant', 'invalid_client', 'access_denied',
    'missing-input-secret', 'invalid-input-secret', 'missing-input-response',
    'invalid-input-response', 'bad-request', 'timeout-or-duplicate', 'internal-error']);
  try {
    const data = await response.json();
    const candidates = [...(Array.isArray(data['error-codes']) ? data['error-codes'] : []), data.error, data.error?.status,
      ...(data.error?.details || []).map(detail => detail.reason)];
    error.reason = candidates.find(code => allowed.has(code));
  } catch { /* Status alone is enough when the response is not JSON. */ }
  return error;
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
const encode = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));

async function googleToken(env) {
  if (cachedToken && cachedToken.expires > Date.now() + 60000) return cachedToken.value;
  const account = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  })}`;
  const pem = account.private_key.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), c => c.charCodeAt(0)),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${base64url(new Uint8Array(signature))}`,
    }), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw await upstreamError(response);
  const data = await response.json();
  if (!data.access_token) throw new Error('Google token missing');
  cachedToken = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

export default {
  async fetch(request, env) {
    const headers = {
      'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin',
      'Access-Control-Allow-Origin': ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    const reply = (status, message) => new Response(JSON.stringify({ message }), { status, headers });
    if (new URL(request.url).pathname !== '/beta-signup') return reply(404, 'Not found.');
    if (request.headers.get('Origin') !== ORIGIN) return reply(403, 'Origin not allowed.');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, 'Use POST.');
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply(415, 'Send JSON.');

    // Read a bounded body, including requests without a Content-Length header.
    let data;
    try {
      const reader = request.body?.getReader();
      if (!reader) return reply(400, 'Missing form data.');
      let size = 0;
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8192) { await reader.cancel(); return reply(413, 'Form data is too large.'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return reply(400, 'Invalid form data.'); }

    if (!data || typeof data !== 'object') return reply(400, 'Invalid form data.');
    if (data.website) return reply(400, 'Unable to submit this form.');
    const name = typeof data.name === 'string' ? data.name.trim() : '';
    const email = typeof data.email === 'string' ? data.email.trim() : '';
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return reply(400, 'Enter your name (up to 100 characters).');
    if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, 'Enter a valid email address.');
    if (typeof data.token !== 'string' || !data.token || data.token.length > 2048) return reply(400, 'Complete the security check and try again.');

    let stage = 'turnstile';
    try {
      if (typeof env.TURNSTILE_SECRET_KEY !== 'string' || !env.TURNSTILE_SECRET_KEY.trim()) {
        const error = new Error('Missing Turnstile secret');
        error.reason = 'missing-input-secret';
        throw error;
      }
      const verification = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY.trim(), response: data.token }),
        signal: AbortSignal.timeout(10000),
      });
      if (!verification.ok) throw await upstreamError(verification);
      const result = await verification.json();
      if (!result.success || result.hostname !== 'foxprey.com' || result.action !== 'beta_signup') {
        return reply(400, 'Security check expired or failed. Please try again.');
      }
      stage = 'google-auth';
      const token = await googleToken(env);
      stage = 'google-sheets';
      const range = encodeURIComponent("'List'!A:C");
      const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ majorDimension: 'ROWS', values: [[new Date().toISOString(), name, email]] }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw await upstreamError(response);
      return reply(200, "You're on the list. Thanks for your interest!");
    } catch (error) {
      // Keep user data, credentials, and raw exception messages out of logs.
      console.error('beta-signup failed', {
        stage,
        status: error.upstreamStatus || null,
        reason: error.reason || (error.name === 'TimeoutError' ? 'timeout' : 'request-or-configuration-error'),
      });
      return reply(503, 'Unable to confirm your signup right now. Please try again later.');
    }
  },
};
