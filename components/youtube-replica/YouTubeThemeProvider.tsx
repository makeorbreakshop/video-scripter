'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface YouTubeThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const YouTubeThemeContext = createContext<YouTubeThemeContextType | undefined>(undefined);

export function useYouTubeTheme() {
  const context = useContext(YouTubeThemeContext);
  if (context === undefined) {
    throw new Error('useYouTubeTheme must be used within a YouTubeThemeProvider');
  }
  return context;
}

interface YouTubeThemeProviderProps {
  children: ReactNode;
}

export default function YouTubeThemeProvider({ children }: YouTubeThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>('light');

  useEffect(() => {
    // Check localStorage for saved theme preference
    const savedTheme = localStorage.getItem('youtube-replica-theme') as Theme;
    if (savedTheme) {
      setTheme(savedTheme);
    } else {
      // Check system preference
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setTheme(systemPrefersDark ? 'dark' : 'light');
    }
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('youtube-replica-theme', newTheme);
  };

  return (
    <YouTubeThemeContext.Provider value={{ theme, toggleTheme }}>
      <div
        className={theme === 'dark' ? 'dark' : ''}
        style={{
          '--yt-spec-base-background': theme === 'light' ? '#FFFFFF' : 'rgb(15, 15, 15)',
          '--yt-spec-text-primary': theme === 'light' ? '#0F0F0F' : '#FFFFFF',
          '--yt-spec-text-secondary': theme === 'light' ? '#606060' : '#AAAAAA',
          '--yt-spec-text-disabled': theme === 'light' ? '#909090' : '#717171',
          '--yt-spec-icon-inactive': theme === 'light' ? '#606060' : '#AAAAAA',
          '--yt-spec-outline': theme === 'light' ? '#E5E5E5' : '#303030',
          '--yt-spec-brand-button-text': theme === 'light' ? '#065FD4' : '#3EA6FF',
        } as React.CSSProperties}
      >
        <div 
          className="min-h-screen transition-colors duration-200"
          style={{
            backgroundColor: theme === 'light' ? '#FFFFFF' : 'rgb(15, 15, 15)',
            color: theme === 'light' ? '#0F0F0F' : '#FFFFFF'
          }}
        >
          {children}
        </div>
      </div>
    </YouTubeThemeContext.Provider>
  );
}