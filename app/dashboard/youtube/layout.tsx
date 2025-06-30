import { YouTubeSidebar } from '@/components/youtube/youtube-sidebar';
import { Toaster } from '@/components/ui/toaster';

export default function YouTubeDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen bg-background">
      <YouTubeSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        {children}
      </main>
      <Toaster />
    </div>
  );
}