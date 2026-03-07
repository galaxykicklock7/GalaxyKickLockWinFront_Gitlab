// Supabase Edge Function: railway-delete
// Deletes a Railway service when a token is deleted
//
// POST body: { "railway_api_token", "railway_project_id", "service_id" }

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { railway_api_token, railway_project_id, service_id } = await req.json();

    if (!railway_api_token || !service_id) {
      return new Response(
        JSON.stringify({ success: false, error: "railway_api_token and service_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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
