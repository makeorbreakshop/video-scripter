// ChannelSmith app shell. Clerk protects '/app(.*)' in middleware.ts, so anything
// rendered here already has a session; we only have to make sure the app_users row
// exists before any page queries against it.
import { Fragment } from 'react';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Press_Start_2P } from 'next/font/google';
import './theme.css';
import { requireAppUser } from '@/lib/app/session';
import AppShell from './_components/app-shell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
// The pixel face is for the wordmark, the score numerals, the NEW HIGH SCORE tag and the
// onboarding step chips only — never body text, headings or labels.
const pixel = Press_Start_2P({ subsets: ['latin'], weight: '400', variable: '--font-pixel', display: 'swap' });

export const metadata: Metadata = {
  title: 'ChannelSmith',
  description: 'Track what the channels you watch are changing, and what it did for them.',
};

export const dynamic = 'force-dynamic';

/**
 * Thumbnails come from the R2 worker, YouTube avatars from yt3, fallback thumbs from
 * i.ytimg. Every one is a cross-origin host we hit as soon as a grid paints, so open the
 * TLS connections while the server render is still streaming rather than after it.
 * React 19 hoists these <link>s into <head>, which is why a nested layout can emit them.
 */
function Preconnects() {
  const thumbs = process.env.NEXT_PUBLIC_THUMBS_BASE_URL;
  let thumbOrigin: string | null = null;
  try {
    if (thumbs) thumbOrigin = new URL(thumbs).origin;
  } catch {
    thumbOrigin = null; // a malformed env var must not take the app shell down
  }
  const origins = [thumbOrigin, 'https://yt3.ggpht.com', 'https://i.ytimg.com'].filter(Boolean) as string[];
  return (
    <>
      {origins.map((o) => (
        <Fragment key={o}>
          <link rel="preconnect" href={o} crossOrigin="" />
          <link rel="dns-prefetch" href={o} />
        </Fragment>
      ))}
    </>
  );
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // ensureUser is idempotent; first load after sign-up is what creates the row.
  await requireAppUser().catch((e) => {
    console.error('app layout ensureUser:', e?.message);
    return null;
  });

  return (
    <div className={`${inter.variable} ${mono.variable} ${pixel.variable} cs-app`}>
      <Preconnects />
      <AppShell>{children}</AppShell>
    </div>
  );
}
