// ChannelSmith app shell. Clerk protects '/app(.*)' in middleware.ts, so anything
// rendered here already has a session; we only have to make sure the app_users row
// exists before any page queries against it.
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

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // ensureUser is idempotent; first load after sign-up is what creates the row.
  await requireAppUser().catch((e) => {
    console.error('app layout ensureUser:', e?.message);
    return null;
  });

  return (
    <div className={`${inter.variable} ${mono.variable} ${pixel.variable} cs-app`}>
      <AppShell>{children}</AppShell>
    </div>
  );
}
