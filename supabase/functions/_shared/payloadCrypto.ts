/**
 * Shared payload encryption/decryption for Supabase Edge Functions.
 * Mirrors the frontend payloadCrypto.js — uses the same PBKDF2-derived AES-GCM key.
 *
 * The shared secret is the Supabase anon key, extracted from the
 * Authorization header sent by the frontend on every request.
 * 
 * IMPORTANT: Falls back to PAYLOAD_ENCRYPTION_KEY environment variable
 * (not SUPABASE_ANON_KEY which is auto-injected but only 46 chars).
 */

// @ts-ignore - Deno is available in Supabase Edge Functions runtime
declare const Deno: any;

const keyCache = new Map<string, CryptoKey>();
let cachedAnonKey = "";

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (keyCache.has(secret)) return keyCache.get(secret)!;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("gkl-payload-v1"),
      iterations: 1000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );

  keyCache.set(secret, key);
  return key;
}

function extractAnonKey(req: Request): string {
  const auth = req.headers.get("authorization") || "";
  if (auth.startsWith("Bearer ")) return auth.substring(7);
  return req.headers.get("apikey") || "";
}

async function decryptWithKey(encrypted: string, key: CryptoKey): Promise<unknown> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext
  );

  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function encryptWithKey(data: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Parse incoming request — decrypts using the anon key from Authorization header.
 * Also caches the anon key for use by encryptedResponse().
 */
export async function parseEncryptedRequest(req: Request): Promise<Record<string, unknown>> {
  const anonKey = extractAnonKey(req);
  if (anonKey) cachedAnonKey = anonKey;

  const contentType = req.headers.get("content-type") || "";

  if (anonKey && contentType.includes("text/plain")) {
    const body = await req.text();
    const key = await deriveKey(anonKey);
    return (await decryptWithKey(body, key)) as Record<string, unknown>;
  }

  return await req.json();
}

/**
 * Create an encrypted response.
 * Uses the anon key cached from parseEncryptedRequest().
 * Falls back to PAYLOAD_ENCRYPTION_KEY (not SUPABASE_ANON_KEY which is only 46 chars).
 */
export async function encryptedResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Promise<Response> {
  const secret = cachedAnonKey || Deno.env.get("PAYLOAD_ENCRYPTION_KEY") || "";

  if (secret) {
    const key = await deriveKey(secret);
    const encrypted = await encryptWithKey(data, key);
    return new Response(encrypted, {
      status,
      headers: { ...headers, "Content-Type": "text/plain" },
    });
  }

  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
