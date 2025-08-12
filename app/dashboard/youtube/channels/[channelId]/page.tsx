import { Suspense } from 'react';
import { ChannelAnalysis } from '@/components/youtube/channel-analysis';

interface ChannelPageProps {
  params: {
    channelId: string;
  };
}

export default async function ChannelPage({ params }: ChannelPageProps) {
  const { channelId } = await params;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Suspense fallback={
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      }>
        <ChannelAnalysis channelId={decodeURIComponent(channelId)} />
      </Suspense>
    </div>
  );
}