'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { 
  BarChart3, 
  Package, 
  TrendingUp, 
  Youtube,
  Wrench,
  Users,
  Search,
  ChevronLeft,
  ChevronRight,
  Activity,
  Tags,
  Lightbulb,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const navigation = [
  {
    name: 'Analytics',
    href: '/dashboard/youtube',
    icon: BarChart3,
  },
  {
    name: 'Channel Analytics',
    href: '/dashboard/channel-analytics',
    icon: TrendingUp,
  },
  {
    name: 'Patterns',
    href: '/dashboard/youtube/patterns',
    icon: Sparkles,
  },
  {
    name: 'Pattern Analysis',
    href: '/dashboard/youtube/pattern-analysis',
    icon: Lightbulb,
  },
  {
    name: 'Packaging',
    href: '/dashboard/youtube/packaging',
    icon: Package,
  },
  {
    name: 'Competitors',
    href: '/dashboard/youtube/competitors',
    icon: Users,
  },
  {
    name: 'Search',
    href: '/dashboard/youtube/search',
    icon: Search,
  },
  {
    name: 'Tools',
    href: '/dashboard/youtube/tools',
    icon: Wrench,
  },
  {
    name: 'Worker',
    href: '/dashboard/youtube/worker',
    icon: Activity,
  },
  {
    name: 'Age-Adjusted Demo',
    href: '/dashboard/age-adjusted-demo',
    icon: BarChart3,
  },
  {
    name: 'Debug View',
    href: '/dashboard/age-adjusted-debug',
    icon: BarChart3,
  },
];

export function YouTubeSidebar() {
  const pathname = usePathname();
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className={cn(
      "flex h-full flex-col bg-card border-r border-border transition-all duration-300 ease-in-out",
      isCollapsed ? "w-16" : "w-64"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border min-h-[73px]">
        <div className="flex items-center gap-2 overflow-hidden">
          <Youtube className="h-6 w-6 text-red-600 flex-shrink-0" />
          {!isCollapsed && (
            <div className="transition-opacity duration-200">
              <h1 className="font-semibold text-base text-card-foreground leading-tight">YouTube Dashboard</h1>
              <p className="text-xs text-muted-foreground">Make or Break Shop</p>
            </div>
          )}
        </div>
        
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="h-8 w-8 p-0 flex-shrink-0"
        >
          {isCollapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-2">
        {navigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/dashboard/youtube' && pathname.startsWith(item.href));
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200 group relative',
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                isCollapsed ? 'justify-center' : ''
              )}
              title={isCollapsed ? item.name : undefined}
            >
              <item.icon className="h-4 w-4 flex-shrink-0" />
              {!isCollapsed && (
                <span className="transition-opacity duration-200">{item.name}</span>
              )}
              
              {/* Tooltip for collapsed state */}
              {isCollapsed && (
                <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
                  {item.name}
                </div>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-border p-2">
        <Link
          href="/dashboard"
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all duration-200 group relative',
            isCollapsed ? 'justify-center' : ''
          )}
          title={isCollapsed ? 'Back to Main Dashboard' : undefined}
        >
          <TrendingUp className="h-4 w-4 flex-shrink-0" />
          {!isCollapsed && (
            <span className="transition-opacity duration-200">Back to Main Dashboard</span>
          )}
          
          {/* Tooltip for collapsed state */}
          {isCollapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 bg-popover text-popover-foreground text-xs rounded-md border border-border shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
              Back to Main Dashboard
            </div>
          )}
        </Link>
      </div>
    </div>
  );
}