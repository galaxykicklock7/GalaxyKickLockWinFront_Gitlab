/**
 * Netlify Supabase Proxy Function
 * 
 * Routes all Supabase requests through this proxy to hide
 * Supabase URLs from the browser's network tab.
 */

exports.handler = async function(event, context) {
  // Handle CORS
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Supabase-Target, X-Supabase-Key, X-Proxy-Request, apikey, authorization, x-client-info',
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

  try {
    // Get Supabase URL from header
    const encodedTarget = event.headers['x-supabase-target'];
    if (!encodedTarget) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing Supabase target' })
      };
    }

    // Get Supabase API key
    const supabaseKey = event.headers['x-supabase-key'];
    if (!supabaseKey) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing Supabase key' })
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

    // Decode Supabase URL
    let supabaseUrl;
    try {
      supabaseUrl = Buffer.from(encodedTarget, 'base64').toString('utf8');
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid target encoding' })
      };
    }

    // Build target URL
    const targetUrl = `${supabaseUrl}${decodeURIComponent(path)}`;

    // Forward headers
    const forwardHeaders = {
      'Content-Type': event.headers['content-type'] || 'application/json',
      'apikey': supabaseKey,
      'Authorization': event.headers['authorization'] || `Bearer ${supabaseKey}`,
      'x-client-info': event.headers['x-client-info'] || 'supabase-js/2.0.0'
    };

    // Prepare fetch options
    const fetchOptions = {
      method: event.httpMethod,
      headers: forwardHeaders
    };

    // Add body for non-GET requests
    if (event.httpMethod !== 'GET' && event.httpMethod !== 'HEAD' && event.body) {
      fetchOptions.body = event.body;
    }

    // Make request to Supabase
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.text();

    // Forward response
    return {
      statusCode: response.status,
      headers: {
        ...headers,
        'Content-Type': response.headers.get('content-type') || 'application/json'
      },
      body: data
    };

  } catch (error) {
    console.error('Supabase proxy error:', error.message);
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
