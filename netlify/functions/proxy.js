/**
 * Netlify Serverless Proxy Function
 * 
 * This function acts as a proxy to hide the actual backend URL from the client.
 * The backend URL is base64 encoded in the request header.
 */

exports.handler = async function(event, context) {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Target-Endpoint, X-Proxy-Request',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  // Only allow POST and GET
  if (!['GET', 'POST'].includes(event.httpMethod)) {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Get base64 encoded backend URL from header
    const encodedUrl = event.headers['x-target-endpoint'];
    if (!encodedUrl) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing target endpoint' })
      };
    }

    // Get path from query
    const path = event.queryStringParameters?.path;
    if (!path) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing path parameter' })
      };
    }

    // Decode backend URL (simple base64)
    let backendUrl;
    try {
      backendUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid endpoint encoding' })
      };
    }

    // Validate URL
    try {
      new URL(backendUrl);
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid endpoint format' })
      };
    }

    // Build target URL
    const targetUrl = `${backendUrl}${decodeURIComponent(path)}`;

    // Forward the request
    const fetchOptions = {
      method: event.httpMethod,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': event.headers['user-agent'] || 'Proxy-Client'
      }
    };

    // Add body for POST requests
    if (event.httpMethod === 'POST' && event.body) {
      fetchOptions.body = event.body;
    }

    // Make request to backend
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();

    // Forward response
    return {
      statusCode: response.status,
      headers,
      body: data
    };

  } catch (error) {
    console.error('Proxy error:', error.message);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Service temporarily unavailable',
        code: 'PROXY_ERROR'
      })
    };
  }
};
