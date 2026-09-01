import { betterAuth } from "better-auth"
import { Pool } from "pg"

const connectionString = process.env.DATABASE_POOLER_URL || process.env.DATABASE_URL

if (!connectionString) {
  throw new Error("DATABASE_POOLER_URL or DATABASE_URL is required for authentication")
}

const authPool = new Pool({
  connectionString,
  max: 2,
  ssl: { rejectUnauthorized: false },
})

export const auth = betterAuth({
  database: authPool,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
      clientSecret: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET!,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  user: {
    modelName: "profiles", // Use your existing profiles table
    fields: {
      id: "id",
      name: "full_name", 
      email: "email",
      image: "avatar_url",
      createdAt: "created_at",
      updatedAt: "updated_at"
    }
  },
})
