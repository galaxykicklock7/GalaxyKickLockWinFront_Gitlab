/**
 * Supabase Proxy Function
 * 
 * Routes all Supabase requests through this proxy to hide
 * Supabase URLs from the browser's network tab.
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Supabase-Target, X-Supabase-Key, X-Proxy-Request, apikey, authorization, x-client-info');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Get Supabase URL from header
    const encodedTarget = req.headers['x-supabase-target'];
    if (!encodedTarget) {
      return res.status(400).json({ error: 'Missing Supabase target' });
    }

    // Get Supabase API key
    const supabaseKey = req.headers['x-supabase-key'];
    if (!supabaseKey) {
      return res.status(400).json({ error: 'Missing Supabase key' });
    }

    // Get path from query
    const path = req.query.path;
    if (!path) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    // Decode Supabase URL
    let supabaseUrl;
    try {
      supabaseUrl = Buffer.from(encodedTarget, 'base64').toString('utf8');
    } catch (error) {
      return res.status(400).json({ error: 'Invalid target encoding' });
    }

    // Build target URL
    const targetUrl = `${supabaseUrl}${decodeURIComponent(path)}`;

    // Forward headers (excluding proxy-specific ones)
    const forwardHeaders = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'apikey': supabaseKey,
      'Authorization': req.headers['authorization'] || `Bearer ${supabaseKey}`,
      'x-client-info': req.headers['x-client-info'] || 'supabase-js/2.0.0'
    };

    // Prepare fetch options
    const fetchOptions = {
      method: req.method,
      headers: forwardHeaders
    };

    // Add body for non-GET requests
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    // Make request to Supabase
    const response = await fetch(targetUrl, fetchOptions);
    
    // Get response data
    const contentType = response.headers.get('content-type');
    let data;
    
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    // Forward response headers
    const responseHeaders = {};
    response.headers.forEach((value, key) => {
      // Forward important headers
      if (['content-type', 'cache-control', 'etag'].includes(key.toLowerCase())) {
        responseHeaders[key] = value;
      }
    });

    // Set response headers
    Object.entries(responseHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    // Return response
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('Supabase proxy error:', error.message);
    return res.status(500).json({ 
      error: 'Service temporarily unavailable',
      code: 'PROXY_ERROR'
    });
  }
}
