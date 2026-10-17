import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './index.mjs';

const endpoint = 'https://website-api.foxpreygames.workers.dev/beta-signup';
const valid = { name: 'Player', email: 'player@example.com', token: 'test', website: '' };
const request = (data = valid, origin = 'https://foxprey.com') => new Request(endpoint, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
});

test('invalid requests never reach external services', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Unexpected external request'); };
  try {
    assert.equal((await worker.fetch(request(valid, 'https://other.example'), {})).status, 403);
    assert.equal((await worker.fetch(request({ ...valid, name: '' }), {})).status, 400);
    assert.equal((await worker.fetch(request({ ...valid, email: 'invalid' }), {})).status, 400);
    assert.equal((await worker.fetch(request({ ...valid, token: '' }), {})).status, 400);
    assert.equal((await worker.fetch(request({ ...valid, website: 'spam' }), {})).status, 400);
    assert.equal((await worker.fetch(request({ ...valid, name: 'a'.repeat(9000) }), {})).status, 413);
    const preflight = new Request(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://foxprey.com' } });
    assert.equal((await worker.fetch(preflight, {})).status, 204);
  } finally { globalThis.fetch = original; }
});

test('Turnstile checks success, hostname and action before accessing Google', async () => {
  const original = globalThis.fetch;
  try {
    for (const result of [
      { success: false },
      { success: true, hostname: 'other.example', action: 'beta_signup' },
      { success: true, hostname: 'foxprey.com', action: 'other' },
    ]) {
      let calls = 0;
      globalThis.fetch = async (url) => {
        calls++;
        assert.match(url, /turnstile/);
        return Response.json(result);
      };
      assert.equal((await worker.fetch(request(), { TURNSTILE_SECRET_KEY: 'test' })).status, 400);
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = original; }
});

test('verified signup signs JWT and appends Added, Name, Email as raw values', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pem = Buffer.from(await crypto.subtle.exportKey('pkcs8', keys.privateKey)).toString('base64');
  const env = { TURNSTILE_SECRET_KEY: 'test', GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    client_email: 'test@example.com', private_key: `-----BEGIN PRIVATE KEY-----\n${pem}\n-----END PRIVATE KEY-----`,
  }) };
  const original = globalThis.fetch;
  let writes = 0;
  let failSheet = false;
  globalThis.fetch = async (url, options) => {
    if (url.includes('turnstile')) return Response.json({ success: true, hostname: 'foxprey.com', action: 'beta_signup' });
    if (url.includes('oauth2')) {
      const [header, payload, signature] = options.body.get('assertion').split('.');
      assert.equal(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', keys.publicKey,
        Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${payload}`)), true);
      assert.equal(JSON.parse(Buffer.from(payload, 'base64url')).iss, 'test@example.com');
      return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
    }
    assert.match(url, /valueInputOption=RAW/);
    assert.match(decodeURIComponent(url), /'List'!A:C/);
    const [added, name, email] = JSON.parse(options.body).values[0];
    assert.ok(!Number.isNaN(Date.parse(added)));
    assert.equal(name, '=Example');
    assert.equal(email, 'player@example.com');
    writes++;
    return new Response('{}', { status: failSheet ? 403 : 200 });
  };
  try {
    const data = { ...valid, name: ' =Example ' };
    assert.equal((await worker.fetch(request(data), env)).status, 200);
    assert.equal(writes, 1);
    failSheet = true;
    assert.equal((await worker.fetch(request(data), env)).status, 503);
    assert.equal(writes, 2); // No automatic append retries.
  } finally { globalThis.fetch = original; }
});

test('Turnstile HTTP errors retain only safe diagnostic codes', async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  globalThis.fetch = async (url, options) => {
    assert.match(url, /turnstile/);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.deepEqual(JSON.parse(options.body), { secret: 'test-secret', response: 'test' });
    return Response.json({ success: false, 'error-codes': ['invalid-input-secret'], private: 'do-not-log' }, { status: 400 });
  };
  try {
    assert.equal((await worker.fetch(request(), { TURNSTILE_SECRET_KEY: ' test-secret ' })).status, 503);
    assert.equal(logs[0][1].stage, 'turnstile');
    assert.equal(logs[0][1].reason, 'invalid-input-secret');
    assert.equal(logs[0][1].status, 400);
    assert.ok(!JSON.stringify(logs).includes('do-not-log'));
    assert.equal((await worker.fetch(request(), {})).status, 503);
    assert.equal(logs[1][1].reason, 'missing-input-secret');
  } finally { globalThis.fetch = originalFetch; console.error = originalError; }
});
