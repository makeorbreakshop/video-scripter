import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Thumbnail Battle - Can You Spot the Winner?',
  description: 'Test your YouTube instincts! Pick which thumbnail outperformed the channel average in this addictive guessing game. Challenge friends and climb the leaderboard!',
  keywords: 'YouTube, thumbnails, game, challenge, viral videos, content creation',
  
  openGraph: {
    title: 'Thumbnail Battle - Can You Spot the Winner?',
    description: 'Test your YouTube instincts! Pick which thumbnail outperformed the channel average.',
    url: 'https://thumbnail-battle.com',
    siteName: 'Thumbnail Battle',
    images: [
      {
        url: '/thumbnail-battle-og.png', // We'll need to create this
        width: 1200,
        height: 630,
        alt: 'Thumbnail Battle - YouTube Guessing Game',
      },
    ],
    locale: 'en_US',
    type: 'website',
  },
  
  twitter: {
    card: 'summary_large_image',
    title: 'Thumbnail Battle - Can You Spot the Winner?',
    description: 'Test your YouTube instincts! Pick which thumbnail outperformed the channel average.',
    images: ['/thumbnail-battle-og.png'],
    creator: '@ThumbnailBattle',
  },
  
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-icon.png' },
    ],
  },
  
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
  themeColor: '#00ff00',
};

export default function ThumbnailBattleLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}