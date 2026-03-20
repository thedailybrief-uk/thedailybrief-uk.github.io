/**
 * Cloudflare Worker — The Daily Brief Push Notifications
 *
 * Endpoints:
 *   POST /subscribe    — Store a push subscription in KV
 *   POST /unsubscribe  — Remove a push subscription from KV
 *   POST /push         — Send push to all subscribers (auth required)
 *   GET  /stats        — Subscriber count (auth required)
 *
 * Secrets (wrangler secret put):
 *   VAPID_PRIVATE_KEY  — Base64url-encoded VAPID private key
 *   PUSH_AUTH_TOKEN    — Bearer token for /push and /stats
 *   VAPID_SUBJECT      — mailto:you@example.com or https://thedailybrief.co.uk
 */

const VAPID_PUBLIC_KEY = 'BJ8KRLYBThmYGP1dcFNbMpWRJSTnZfe0nWu7cQKxxwK8-wESiXKk6OfJhYI28MykLxj5xSzggp8whn_DYaEWAKw';

const CORS_ORIGIN = 'https://thedailybrief.co.uk';

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = origin === CORS_ORIGIN || origin === 'http://localhost:8000' || origin === 'http://127.0.0.1:8000';
  return {
    'Access-Control-Allow-Origin': allowed ? origin : CORS_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (request) Object.assign(headers, corsHeaders(request));
  return new Response(JSON.stringify(data), { status, headers });
}

/** Hash a subscription endpoint to use as KV key */
async function hashEndpoint(endpoint) {
  const data = new TextEncoder().encode(endpoint);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Web Push Crypto (RFC 8291 / RFC 8188) ──

function base64urlToUint8Array(base64url) {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - base64.length % 4) % 4;
  const raw = atob(base64 + '='.repeat(pad));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function uint8ArrayToBase64url(arr) {
  let binary = '';
  for (const byte of arr) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Import the VAPID private key as a CryptoKey for ECDSA signing */
async function importVapidKey(privateKeyBase64url) {
  const rawPrivate = base64urlToUint8Array(privateKeyBase64url);
  const rawPublic = base64urlToUint8Array(VAPID_PUBLIC_KEY);

  // Build JWK from raw keys
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    x: uint8ArrayToBase64url(rawPublic.slice(1, 33)),
    y: uint8ArrayToBase64url(rawPublic.slice(33, 65)),
    d: uint8ArrayToBase64url(rawPrivate),
  };

  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
}

/** Create a signed VAPID Authorization header (RFC 8292) */
async function createVapidAuth(endpoint, vapidPrivateKey, vapidSubject) {
  const url = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12 hours

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: audience, exp: expiry, sub: vapidSubject };

  const headerB64 = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = uint8ArrayToBase64url(new TextEncoder().encode(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  const key = await importVapidKey(vapidPrivateKey);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(unsigned)
  );

  // Convert DER signature to raw r||s format that JWT expects
  const sigBytes = new Uint8Array(signature);
  const token = `${unsigned}.${uint8ArrayToBase64url(sigBytes)}`;

  return {
    authorization: `vapid t=${token}, k=${VAPID_PUBLIC_KEY}`,
  };
}

/** Encrypt push payload using RFC 8291 (aes128gcm) */
async function encryptPayload(subscription, payload) {
  const clientPublicKey = base64urlToUint8Array(subscription.keys.p256dh);
  const authSecret = base64urlToUint8Array(subscription.keys.auth);

  // Generate ephemeral ECDH key pair
  const localKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', localKeyPair.publicKey));

  // Import client public key
  const clientKey = await crypto.subtle.importKey('raw', clientPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  // ECDH shared secret
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: clientKey }, localKeyPair.privateKey, 256));

  // HKDF to derive auth info
  const authInfo = new Uint8Array([
    ...new TextEncoder().encode('WebPush: info\0'),
    ...clientPublicKey,
    ...localPublicRaw,
  ]);

  // Import shared secret for HKDF
  const sharedSecretKey = await crypto.subtle.importKey('raw', sharedSecret, { name: 'HKDF' }, false, ['deriveBits']);

  // PRK = HKDF-Extract(auth_secret, shared_secret)
  const prkKey = await crypto.subtle.importKey('raw', authSecret, { name: 'HKDF' }, false, ['deriveBits']);
  const ikmBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo }, sharedSecretKey, 256);

  const ikm = await crypto.subtle.importKey('raw', new Uint8Array(ikmBits), { name: 'HKDF' }, false, ['deriveBits']);

  // Generate 16-byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Content encryption key
  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cekBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: cekInfo }, ikm, 128);
  const cek = await crypto.subtle.importKey('raw', new Uint8Array(cekBits), { name: 'AES-GCM' }, false, ['encrypt']);

  // Nonce
  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonceBits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info: nonceInfo }, ikm, 96);
  const nonce = new Uint8Array(nonceBits);

  // Pad and encrypt payload
  const payloadBytes = new TextEncoder().encode(payload);
  const paddedPayload = new Uint8Array(payloadBytes.length + 2);
  paddedPayload.set(payloadBytes);
  paddedPayload[payloadBytes.length] = 2; // delimiter
  // remaining bytes are 0 (padding)

  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cek, paddedPayload));

  // Build aes128gcm header: salt (16) + rs (4) + idlen (1) + keyid (65) + ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, payloadBytes.length + 2 + 16 + 1); // record size

  const result = new Uint8Array(16 + 4 + 1 + 65 + encrypted.length);
  result.set(salt, 0);
  result.set(rs, 16);
  result[20] = 65; // key ID length
  result.set(localPublicRaw, 21);
  result.set(encrypted, 86);

  return result;
}

