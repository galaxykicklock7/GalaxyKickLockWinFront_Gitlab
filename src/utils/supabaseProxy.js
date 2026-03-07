/**
 * Supabase Proxy Wrapper
 * 
 * Wraps Supabase client to route all requests through proxy,
 * hiding Supabase URLs from the browser's network tab.
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Custom fetch function that routes through proxy
 */
const proxyFetch = async (url, options = {}) => {
  // Extract the path from the Supabase URL
  const supabaseUrl = new URL(SUPABASE_URL);
  const requestUrl = new URL(url);
  
  // Build the path (everything after the domain)
  const path = requestUrl.pathname + requestUrl.search;
  
  // Encode Supabase URL and path
  const encodedTarget = btoa(SUPABASE_URL);
  const encodedPath = encodeURIComponent(path);
  
  // Route through our proxy
  const proxyUrl = `/api/supabase-proxy?path=${encodedPath}`;
  
  // Add proxy headers
  const proxyHeaders = {
    ...options.headers,
    'X-Supabase-Target': encodedTarget,
    'X-Supabase-Key': SUPABASE_ANON_KEY,
    'X-Proxy-Request': 'true'
  };
  
  // Make proxied request
  return fetch(proxyUrl, {
    ...options,
    headers: proxyHeaders
  });
};

/**
 * Create Supabase client with custom fetch
 */
export const createProxiedSupabaseClient = () => {
  // In production, use proxy
  if (!import.meta.env.DEV) {
    return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: {
        fetch: proxyFetch
      }
    });
  }
  
  // In development, use direct connection for easier debugging
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
};

export default createProxiedSupabaseClient;
