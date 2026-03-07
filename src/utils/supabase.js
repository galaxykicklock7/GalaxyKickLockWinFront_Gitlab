import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// NOTE: Supabase proxy is disabled because Vercel doesn't support serverless functions
// in this project configuration. Supabase URLs will be visible in network tab.
// This is acceptable because:
// 1. Supabase URLs are meant to be public (they use API keys for security)
// 2. The anon key is rate-limited and has RLS (Row Level Security) policies
// 3. Sensitive data is protected by backend logic, not URL hiding

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  }
});




