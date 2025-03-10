"use client"

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { handleOAuthCallback } from '@/lib/youtube-oauth'
import { Loader2 } from 'lucide-react'

export default function OAuthCallbackPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'processing' | 'success' | 'error'>('processing')
  const [message, setMessage] = useState('Processing authentication...')

  useEffect(() => {
    const processOAuthCallback = async () => {
      try {
        // Only run in browser
        if (typeof window === 'undefined') return;
        
        const currentUrl = window.location.href;
        const tokens = await handleOAuthCallback(currentUrl);
        
        if (tokens) {
          setStatus('success');
          setMessage('Authentication successful! Redirecting...');
          
          // Redirect back to the video research tool
          setTimeout(() => {
            router.push('/dashboard');
          }, 1500);
        } else {
          setStatus('error');
          setMessage('Authentication failed. Please try again.');
        }
      } catch (error) {
        console.error('Error processing OAuth callback:', error);
        setStatus('error');
        setMessage('An error occurred during authentication.');
      }
    };

    processOAuthCallback();
  }, [router]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center">
      <div className="w-full max-w-md space-y-8 p-8 bg-white dark:bg-slate-900 rounded-lg shadow-md">
        <div className="text-center">
          <h1 className="text-2xl font-bold">YouTube Authentication</h1>
          
          <div className="mt-6">
            {status === 'processing' && (
              <div className="flex flex-col items-center justify-center space-y-4">
                <Loader2 className="h-12 w-12 text-blue-500 animate-spin" />
                <p>{message}</p>
              </div>
            )}
            
            {status === 'success' && (
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-green-600">{message}</p>
              </div>
            )}
            
            {status === 'error' && (
              <div className="flex flex-col items-center justify-center space-y-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </div>
                <p className="text-red-600">{message}</p>
                <button
                  onClick={() => router.push('/dashboard')}
                  className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                >
                  Return to Dashboard
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
} 