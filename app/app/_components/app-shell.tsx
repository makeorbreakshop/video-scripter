'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { UserButton } from '@clerk/nextjs';
import { ThemeProvider, ThemeToggle, THEME_BOOT_SCRIPT } from './theme';
import { MARK_CELLS, MARK_GRID } from '@/lib/app/brand';
import styles from './app-shell.module.css';

/** The anvil, inline so it takes the plate's colour and needs no request. */
function Mark() {
  return (
    <svg className="cs-mark" viewBox={`0 0 ${MARK_GRID} ${MARK_GRID}`} aria-hidden focusable="false">
      {MARK_CELLS.map(([x, y, w, h]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={w} height={h} fill="currentColor" />
      ))}
    </svg>
  );
}

const NAV = [
  { href: '/app/feed', label: 'Feed' },
  { href: '/app/inspiration', label: 'Inspiration' },
  { href: '/app/audience', label: 'Audience' },
  { href: '/app/outliers', label: 'Outliers' },
  { href: '/app/channels', label: 'Channels' },
  { href: '/app/settings', label: 'Settings' },
];

function Nav({ className, showInspiration, showAudience, showOutliers }: { className: string; showInspiration: boolean; showAudience: boolean; showOutliers: boolean }) {
  const path = usePathname() || '';
  if (path.startsWith('/app/onboarding')) return null;
  const items = NAV.filter((n) => (showInspiration || n.href !== '/app/inspiration') &&
    (showAudience || n.href !== '/app/audience') &&
    (showOutliers || n.href !== '/app/outliers'));
  return (
    <nav className={className}>
      {items.map((n) => (
        <Link key={n.href} href={n.href} data-active={path.startsWith(n.href)}>
          {n.label}
        </Link>
      ))}
    </nav>
  );
}

export default function AppShell({ children, showInspiration = false, showAudience = false, showOutliers = false }: { children: React.ReactNode; showInspiration?: boolean; showAudience?: boolean; showOutliers?: boolean }) {
  return (
    <ThemeProvider>
      <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      <header className="cs-header">
        <div className="cs-wrap cs-header-in">
          {/* Wordmark plate: the mark and the name, the same lockup as the favicon and the
              OG card, and the one place the pixel face carries the product name. */}
          <Link href="/app/feed" className="cs-marquee" aria-label="ChannelSmith — go to feed">
            <Mark />
            CHANNELSMITH
          </Link>
          <Nav className="cs-nav" showInspiration={showInspiration} showAudience={showAudience} showOutliers={showOutliers} />
          <div className="cs-header-right">
            <ThemeToggle />
            <UserButton />
          </div>
        </div>
        <div className="cs-wrap">
          <Nav className={`cs-nav cs-nav-mobile ${styles.compactMobile}`} showInspiration={showInspiration} showAudience={showAudience} showOutliers={showOutliers} />
        </div>
      </header>
      <main className="cs-wrap cs-main">{children}</main>
      <footer className="cs-wrap cs-footer">
        <span>ChannelSmith</span>
        <span className="cs-num" title={process.env.NEXT_PUBLIC_BUILD_TIME}>build {process.env.NEXT_PUBLIC_BUILD_SHA}</span>
        <a href="/docs/api">API</a>
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
      </footer>
    </ThemeProvider>
  );
}
