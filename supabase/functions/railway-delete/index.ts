// Supabase Edge Function: railway-delete
// Deletes a Railway service when a token is deleted
//
// POST body: { "railway_account_id", "service_id" }
// Fetches credentials from railway_accounts table server-side

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";

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

async function getAccountCredentials(accountId: string) {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Missing Supabase configuration");
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await supabase
    .from("railway_accounts")
    .select("railway_api_token, railway_project_id")
    .eq("id", accountId)
    .single();
  if (error || !data) {
    throw new Error("Railway account not found");
  }
  return { token: data.railway_api_token, projectId: data.railway_project_id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { railway_account_id, service_id } = await req.json();

    if (!railway_account_id || !service_id) {
      return new Response(
        JSON.stringify({ success: false, error: "railway_account_id and service_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch credentials server-side from DB
    const { token: railway_api_token } = await getAccountCredentials(railway_account_id);

    // Delete the service from Railway
    await railwayGQL(railway_api_token, `
      mutation($serviceId: String!) {
        serviceDelete(id: $serviceId)
      }
    `, { serviceId: service_id });

    return new Response(
      JSON.stringify({ success: true, deleted_service_id: service_id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
