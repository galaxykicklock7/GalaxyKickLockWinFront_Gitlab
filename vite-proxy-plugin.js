/**
 * Vite Plugin for Development Proxy
 * 
 * This plugin adds proxy endpoints during development to simulate
 * the production proxy behavior for testing.
 */

export default function viteProxyPlugin() {
  return {
    name: 'vite-proxy-plugin',
    configureServer(server) {
      // Backend proxy
      server.middlewares.use('/api/proxy', async (req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Target-Endpoint, X-Proxy-Request');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        if (!['GET', 'POST'].includes(req.method)) {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        try {
          const encodedUrl = req.headers['x-target-endpoint'];
          if (!encodedUrl) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing target endpoint' }));
            return;
          }

          const url = new URL(req.url, `http://${req.headers.host}`);
          const path = url.searchParams.get('path');
          if (!path) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing path parameter' }));
            return;
          }

          // Decode backend URL (simple base64)
          let backendUrl;
          try {
            backendUrl = Buffer.from(encodedUrl, 'base64').toString('utf8');
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid endpoint encoding' }));
            return;
          }

          const targetUrl = `${backendUrl}${decodeURIComponent(path)}`;

          let body = '';
          if (req.method === 'POST') {
            await new Promise((resolve) => {
              req.on('data', chunk => { body += chunk; });
              req.on('end', resolve);
            });
          }

          const fetchOptions = {
            method: req.method,
            headers: {
              'Content-Type': 'application/json',
              'User-Agent': req.headers['user-agent'] || 'Proxy-Client'
            }
          };

          if (body) {
            fetchOptions.body = body;
          }

          const response = await fetch(targetUrl, fetchOptions);
          const data = await response.text();

          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(data);

        } catch (error) {
          console.error('Proxy error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ 
            error: 'Service temporarily unavailable',
            code: 'PROXY_ERROR'
          }));
        }
      });

      // Supabase proxy
      server.middlewares.use('/api/supabase-proxy', async (req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Supabase-Target, X-Supabase-Key, X-Proxy-Request, apikey, authorization, x-client-info');

        if (req.method === 'OPTIONS') {
          res.statusCode = 200;
          res.end();
          return;
        }

        try {
          const encodedTarget = req.headers['x-supabase-target'];
          if (!encodedTarget) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing Supabase target' }));
            return;
          }

          const supabaseKey = req.headers['x-supabase-key'];
          if (!supabaseKey) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing Supabase key' }));
            return;
          }

          const url = new URL(req.url, `http://${req.headers.host}`);
          const path = url.searchParams.get('path');
          if (!path) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing path parameter' }));
            return;
          }

          let supabaseUrl;
          try {
            supabaseUrl = Buffer.from(encodedTarget, 'base64').toString('utf8');
          } catch (error) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Invalid target encoding' }));
            return;
          }

          const targetUrl = `${supabaseUrl}${decodeURIComponent(path)}`;

          let body = '';
          if (!['GET', 'HEAD'].includes(req.method)) {
            await new Promise((resolve) => {
              req.on('data', chunk => { body += chunk; });
              req.on('end', resolve);
            });
          }

          const forwardHeaders = {
            'Content-Type': req.headers['content-type'] || 'application/json',
            'apikey': supabaseKey,
            'Authorization': req.headers['authorization'] || `Bearer ${supabaseKey}`,
            'x-client-info': req.headers['x-client-info'] || 'supabase-js/2.0.0'
          };

          const fetchOptions = {
            method: req.method,
            headers: forwardHeaders
          };

          if (body) {
            fetchOptions.body = body;
          }

          const response = await fetch(targetUrl, fetchOptions);
          const data = await response.text();

          res.statusCode = response.status;
          res.setHeader('Content-Type', response.headers.get('content-type') || 'application/json');
          res.end(data);

        } catch (error) {
          console.error('Supabase proxy error:', error);
          res.statusCode = 500;
          res.end(JSON.stringify({ 
            error: 'Service temporarily unavailable',
            code: 'PROXY_ERROR'
          }));
        }
      });
    }
  };
}
