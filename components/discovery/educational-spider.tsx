'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { Search, Loader2, Target, BookOpen, Users, TrendingUp } from 'lucide-react';
import { getAllNiches, type EducationalNiche } from '@/lib/educational-niches';
import { createClient } from '@supabase/supabase-js';

interface DiscoveryConfig {
  minSubscribers: number;
  maxDaysSinceUpload: number;
  maxChannels: number;
  maxDepth: number;
  enableSearchDiscovery: boolean;
  enablePlaylistDiscovery: boolean;
  searchTermsPerNiche: number;
}

export function EducationalSpider() {
  const [selectedNiche, setSelectedNiche] = useState<string>('');
  const [config, setConfig] = useState<DiscoveryConfig>({
    minSubscribers: 5000,
    maxDaysSinceUpload: 30,
    maxChannels: 10,
    maxDepth: 3,
    enableSearchDiscovery: true,
    enablePlaylistDiscovery: true,
    searchTermsPerNiche: 5
  });
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<'test' | 'production'>('test');
  const { toast } = useToast();

  const niches = getAllNiches();

  const handleDiscovery = async () => {
    if (!selectedNiche) {
      toast({
        title: 'Error',
        description: 'Please select a niche to discover',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data: { session } } = await supabase.auth.getSession();
      
      const response = await fetch('/api/discovery/spider', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`
        },
        body: JSON.stringify({
          nicheId: selectedNiche,
          config,
          mode
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to start discovery');
      }

      toast({
        title: 'Discovery Started',
        description: mode === 'production' 
          ? `Background discovery started for ${data.niche.name}. Expected duration: ${data.estimatedDuration}`
          : `Found ${data.discovered?.length || 0} educational channels in ${data.niche.name}`
      });

      if (mode === 'test' && data.discovered) {
        console.log('Discovered channels:', data.discovered);
      }

    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start discovery',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const getNicheColor = (nicheId: string) => {
    const colors = {
      'diy': 'bg-orange-100 text-orange-800',
      'cooking': 'bg-red-100 text-red-800',
      'fitness': 'bg-green-100 text-green-800',
      'health': 'bg-blue-100 text-blue-800',
      'technology': 'bg-purple-100 text-purple-800',
      'finance': 'bg-yellow-100 text-yellow-800',
      'photography': 'bg-pink-100 text-pink-800',
      'language': 'bg-indigo-100 text-indigo-800',
      'gardening': 'bg-emerald-100 text-emerald-800',
      'music': 'bg-violet-100 text-violet-800'
    };
    return colors[nicheId as keyof typeof colors] || 'bg-gray-100 text-gray-800';
  };

  const selectedNicheData = niches.find(n => n.id === selectedNiche);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Educational YouTube Channel Discovery
          </CardTitle>
          <CardDescription>
            Discover educational YouTube creators by niche using advanced web scraping. 
            Find channels that teach, have products, and create educational content.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(value) => setMode(value as 'test' | 'production')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="test">Test Mode (10 channels)</TabsTrigger>
              <TabsTrigger value="production">Production (200+ channels)</TabsTrigger>
            </TabsList>
            
            <TabsContent value="test" className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Test mode runs synchronously and returns results immediately. Perfect for testing configuration.
              </div>
            </TabsContent>
            
            <TabsContent value="production" className="space-y-4">
              <div className="text-sm text-muted-foreground">
                Production mode runs in the background and can discover hundreds of channels. 
                Check the database for results.
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Select Educational Niche</CardTitle>
          <CardDescription>
            Choose a niche to start discovery. Each niche has curated seed channels and search terms.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {niches.map((niche) => (
              <Card
                key={niche.id}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedNiche === niche.id ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => setSelectedNiche(niche.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold">{niche.name}</h3>
                    <Badge className={getNicheColor(niche.id)}>
                      {niche.seedChannels.length} seeds
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {niche.description}
                  </p>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Search className="h-3 w-3" />
                      {niche.searchTerms.length} terms
                    </span>
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3 w-3" />
                      {niche.educationalSignals.length} signals
                    </span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedNicheData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              {selectedNicheData.name} - Discovery Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold mb-2">Seed Channels ({selectedNicheData.seedChannels.length})</h4>
              <div className="flex flex-wrap gap-2">
                {selectedNicheData.seedChannels.slice(0, 6).map((channel) => (
                  <Badge key={channel.name} variant="outline">
                    {channel.name}
                    <span className="ml-1 text-xs">
                      ({channel.tier === 'mega' ? '1M+' : channel.tier === 'large' ? '100K+' : '10K+'})
                    </span>
                  </Badge>
                ))}
                {selectedNicheData.seedChannels.length > 6 && (
                  <Badge variant="outline">+{selectedNicheData.seedChannels.length - 6} more</Badge>
                )}
              </div>
            </div>
            
            <div>
              <h4 className="font-semibold mb-2">Search Terms</h4>
              <div className="flex flex-wrap gap-2">
                {selectedNicheData.searchTerms.slice(0, 5).map((term) => (
                  <Badge key={term} variant="secondary">"{term}"</Badge>
                ))}
                {selectedNicheData.searchTerms.length > 5 && (
                  <Badge variant="secondary">+{selectedNicheData.searchTerms.length - 5} more</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Discovery Configuration</CardTitle>
          <CardDescription>
            Adjust discovery parameters. Educational channels often have different patterns than entertainment.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                  max={50000}
                  step={1000}
                />
                <div className="text-xs text-muted-foreground">
                  Educational channels can be successful with fewer subscribers
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Max Days Since Upload</Label>
                  <span className="text-sm text-muted-foreground">{config.maxDaysSinceUpload} days</span>
                </div>
                <Slider
                  value={[config.maxDaysSinceUpload]}
                  onValueChange={([value]) => setConfig({ ...config, maxDaysSinceUpload: value })}
                  min={30}
                  max={365}
                  step={30}
                />
                <div className="text-xs text-muted-foreground">
                  Educational content creators may upload less frequently
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Maximum Channels</Label>
                  <span className="text-sm text-muted-foreground">{config.maxChannels}</span>
                </div>
                <Slider
                  value={[config.maxChannels]}
                  onValueChange={([value]) => setConfig({ ...config, maxChannels: value })}
                  min={mode === 'test' ? 5 : 50}
                  max={mode === 'test' ? 20 : 500}
                  step={mode === 'test' ? 1 : 25}
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
                  max={mode === 'test' ? 2 : 4}
                  step={1}
                />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold">Discovery Methods</h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>YouTube Search Discovery</Label>
                  <div className="text-sm text-muted-foreground">
                    Search YouTube for educational content
                  </div>
                </div>
                <Switch
                  checked={config.enableSearchDiscovery}
                  onCheckedChange={(checked) => setConfig({ ...config, enableSearchDiscovery: checked })}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Playlist Discovery</Label>
                  <div className="text-sm text-muted-foreground">
                    Find creators through educational playlists
                  </div>
                </div>
                <Switch
                  checked={config.enablePlaylistDiscovery}
                  onCheckedChange={(checked) => setConfig({ ...config, enablePlaylistDiscovery: checked })}
                />
              </div>
            </div>

            {config.enableSearchDiscovery && (
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>Search Terms per Niche</Label>
                  <span className="text-sm text-muted-foreground">{config.searchTermsPerNiche}</span>
                </div>
                <Slider
                  value={[config.searchTermsPerNiche]}
                  onValueChange={([value]) => setConfig({ ...config, searchTermsPerNiche: value })}
                  min={2}
                  max={10}
                  step={1}
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <Button 
            onClick={handleDiscovery} 
            disabled={loading || !selectedNiche} 
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === 'production' ? 'Starting Background Discovery...' : 'Discovering Channels...'}
              </>
            ) : (
              <>
                <TrendingUp className="mr-2 h-4 w-4" />
                Start Educational Discovery
              </>
            )}
          </Button>
          
          {selectedNicheData && (
            <div className="mt-4 text-center text-sm text-muted-foreground">
              Will discover educational channels in <strong>{selectedNicheData.name}</strong> 
              {mode === 'production' && ` (estimated ${Math.ceil(config.maxChannels / 10)} minutes)`}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Discovery Methods</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <h4 className="font-semibold">Primary Methods</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Seed from known educational channels</li>
                <li>• YouTube search for niche terms</li>
                <li>• Channel featured/recommended tabs</li>
                <li>• Video description channel mentions</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">Educational Detection</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Tutorial/course keywords analysis</li>
                <li>• Product/monetization indicators</li>
                <li>• Educational signal scoring</li>
                <li>• Niche classification system</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}