'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { 
  BarChart3, 
  Package, 
  Settings, 
  TrendingUp, 
  Youtube,
  Wrench
} from 'lucide-react';

const navigation = [
  {
    name: 'Analytics',
    href: '/dashboard/youtube',
    icon: BarChart3,
  },
  {
    name: 'Packaging',
    href: '/dashboard/youtube/packaging',
    icon: Package,
  },
  {
    name: 'Tools',
    href: '/dashboard/youtube/tools',
    icon: Wrench,
  },
];

export function YouTubeSidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col bg-card border-r border-border">
      {/* Header */}
      <div className="flex items-center gap-2 p-6 border-b border-border">
        <Youtube className="h-8 w-8 text-red-600" />
        <div>
          <h1 className="font-semibold text-lg text-card-foreground">YouTube Dashboard</h1>
          <p className="text-sm text-muted-foreground">Make or Break Shop</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/dashboard/youtube' && pathname.startsWith(item.href));
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <TrendingUp className="h-4 w-4" />
          Back to Main Dashboard
        </Link>
      </div>
    </div>
  );
}