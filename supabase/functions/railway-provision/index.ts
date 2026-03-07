// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// @ts-ignore
declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const DOCKER_IMAGE = "registry.gitlab.com/galaxykicklock77/galaxykickpipelinewin:v1";
const REGION = "europe-west4-drams3a";
const ENCRYPTION_KEY = Deno.env.get('PAYLOAD_ENCRYPTION_KEY') || '';
let derivedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (derivedKey) return derivedKey;
  if (!ENCRYPTION_KEY) throw new Error('PAYLOAD_ENCRYPTION_KEY not configured');
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(ENCRYPTION_KEY), { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey']);
  derivedKey = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: encoder.encode('gkl-payload-v1'), iterations: 1000, hash: 'SHA-256' }, keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return derivedKey;
}

async function decryptPayload(encrypted: string): Promise<any> {
  const key = await getKey();
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  const decoder = new TextDecoder();
  const decrypted = decoder.decode(plaintext);
  try { return JSON.parse(decrypted); } catch { return { error: decrypted, success: false }; }
}

async function encryptPayload(data: any): Promise<string> {
  const key = await getKey();
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function railwayGQL(token: string, query: string, variables?: Record<string, unknown>) {
  const res = await fetch(RAILWAY_API, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const json = await res.json();
  if (json.errors) throw new Error(json.errors.map((e: { message: string }) => e.message).join(", "));
  return json.data;
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const encryptedBody = await req.text();
    const { railway_account_id, service_name } = await decryptPayload(encryptedBody);
    if (!railway_account_id || !service_name) {
      const errorResponse = await encryptPayload({ success: false, error: "railway_account_id and service_name are required" });
      return new Response(errorResponse, { status: 400, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }
    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_KEY!);
    const { data: account, error: accountError } = await supabase.from('railway_accounts').select('railway_api_token, railway_project_id').eq('id', railway_account_id).single();
    if (accountError || !account) {
      const errorResponse = await encryptPayload({ success: false, error: "Railway account not found" });
      return new Response(errorResponse, { status: 404, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
    }
    const railway_api_token = account.railway_api_token;
    const railway_project_id = account.railway_project_id;
    const projectData = await railwayGQL(railway_api_token, `query($projectId: String!) { project(id: $projectId) { id name environments { edges { node { id name } } } } }`, { projectId: railway_project_id });
    if (!projectData.project) throw new Error("Cannot access Railway project. Check API token and project ID.");
    const envEdge = projectData.project.environments.edges.find((e: { node: { name: string } }) => e.node.name === "production");
    if (!envEdge) throw new Error("Production environment not found in project");
    const environmentId = envEdge.node.id;
    const createData = await railwayGQL(railway_api_token, `mutation($projectId: String!, $name: String!) { serviceCreate(input: { projectId: $projectId, name: $name }) { id name } }`, { projectId: railway_project_id, name: service_name });
    const serviceId = createData.serviceCreate.id;
    const serviceName = createData.serviceCreate.name;
    await railwayGQL(railway_api_token, `mutation($serviceId: String!, $image: String!, $environmentId: String!) { serviceInstanceUpdate(serviceId: $serviceId, environmentId: $environmentId, input: { source: { image: $image } region: "${REGION}" }) }`, { serviceId, image: DOCKER_IMAGE, environmentId });
    const domainData = await railwayGQL(railway_api_token, `mutation($serviceId: String!, $environmentId: String!) { serviceDomainCreate(input: { serviceId: $serviceId, environmentId: $environmentId }) { domain } }`, { serviceId, environmentId });
    const domain = domainData.serviceDomainCreate.domain;
    const backendUrl = `https://${domain}`;
    await railwayGQL(railway_api_token, `mutation($projectId: String!, $serviceId: String!, $environmentId: String!) { variableUpsert(input: { projectId: $projectId, serviceId: $serviceId, environmentId: $environmentId, name: "PORT", value: "3000" }) }`, { projectId: railway_project_id, serviceId, environmentId });
    const responseData = { success: true, service_id: serviceId, service_name: serviceName, backend_url: backendUrl };
    const encryptedResponse = await encryptPayload(responseData);
    return new Response(encryptedResponse, { headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  } catch (error) {
    const errorData = { success: false, error: (error as Error).message };
    const encryptedError = await encryptPayload(errorData);
    return new Response(encryptedError, { status: 500, headers: { ...corsHeaders, "Content-Type": "text/plain" } });
  }
});
