// Supabase Edge Function: railway-status
// Queries Railway GraphQL for live deployment status of a service
//
// POST body: { "railway_account_id", "service_id" }
// Fetches credentials from railway_accounts table server-side
// Returns: { success, status: "online" | "stopped" | "crashed" | "deploying" | "removed" }

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

function mapRailwayStatus(deploymentStatus: string | null): string {
  if (!deploymentStatus) return "stopped";

  switch (deploymentStatus.toUpperCase()) {
    case "SUCCESS":
      return "online";
    case "DEPLOYING":
    case "BUILDING":
    case "INITIALIZING":
    case "WAITING":
      return "deploying";
    case "CRASHED":
    case "FAILED":
      return "crashed";
    case "SLEEPING":
    case "REMOVED":
    case "REMOVING":
      return "stopped";
    default:
      return "stopped";
  }
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
    const { token: railway_api_token, projectId: railway_project_id } = await getAccountCredentials(railway_account_id);

    // Get the production environment ID
    const projectData = await railwayGQL(railway_api_token, `
      query($projectId: String!) {
        project(id: $projectId) {
          environments {
            edges {
              node { id name }
            }
          }
        }
      }
    `, { projectId: railway_project_id });

    if (!projectData.project) {
      throw new Error("Cannot access Railway project");
    }

    const envEdge = projectData.project.environments.edges.find(
      (e: { node: { name: string } }) => e.node.name === "production"
    );
    if (!envEdge) {
      throw new Error("Production environment not found");
    }
    const environmentId = envEdge.node.id;

    // Query latest deployment for this service
    const deployData = await railwayGQL(railway_api_token, `
      query($projectId: String!, $serviceId: String!, $environmentId: String!) {
        deployments(
          first: 1
          input: {
            projectId: $projectId
            serviceId: $serviceId
            environmentId: $environmentId
          }
        ) {
          edges {
            node {
              id
              status
            }
          }
        }
      }
    `, { projectId: railway_project_id, serviceId: service_id, environmentId });

    const latestDeploy = deployData.deployments?.edges?.[0]?.node;
    const status = mapRailwayStatus(latestDeploy?.status || null);

    return new Response(
      JSON.stringify({ success: true, status }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
