import Link from 'next/link';
import type React from 'react';
import { UserButton } from '@clerk/nextjs';

export const metadata = { title: 'ChannelSmith Admin' };

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/thumbnails', label: 'Thumbnail changes' },
  { href: '/admin/channels', label: 'Channels' },
  { href: '/admin/outliers', label: 'Outliers' },
  { href: '/dashboard/pipeline', label: 'Pipeline jobs' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3">
          <Link href="/admin" className="text-sm font-semibold tracking-tight">
            ChannelSmith <span className="text-muted-foreground">admin</span>
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action="/admin/videos" className="ml-auto">
            <input
              name="id"
              placeholder="video id"
              className="w-40 rounded border border-border bg-transparent px-2 py-1 text-xs"
            />
          </form>
          <UserButton />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
