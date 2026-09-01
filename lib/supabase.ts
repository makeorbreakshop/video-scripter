import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey, getSupabaseServiceKey } from './env-config.ts';

let supabaseInstance: ReturnType<typeof createClient> | null = null;

export function getSupabase() {
  if (!supabaseInstance) {
    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = typeof window === 'undefined' ? getSupabaseServiceKey() : getSupabaseAnonKey();
    if (!supabaseKey) throw new Error('Missing Supabase key for the current runtime');
    supabaseInstance = createClient(supabaseUrl, supabaseKey);
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
