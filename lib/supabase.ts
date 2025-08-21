import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from './env-config.ts';

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!supabaseInstance) {
    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
}

// Create a proxy that initializes on first access for backward compatibility
// This works for both frontend (immediate) and backend (deferred)
export const supabase = new Proxy({} as ReturnType<typeof createClient>, {
  get(target, prop) {
    const instance = getSupabase();
    return instance[prop as keyof typeof instance];
  },
  has(target, prop) {
    const instance = getSupabase();
    return prop in instance;
  }
});

