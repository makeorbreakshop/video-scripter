'use client';

import { useYouTubeTheme } from './YouTubeThemeProvider';

export default function YouTubeHeader() {
  const { theme, toggleTheme } = useYouTubeTheme();

  return (
    <header className="flex items-center h-14 px-6 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-[rgb(15,15,15)]">
      {/* Left side - Menu and Logo */}
      <div className="flex items-center gap-4 flex-shrink-0">
        {/* Hamburger Menu */}
        <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"/>
          </svg>
        </button>
        
        {/* YouTube Logo */}
        <div className="flex items-center gap-1">
          <div className="w-8 h-8 bg-red-600 rounded flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z"/>
            </svg>
          </div>
          <span className="text-xl font-normal text-black dark:text-white">
            YouTube<span className="text-xs text-gray-600 dark:text-gray-400 ml-0.5">Premium</span>
          </span>
        </div>
      </div>

      {/* Center - Search */}
      <div className="flex-1 max-w-2xl mx-6">
        <div className="flex items-center">
          <div className="flex-1 flex">
            <input
              type="text"
              placeholder="Search"
              className="w-full px-4 py-1.5 border border-gray-300 dark:border-gray-700 rounded-l-full bg-white dark:bg-[#0f0f0f] text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:border-blue-500 dark:focus:border-blue-400 text-sm"
            />
            <button className="px-5 py-1.5 border border-l-0 border-gray-300 dark:border-gray-700 rounded-r-full bg-gray-50 dark:bg-[#222222] hover:bg-gray-100 dark:hover:bg-gray-600">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
              </svg>
            </button>
          </div>
          <button className="p-2 ml-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
        </div>
      </div>

      {/* Right side - Controls */}
      <div className="flex items-center gap-2">
        <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>
          </svg>
        </button>
        <button className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
          <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
          </svg>
        </button>
        <button 
          onClick={toggleTheme}
          className="px-3 py-1.5 text-sm bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded transition-colors border border-gray-300 dark:border-gray-600"
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
        <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
          M
        </div>
      </div>
    </header>
  );
}