import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { ThemeProvider } from "@/components/theme-provider"
import { AuthProvider } from "@/contexts/auth-context"
import { Toaster } from "sonner"
import { ClerkProvider } from "@clerk/nextjs"
import { BRAND } from "@/lib/app/brand"

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  // The default for every route that does not set its own. /app and /admin override it.
  title: { default: BRAND.name, template: `%s — ${BRAND.name}` },
  description: BRAND.tagline,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <ClerkProvider>
          <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
            <AuthProvider>{children}</AuthProvider>
            <Toaster />
          </ThemeProvider>
        </ClerkProvider>
      </body>
    </html>
  )
}