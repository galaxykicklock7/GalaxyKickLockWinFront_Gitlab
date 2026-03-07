// Supabase Edge Function: railway-deploy
// Redeploys a user's Railway service and updates Supabase status
//
// POST body: ENCRYPTED { "user_id": "bharanitest" }
// Required secrets: RAILWAY_API_TOKEN, RAILWAY_PROJECT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PAYLOAD_ENCRYPTION_KEY

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
    const RAILWAY_TOKEN = Deno.env.get("RAILWAY_API_TOKEN");
    const RAILWAY_PROJECT_ID = Deno.env.get("RAILWAY_PROJECT_ID");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!RAILWAY_TOKEN || !RAILWAY_PROJECT_ID) {
      throw new Error("Missing Railway configuration");
    }

    // DECRYPT the request body
    const encryptedBody = await req.text();
    const { user_id } = await decryptPayload(encryptedBody);

    if (!user_id) {
      const errorResponse = await encryptPayload({
        success: false,
        error: "user_id is required"
      });
      return new Response(errorResponse, {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }

    // Step 1: Look up user's railway_service_id from Supabase
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    
    const { data: deployment, error: dbError } = await supabase
      .from("user_deployments")
      .select("railway_service_id, backend_url")
      .eq("user_id", user_id)
      .single();

    if (dbError || !deployment?.railway_service_id) {
      const errorResponse = await encryptPayload({
        success: false,
        error: "No Railway service found for this user. Contact admin."
      });
      return new Response(errorResponse, {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "text/plain" }
      });
    }

    const serviceId = deployment.railway_service_id;
    const backendUrl = deployment.backend_url;

    // Step 2: Get environment ID (production)
    const projectData = await railwayGQL(
      RAILWAY_TOKEN,
      `query($projectId: String!) {
        project(id: $projectId) {
          environments {
            edges {
              node { id name }
            }
          }
        }
      }`,
      { projectId: RAILWAY_PROJECT_ID }
    );

    const envEdge = projectData.project.environments.edges.find(
      (e: { node: { name: string } }) => e.node.name === "production"
    );

    if (!envEdge) {
      throw new Error("Production environment not found");
    }

    const environmentId = envEdge.node.id;

    // Step 3: Get latest deployment for the service
    const deployData = await railwayGQL(
      RAILWAY_TOKEN,
      `query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        deployments(input: {
          projectId: $projectId,
          serviceId: $serviceId,
          environmentId: $environmentId
        }, first: 1) {
          edges {
            node { id status }
          }
        }
      }`,
      { projectId: RAILWAY_PROJECT_ID, serviceId, environmentId }
    );

    const latestDeploy = deployData.deployments.edges[0]?.node;

    // Step 4: Redeploy
    if (latestDeploy) {
      await railwayGQL(
        RAILWAY_TOKEN,
        `mutation($deploymentId: String!) {
          deploymentRedeploy(id: $deploymentId) { id status }
        }`,
        { deploymentId: latestDeploy.id }
      );
    } else {
      await railwayGQL(
        RAILWAY_TOKEN,
        `mutation($serviceId: String!, $environmentId: String!) {
          serviceInstanceRedeploy(serviceId: $serviceId, environmentId: $environmentId)
        }`,
        { serviceId, environmentId }
      );
    }

    // Step 5: Update Supabase status to active
    await supabase
      .from("user_deployments")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("user_id", user_id);

    // Step 6: Health check
    let healthOk = false;
    if (backendUrl) {
      for (let i = 0; i < 30; i++) {
        try {
          const healthRes = await fetch(`${backendUrl}/api/health`, {
            method: "GET",
            signal: AbortSignal.timeout(8000),
          });
          
          if (healthRes.ok) {
            healthOk = true;
            break;
          }
        } catch {
          // Not ready yet
        }
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    // ENCRYPT the response
    const responseData = {
      success: true,
      backend_url: backendUrl,
      health: healthOk,
      service_id: serviceId,
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
