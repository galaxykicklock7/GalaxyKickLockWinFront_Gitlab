/**
 * Vercel Serverless Proxy Function
 * 
 * This function acts as a proxy to hide the actual backend URL from the client.
 * The backend URL is base64 encoded in the request header.
 */

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Target-Endpoint, X-Proxy-Request');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST and GET
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get base64 encoded backend URL from header
    const encodedUrl = req.headers['x-target-endpoint'];
    if (!encodedUrl) {
      return res.status(400).json({ error: 'Missing target endpoint' });
    }

    // Get path from query
    const path = req.query.path;
    if (!path) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    // Decode backend URL (simple base64)
    let backendUrl;
    try {
      backendUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
    } catch (error) {
      return res.status(400).json({ error: 'Invalid endpoint encoding' });
    }

    // Validate URL
    try {
      new URL(backendUrl);
    } catch {
      return res.status(400).json({ error: 'Invalid endpoint format' });
    }

    // Build target URL
    const targetUrl = `${backendUrl}${decodeURIComponent(path)}`;

    // Forward the request
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': req.headers['user-agent'] || 'Proxy-Client'
      }
    };

    // Add body for POST requests
    if (req.method === 'POST' && req.body) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    // Make request to backend
    const response = await fetch(targetUrl, fetchOptions);
    const data = await response.json();

    // Forward response
    return res.status(response.status).json(data);

  } catch (error) {
    console.error('Proxy error:', error.message);
    return res.status(500).json({ 
      error: 'Service temporarily unavailable',
      code: 'PROXY_ERROR'
    });
  }
}
