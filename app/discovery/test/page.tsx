'use client';

import { ChannelSpider } from '@/components/discovery/channel-spider';

export default function DiscoveryTestPage() {
  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Channel Discovery Test</h1>
      <ChannelSpider />
    </div>
  );
}