// YouTube OAuth 2.0 authentication utility
// This handles the OAuth flow for accessing YouTube data, especially transcripts

// Get OAuth configuration dynamically
const getOAuthConfig = () => {
  // Get configuration from localStorage or environment variables
  const clientId = typeof window !== 'undefined' 
    ? localStorage.getItem('GOOGLE_CLIENT_ID') || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
    : process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    
  const clientSecret = typeof window !== 'undefined'
    ? localStorage.getItem('GOOGLE_CLIENT_SECRET') || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET
    : process.env.NEXT_PUBLIC_GOOGLE_CLIENT_SECRET;
    
  const redirectUri = typeof window !== 'undefined' 
    ? `${window.location.origin}/oauth-callback` 
    : '';
    
  const scope = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/youtube.force-ssl',
    'https://www.googleapis.com/auth/yt-analytics.readonly',
    'https://www.googleapis.com/auth/yt-analytics-monetary.readonly'
  ].join(' ');
  
  return {
    clientId: clientId || '',
    clientSecret: clientSecret || '',
    redirectUri,
    scope,
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token'
  };
};

// Types for OAuth tokens
export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_at: number; // Timestamp when the token expires
  token_type: string;
}

/**
 * Initiates the OAuth authorization flow
 * Redirects the user to Google's consent screen
 */
export function initiateOAuthFlow() {
  if (typeof window === 'undefined') return;
  
  // Get current config
  const OAUTH_CONFIG = getOAuthConfig();
  
  if (!OAUTH_CONFIG.clientId) {
    console.error('Google Client ID not configured');
    return;
  }
  
  // Generate a random state parameter to prevent CSRF attacks
  const state = Math.random().toString(36).substring(2, 15);
  localStorage.setItem('oauth_state', state);
  
  // Build the authorization URL
  const authUrl = new URL(OAUTH_CONFIG.authEndpoint);
  authUrl.searchParams.append('client_id', OAUTH_CONFIG.clientId);
  authUrl.searchParams.append('redirect_uri', OAUTH_CONFIG.redirectUri);
  authUrl.searchParams.append('response_type', 'code');
  authUrl.searchParams.append('scope', OAUTH_CONFIG.scope);
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('access_type', 'offline'); // Get refresh token
  authUrl.searchParams.append('prompt', 'select_account consent'); // Force account selection & consent screen

  // Redirect to Google's OAuth page
  window.location.href = authUrl.toString();
}

/**
 * Handles the OAuth callback
 * Extracts the authorization code from URL and exchanges it for tokens
 */
export async function handleOAuthCallback(url: string): Promise<OAuthTokens | null> {
  try {
    const urlParams = new URLSearchParams(new URL(url).search);
    const code = urlParams.get('code');
    const state = urlParams.get('state');
    
    // Verify state parameter to prevent CSRF attacks
    const savedState = localStorage.getItem('oauth_state');
    localStorage.removeItem('oauth_state'); // Clear the state
    
    if (!code || state !== savedState) {
      console.error('Invalid OAuth callback', { code, state, savedState });
      return null;
    }
    
    // Get current config
    const OAUTH_CONFIG = getOAuthConfig();
    
    if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
      console.error('OAuth credentials missing');
      return null;
    }
    
    // Exchange the authorization code for tokens
    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        redirect_uri: OAUTH_CONFIG.redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to exchange code for tokens', errorData);
      return null;
    }
    
    const data = await response.json();
    
    // Calculate when the token expires
    const expiresAt = Date.now() + (data.expires_in * 1000);
    
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      token_type: data.token_type,
    };
    
    // Store tokens in localStorage
    saveTokens(tokens);
    
    return tokens;
  } catch (error) {
    console.error('Error handling OAuth callback:', error);
    return null;
  }
}

/**
 * Refreshes the access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
  try {
    // Get current config
    const OAUTH_CONFIG = getOAuthConfig();
    
    if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
      console.error('OAuth credentials missing');
      return null;
    }
    
    const response = await fetch(OAUTH_CONFIG.tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: OAUTH_CONFIG.clientId,
        client_secret: OAUTH_CONFIG.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Failed to refresh token', errorData);
      return null;
    }
    
    const data = await response.json();
    
    // Calculate when the token expires
    const expiresAt = Date.now() + (data.expires_in * 1000);
    
    // Keep the existing refresh token if a new one was not provided
    const tokens: OAuthTokens = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken,
      expires_at: expiresAt,
      token_type: data.token_type,
    };
    
    // Update tokens in localStorage
    saveTokens(tokens);
    
    return tokens;
  } catch (error) {
    console.error('Error refreshing access token:', error);
    return null;
  }
}

/**
 * Gets the stored OAuth tokens
 */
export function getTokens(): OAuthTokens | null {
  if (typeof window === 'undefined') return null;
  
  const tokensJson = localStorage.getItem('youtube_oauth_tokens');
  if (!tokensJson) return null;
  
  try {
    return JSON.parse(tokensJson) as OAuthTokens;
  } catch (error) {
    console.error('Error parsing tokens:', error);
    return null;
  }
}

/**
 * Saves OAuth tokens to localStorage
 */
export function saveTokens(tokens: OAuthTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem('youtube_oauth_tokens', JSON.stringify(tokens));
}

/**
 * Checks if the current tokens are valid and refreshes if needed
 * Returns the valid access token or null if unable to get a valid token
 */
export async function getValidAccessToken(): Promise<string | null> {
  const tokens = getTokens();
  
  if (!tokens) {
    console.log('No OAuth tokens found');
    return null;
  }
  
  // If the access token is still valid, return it
  if (tokens.expires_at > Date.now()) {
    return tokens.access_token;
  }
  
  // Otherwise, try to refresh the token
  if (tokens.refresh_token) {
    const newTokens = await refreshAccessToken(tokens.refresh_token);
    if (newTokens) {
      return newTokens.access_token;
    }
  }
  
  console.log('Unable to get valid access token');
  return null;
}

/**
 * Signs out the user, clearing all OAuth tokens
 */
export function signOut(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('youtube_oauth_tokens');
  localStorage.removeItem('oauth_state');
}

/**
 * Checks if the user is authenticated
 */
export function isAuthenticated(): boolean {
  return !!getTokens();
} 