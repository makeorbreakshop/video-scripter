'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/components/ui/use-toast';
import { Search, Loader2 } from 'lucide-react';

export function ChannelSpider() {
  const [seedChannel, setSeedChannel] = useState('');
  const [config, setConfig] = useState({
    minSubscribers: 10000,
    maxDaysSinceUpload: 90,
    maxChannels: 50,
    maxDepth: 2
  });
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSpider = async () => {
    if (!seedChannel) {
      toast({
        title: 'Error',
        description: 'Please enter a seed channel ID or handle',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/discovery/spider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${(await (await fetch('/api/auth/session')).json()).access_token}`
        },
        body: JSON.stringify({
          seedChannelId: seedChannel,
          config
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to run spider');
      }

      toast({
        title: 'Spider Configured',
        description: `Ready to discover up to ${config.maxChannels} channels related to ${seedChannel}`
      });

      console.log('Spider response:', data);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to run spider',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>YouTube Channel Discovery Spider</CardTitle>
        <CardDescription>
          Discover related YouTube channels by web scraping channel pages, video descriptions, and more.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="seed-channel">Seed Channel (ID or @handle)</Label>
          <Input
            id="seed-channel"
            placeholder="e.g., UCsBjURrPoezykLs9EqgamOA or @Fireship"
            value={seedChannel}
            onChange={(e) => setSeedChannel(e.target.value)}
          />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Minimum Subscribers</Label>
              <span className="text-sm text-muted-foreground">
                {config.minSubscribers.toLocaleString()}
              </span>
            </div>
            <Slider
              value={[config.minSubscribers]}
              onValueChange={([value]) => setConfig({ ...config, minSubscribers: value })}
              min={1000}
              max={100000}
              step={1000}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Max Days Since Upload</Label>
              <span className="text-sm text-muted-foreground">{config.maxDaysSinceUpload} days</span>
            </div>
            <Slider
              value={[config.maxDaysSinceUpload]}
              onValueChange={([value]) => setConfig({ ...config, maxDaysSinceUpload: value })}
              min={7}
              max={365}
              step={7}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Maximum Channels to Discover</Label>
              <span className="text-sm text-muted-foreground">{config.maxChannels}</span>
            </div>
            <Slider
              value={[config.maxChannels]}
              onValueChange={([value]) => setConfig({ ...config, maxChannels: value })}
              min={10}
              max={500}
              step={10}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <Label>Discovery Depth</Label>
              <span className="text-sm text-muted-foreground">{config.maxDepth} levels</span>
            </div>
            <Slider
              value={[config.maxDepth]}
              onValueChange={([value]) => setConfig({ ...config, maxDepth: value })}
              min={1}
              max={4}
              step={1}
            />
          </div>
        </div>

        <div className="pt-4">
          <Button onClick={handleSpider} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Configuring Spider...
              </>
            ) : (
              <>
                <Search className="mr-2 h-4 w-4" />
                Start Discovery
              </>
            )}
          </Button>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>Discovery methods:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Channels tab - Featured/recommended channels</li>
            <li>Video descriptions - Mentioned channels</li>
            <li>Community posts - Collaborations</li>
            <li>Sidebar - YouTube's similar channel suggestions</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}