'use client';

export default function YouTubeSidebar() {
  return (
    <aside className="w-56 h-full bg-white dark:bg-[rgb(15,15,15)] border-r border-gray-200 dark:border-gray-800 overflow-y-auto">
      <div className="py-2">
        {/* Home section */}
        <div className="px-3 mb-2">
          <nav className="space-y-1">
            <a href="#" className="flex items-center px-3 py-2 text-sm font-medium text-gray-900 dark:text-white bg-gray-100 dark:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
              </svg>
              Home
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4L18 11H8a1 1 0 0 0 0 2h10l-3.3 3.3a1 1 0 0 0 1.4 1.4l5-5a1 1 0 0 0 0-1.4l-5-5a1 1 0 0 0-1.4 0z"/>
              </svg>
              Shorts
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
              </svg>
              Subscriptions
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L7.26 14.8c-.72.72-.72 1.9 0 2.62.36.36.84.56 1.35.56s.99-.2 1.35-.56l7.57-6.65c.72-.72 1.9-.72 2.62 0 .72.72.72 1.9 0 2.62l-7.57 6.65c-1.44 1.44-3.77 1.44-5.21 0-1.44-1.44-1.44-3.77 0-5.21l7.57-6.65c2.1-2.1 5.5-2.1 7.6 0 2.1 2.1 2.1 5.5 0 7.6l-7.57 6.65c-2.76 2.76-7.24 2.76-10 0-2.76-2.76-2.76-7.24 0-10l7.57-6.65c.72-.72 1.9-.72 2.62 0 .72.72.72 1.9 0 2.62l-7.57 6.65c-.36.36-.93.36-1.29 0-.36-.36-.36-.93 0-1.29l6.22-6.22c.72-.72.72-1.9 0-2.62-.36-.36-.84-.56-1.35-.56z"/>
              </svg>
              YouTube Music
            </a>
          </nav>
        </div>

        <hr className="border-gray-200 dark:border-gray-700 my-2" />

        {/* You section */}
        <div className="px-3 mb-2">
          <h3 className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">You</h3>
          <nav className="space-y-1">
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M14.12 4l1.83 2H20v12H4V6h4.05l1.83-2h4.24M15 2H9L7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2zm-3 7c1.65 0 3 1.35 3 3s-1.35 3-3 3-3-1.35-3-3 1.35-3 3-3m0-2c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5z"/>
              </svg>
              History
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z"/>
              </svg>
              Your videos
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V7h10v2z"/>
              </svg>
              Watch later
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
              Liked videos
            </a>
          </nav>
        </div>

        <hr className="border-gray-200 dark:border-gray-700 my-2" />

        {/* Subscriptions */}
        <div className="px-3">
          <h3 className="px-3 py-2 text-sm font-medium text-gray-900 dark:text-white">Subscriptions</h3>
          <nav className="space-y-1">
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <div className="w-6 h-6 bg-red-600 rounded-full mr-3 flex-shrink-0"></div>
              MrBeast
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <div className="w-6 h-6 bg-blue-600 rounded-full mr-3 flex-shrink-0"></div>
              Mark Rober
            </a>
            <a href="#" className="flex items-center px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg">
              <div className="w-6 h-6 bg-green-600 rounded-full mr-3 flex-shrink-0"></div>
              Dude Perfect
            </a>
          </nav>
        </div>
      </div>
    </aside>
  );
}