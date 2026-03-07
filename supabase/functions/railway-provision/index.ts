// Supabase Edge Function: railway-provision
// Creates a new Railway service with Docker image for a token
//
// POST body: { "railway_api_token", "railway_project_id", "service_name" }
// Returns: { success, service_id, backend_url }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RAILWAY_API = "https://backboard.railway.com/graphql/v2";
const DOCKER_IMAGE = "registry.gitlab.com/galaxykicklock77/galaxykickpipelinewin:v1";
const REGION = "europe-west4-drams3a";

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
    const { railway_api_token, railway_project_id, service_name } = await req.json();

    if (!railway_api_token || !railway_project_id || !service_name) {
      return new Response(
        JSON.stringify({ success: false, error: "railway_api_token, railway_project_id, and service_name are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Verify token + project access
    const projectData = await railwayGQL(railway_api_token, `
      query($projectId: String!) {
        project(id: $projectId) {
          id
          name
          environments {
            edges {
              node { id name }
            }
          }
        }
      }
    `, { projectId: railway_project_id });

    if (!projectData.project) {
      throw new Error("Cannot access Railway project. Check API token and project ID.");
    }

    const envEdge = projectData.project.environments.edges.find(
      (e: { node: { name: string } }) => e.node.name === "production"
    );
    if (!envEdge) {
      throw new Error("Production environment not found in project");
    }
    const environmentId = envEdge.node.id;

    // Step 2: Create service
    const createData = await railwayGQL(railway_api_token, `
      mutation($projectId: String!, $name: String!) {
        serviceCreate(input: {
          projectId: $projectId,
          name: $name
        }) {
          id
          name
        }
      }
    `, { projectId: railway_project_id, name: service_name });

    const serviceId = createData.serviceCreate.id;
    const serviceName = createData.serviceCreate.name;

    // Step 3: Set Docker image source on the service
    await railwayGQL(railway_api_token, `
      mutation($serviceId: String!, $image: String!, $environmentId: String!) {
        serviceInstanceUpdate(
          serviceId: $serviceId,
          environmentId: $environmentId,
          input: {
            source: { image: $image }
            region: "${REGION}"
          }
        )
      }
    `, { serviceId, image: DOCKER_IMAGE, environmentId });

    // Step 4: Generate a public domain for the service
    const domainData = await railwayGQL(railway_api_token, `
      mutation($serviceId: String!, $environmentId: String!) {
        serviceDomainCreate(input: {
          serviceId: $serviceId,
          environmentId: $environmentId
        }) {
          domain
        }
      }
    `, { serviceId, environmentId });

    const domain = domainData.serviceDomainCreate.domain;
    const backendUrl = `https://${domain}`;

    // Step 5: Set PORT environment variable
    await railwayGQL(railway_api_token, `
      mutation($projectId: String!, $serviceId: String!, $environmentId: String!) {
        variableUpsert(input: {
          projectId: $projectId,
          serviceId: $serviceId,
          environmentId: $environmentId,
          name: "PORT",
          value: "3000"
        })
      }
    `, { projectId: railway_project_id, serviceId, environmentId });

    return new Response(
      JSON.stringify({
        success: true,
        service_id: serviceId,
        service_name: serviceName,
        backend_url: backendUrl,
        region: REGION,
        docker_image: DOCKER_IMAGE,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: (error as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
