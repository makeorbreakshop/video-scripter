'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { ThemeProvider, ThemeToggle, THEME_BOOT_SCRIPT } from './theme';

const NAV = [
  { href: '/app/feed', label: 'Feed' },
  { href: '/app/channels', label: 'Channels' },
  { href: '/app/settings', label: 'Settings' },
];

function Nav({ className }: { className: string }) {
  const path = usePathname() || '';
  if (path.startsWith('/app/onboarding')) return null;
  return (
    <nav className={className}>
      {NAV.map((n) => (
        <Link key={n.href} href={n.href} data-active={path.startsWith(n.href)}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <header className="cs-header">
        <div className="cs-wrap cs-header-in">
          {/* Wordmark plate: the one place the pixel face carries the product name. */}
          <Link href="/app/feed" className="cs-marquee" aria-label="ChannelSmith — go to feed">
            CHANNELSMITH
            <span className="cs-marquee-cursor" aria-hidden />
          </Link>
          <Nav className="cs-nav" />
          <div className="cs-header-right">
            <ThemeToggle />
            <UserButton />
          </div>
        </div>
        <div className="cs-wrap">
          <Nav className="cs-nav cs-nav-mobile" />
        </div>
      </header>
      <main className="cs-wrap cs-main">{children}</main>
      <footer className="cs-wrap" style={{ padding: '28px 0 40px', fontSize: 11, color: 'var(--cs-muted)', display: 'flex', gap: 14 }}>
        <span>ChannelSmith</span>
        <span className="cs-num" title={process.env.NEXT_PUBLIC_BUILD_TIME}>build {process.env.NEXT_PUBLIC_BUILD_SHA}</span>
        <a href="/docs/api" style={{ color: 'inherit' }}>API</a><a href="/privacy" style={{ color: 'inherit' }}>Privacy</a><a href="/terms" style={{ color: 'inherit' }}>Terms</a>
      </footer>
    </ThemeProvider>
  );
}