/** Send a single push notification */
async function sendPush(subscription, payload, env) {
  const body = await encryptPayload(subscription, payload);
  const vapid = await createVapidAuth(subscription.endpoint, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);

  const response = await fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      ...vapid,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Urgency': 'high',
    },
    body,
  });

  return response;
}

// ── Route Handlers ──

async function handleSubscribe(request, env) {
  const sub = await request.json();

  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return json({ error: 'Invalid subscription object' }, 400, request);
  }

  const key = await hashEndpoint(sub.endpoint);
  await env.PUSH_SUBS.put(key, JSON.stringify(sub), { expirationTtl: 365 * 24 * 60 * 60 });

  return json({ ok: true, message: 'Subscribed' }, 201, request);
}

async function handleUnsubscribe(request, env) {
  const { endpoint } = await request.json();

  if (!endpoint) {
    return json({ error: 'Missing endpoint' }, 400, request);
  }

  const key = await hashEndpoint(endpoint);
  await env.PUSH_SUBS.delete(key);

  return json({ ok: true, message: 'Unsubscribed' }, 200, request);
}

async function handlePush(request, env) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.PUSH_AUTH_TOKEN}`) {
    return json({ error: 'Unauthorised' }, 401, request);
  }

  const { title, body, url, type } = await request.json();
  if (!title || !body) {
    return json({ error: 'Missing title or body' }, 400, request);
  }

  const payload = JSON.stringify({ title, body, url: url || '/', type: type || 'edition' });

  // Read all subscriptions from KV
  const subs = [];
  let cursor = null;
  do {
    const list = await env.PUSH_SUBS.list({ cursor, limit: 1000 });
    for (const key of list.keys) {
      const raw = await env.PUSH_SUBS.get(key.name);
      if (raw) {
        try { subs.push(JSON.parse(raw)); } catch {}
      }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  let sent = 0;
  let failed = 0;
  const staleKeys = [];

  await Promise.allSettled(subs.map(async (sub) => {
    try {
      const res = await sendPush(sub, payload, env);
      if (res.status === 201 || res.status === 200) {
        sent++;
      } else if (res.status === 404 || res.status === 410) {
        // Subscription expired — clean up
        const key = await hashEndpoint(sub.endpoint);
        staleKeys.push(key);
        failed++;
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }));

  // Remove stale subscriptions
  await Promise.allSettled(staleKeys.map(key => env.PUSH_SUBS.delete(key)));

  return json({ ok: true, sent, failed, cleaned: staleKeys.length, total: subs.length }, 200, request);
}

async function handleStats(request, env) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.PUSH_AUTH_TOKEN}`) {
    return json({ error: 'Unauthorised' }, 401, request);
  }

  let count = 0;
  let cursor = null;
  do {
    const list = await env.PUSH_SUBS.list({ cursor, limit: 1000 });
    count += list.keys.length;
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  return json({ subscribers: count }, 200, request);
}

/** Return all subscriptions (auth required) — used by CLI push script */
async function handleSubscriptions(request, env) {
  const auth = request.headers.get('Authorization');
  if (auth !== `Bearer ${env.PUSH_AUTH_TOKEN}`) {
    return json({ error: 'Unauthorised' }, 401, request);
  }

  const subs = [];
  let cursor = null;
  do {
    const list = await env.PUSH_SUBS.list({ cursor, limit: 1000 });
    for (const key of list.keys) {
      const raw = await env.PUSH_SUBS.get(key.name);
      if (raw) {
        try { subs.push(JSON.parse(raw)); } catch {}
      }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);

  return json({ subscriptions: subs }, 200, request);
}

// ── Main ──

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/subscribe') {
      return handleSubscribe(request, env);
    }
    if (request.method === 'POST' && path === '/unsubscribe') {
      return handleUnsubscribe(request, env);
    }
    if (request.method === 'POST' && path === '/push') {
      return handlePush(request, env);
    }
    if (request.method === 'GET' && path === '/stats') {
      return handleStats(request, env);
    }
    if (request.method === 'GET' && path === '/subscriptions') {
      return handleSubscriptions(request, env);
    }

    return json({ error: 'Not found' }, 404, request);
  },
};
