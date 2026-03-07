// Supabase Edge Function: railway-delete
// Deletes a Railway service when a token is deleted
//
// POST body: ENCRYPTED { "railway_account_id", "service_id" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

// ============ ENCRYPTION/DECRYPTION ============
const ENCRYPTION_KEY = Deno.env.get('PAYLOAD_ENCRYPTION_KEY') || '';
let derivedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (derivedKey) return derivedKey;

  if (!ENCRYPTION_KEY) {
    throw new Error('PAYLOAD_ENCRYPTION_KEY not configured');
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(ENCRYPTION_KEY),
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

async function decryptPayload(encrypted: string): Promise<any> {
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

  try {
    return JSON.parse(decrypted);
  } catch {
    return { error: decrypted, success: false };
  }
}

async function encryptPayload(data: any): Promise<string> {
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
// ============ END ENCRYPTION ============

async function railwayGQL(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(RAILWAY_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join(", "));
  }

  return json.data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    // DECRYPT the request body
    const encryptedBody = await req.text();
    const { railway_account_id, service_id } = await decryptPayload(encryptedBody);

    if (!railway_account_id || !service_id) {
      const errorResponse = await encryptPayload({
        success: false,
        error: "railway_account_id and service_id are required"
      });
      return new Response(errorResponse, {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }

    // Get Railway credentials from railway_accounts table
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const { data: account, error: accountError } = await supabase
      .from('railway_accounts')
      .select('railway_api_token, railway_project_id')
      .eq('id', railway_account_id)
      .single();

    if (accountError || !account) {
      const errorResponse = await encryptPayload({
        success: false,
        error: "Railway account not found"
      });
      return new Response(errorResponse, {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }

    // Delete the service from Railway
    await railwayGQL(
      account.railway_api_token,
      `mutation($serviceId: String!) {
        serviceDelete(id: $serviceId)
      }`,
      { serviceId: service_id }
    );

    // ENCRYPT the response
    const responseData = {
      success: true,
      deleted_service_id: service_id
    };

    const encryptedResponse = await encryptPayload(responseData);

    return new Response(encryptedResponse, {
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });

  } catch (error) {
    // ENCRYPT error responses too
    const errorData = { success: false, error: (error as Error).message };
    const encryptedError = await encryptPayload(errorData);

    return new Response(encryptedError, {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "text/plain" }
    });
  }
});
