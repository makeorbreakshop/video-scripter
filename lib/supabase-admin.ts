/**
 * Supabase Admin Client
 * 
 * This file provides a Supabase client initialized with the service role key,
 * which has elevated permissions for server-side operations.
 * 
 * IMPORTANT: Only use this client in server-side code (API routes, server components, etc.)
 * Never expose the service role key to the client.
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceKey } from './env-config';

const supabaseUrl = getSupabaseUrl();
const supabaseServiceKey = getSupabaseServiceKey();

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Supabase URL or Service Role Key is missing. Check your environment variables.');
}

export const supabaseAdmin = createClient(
  supabaseUrl,
  supabaseServiceKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);

/**
 * Creates a fresh Supabase admin client
 * Useful when you need a client with specific settings or in environments
 * where the singleton pattern might not be ideal
 */
export function createAdminClient() {
  return createClient(
    supabaseUrl,
    supabaseServiceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    }
  );
} 