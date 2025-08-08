# Supabase Authentication Setup for YouTube Script Editor

This document outlines the steps to set up authentication for the YouTube Script Editor application using Supabase.

## Basic Setup

1. Log in to your Supabase dashboard and select your project.
2. Navigate to the "Authentication" section in the sidebar.

## Email Authentication

The application uses email/password authentication by default.

1. Go to "Authentication" > "Providers".
2. Ensure that "Email" is enabled.
3. You can configure options like:
   - Whether to require email confirmation
   - Password strength requirements
   - Custom email templates

## Social Providers (Optional)

The application supports Google and GitHub login. Here's how to set them up:

### Google Authentication

1. Go to "Authentication" > "Providers" > "Google".
2. Toggle "Enable Google OAuth".
3. You'll need to create OAuth credentials in the Google Cloud Console:
   - Go to https://console.cloud.google.com/
   - Create a new project or select an existing one
   - Navigate to "APIs & Services" > "Credentials"
   - Click "Create Credentials" > "OAuth client ID"
   - Set application type to "Web application"
   - Add authorized redirect URIs from Supabase dashboard
   - Copy the Client ID and Client Secret
4. Enter the Client ID and Client Secret in Supabase.

### GitHub Authentication

1. Go to "Authentication" > "Providers" > "GitHub".
2. Toggle "Enable GitHub OAuth".
3. You'll need to create an OAuth app in GitHub:
   - Go to GitHub > Settings > Developer settings > OAuth Apps
   - Click "New OAuth App"
   - Fill in the application details
   - Set the "Authorization callback URL" to the URL from Supabase
   - Register the application and note the Client ID
   - Generate a new client secret and copy it
4. Enter the Client ID and Client Secret in Supabase.

## Redirect URLs

Make sure to configure the Site URL and Redirect URLs in the Supabase Authentication settings:

1. Go to "Authentication" > "URL Configuration".
2. Set "Site URL" to your application's URL (e.g., http://localhost:3000 for development).
3. Add any additional redirect URLs if needed.

## Auth UI in the Application

The application uses Supabase Auth UI for the login page:

```tsx
<Auth
  supabaseClient={supabase}
  appearance={{ theme: ThemeSupa }}
  theme="dark"
  providers={["google", "github"]}
  redirectTo={`${window.location.origin}/dashboard`}
/>
```

This component is used in the `/app/login/page.tsx` file and handles the entire authentication flow.

## Testing Authentication

Once setup is complete, you should be able to:

1. Register a new user with email/password
2. Sign in with social providers (if configured)
3. Access protected routes like `/dashboard`

Any authentication errors will be displayed by the Auth UI component. 