"use client"

import type React from "react"

import { createContext, useContext, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase"

type AuthContextType = {
  user: User | null
  session: Session | null
  isLoading: boolean
  signOut: () => Promise<void>
}

// Create a dummy user for automatic authentication
// This ID MUST be a valid UUID format for Postgres compatibility
const dummyUser: User = {
  id: "00000000-0000-0000-0000-000000000000", // Using a valid UUID format
  app_metadata: {},
  user_metadata: {},
  aud: "authenticated",
  created_at: new Date().toISOString(),
  confirmed_at: new Date().toISOString(),
  last_sign_in_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  email: "auto@example.com",
  phone: "",
  role: "authenticated",
  email_confirmed_at: new Date().toISOString(),
  phone_confirmed_at: new Date().toISOString(),
  factors: [],
}

const dummySession: Session = {
  access_token: "dummy-access-token",
  refresh_token: "dummy-refresh-token",
  expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  token_type: "bearer",
  user: dummyUser,
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  signOut: async () => {},
})

export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Use dummy user and session automatically
  const [user, setUser] = useState<User | null>(dummyUser)
  const [session, setSession] = useState<Session | null>(dummySession)
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  // Initialize by testing the database connection
  useEffect(() => {
    const testDbConnection = async () => {
      try {
        // Ping the database to see if our connection is working
        const { error } = await supabase.from('projects').select('count', { count: 'exact', head: true });
        
        if (error) {
          console.error('Database connection test failed:', error);
        } else {
          console.log('Database connection test successful');
        }
      } catch (err) {
        console.error('Error testing database connection:', err);
      }
    };
    
    testDbConnection();
  }, []);

  // Just for UI consistency, we'll keep the signOut function
  const signOut = async () => {
    // No actual sign out, just redirect to dashboard
    router.push("/dashboard")
  }

  const value = {
    user,
    session,
    isLoading,
    signOut,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

