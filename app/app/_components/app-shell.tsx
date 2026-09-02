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
          {/* Marquee strip: the cabinet header, static and small. */}
          <Link href="/app/feed" className="cs-marquee">
            <span className="cs-marquee-dot" />
            CHANNELSMITH
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
    </ThemeProvider>
  );
}
