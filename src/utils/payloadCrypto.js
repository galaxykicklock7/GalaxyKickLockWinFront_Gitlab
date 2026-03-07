/**
 * Payload Crypto
 *
 * Encrypts/decrypts API payloads so that request/response bodies
 * appear as opaque ciphertext in the browser Network tab.
 * Uses AES-GCM with a key derived from the Supabase anon key
 * (shared secret known to both frontend and edge functions).
 */

const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let derivedKey = null;

async function getKey() {
  if (derivedKey) return derivedKey;

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ANON_KEY),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('gkl-payload-v1'),
      iterations: 1000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return derivedKey;
}

/**
 * Encrypt a JSON payload → base64 string
 */
export async function encryptPayload(data) {
  const key = await getKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(data));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64 string → JSON object
 * Returns the decrypted string if it's not valid JSON
 */
export async function decryptPayload(encrypted) {
  const key = await getKey();
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  const decrypted = decoder.decode(plaintext);
  
  // Try to parse as JSON, but return raw string if it fails
  try {
    return JSON.parse(decrypted);
  } catch {
    // If not JSON, return as plain object with the string
    return { error: decrypted, success: false };
  }
}
