"use client"

import { GoogleApiSettings } from "@/components/tools/google-api-settings"

export default function SettingsPage() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Settings</h1>
        <p className="text-muted-foreground">
          Configure your workspace settings and integrations
        </p>
      </div>
      
      <div className="grid gap-6">
        <div className="border rounded-lg p-6">
          <GoogleApiSettings />
        </div>
        
        {/* Add more settings sections here as needed */}
      </div>
    </div>
  )
} 