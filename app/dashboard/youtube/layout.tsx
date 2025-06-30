import { YouTubeSidebar } from '@/components/youtube/youtube-sidebar';

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
    </div>
  );
}