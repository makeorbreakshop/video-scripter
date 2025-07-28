'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Search, 
  Plus, 
  Play, 
  Trash2, 
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Users
} from 'lucide-react';

interface SearchResult {
  query: string;
  timestamp: string;
  channelsFound: number;
  channelsAdded: number;
  duplicates: number;
  topResult?: {
    title: string;
    subscribers: number;
    autoApproved: boolean;
  };
}

interface PSEQuota {
  used: number;
  remaining: number;
  total: number;
}

interface WeeklyStats {
  searchesPerformed: number;
  searchesLimit: number;
  channelsDiscovered: number;
  approvalRate: number;
  bestSearch: {
    query: string;
    channelsFound: number;
  };
}

export function GooglePSETab() {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchQueue, setSearchQueue] = useState<string[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [recentResults, setRecentResults] = useState<SearchResult[]>([]);
  const [pseQuota, setPseQuota] = useState<PSEQuota>({ used: 0, remaining: 100, total: 100 });
  const [weeklyStats, setWeeklyStats] = useState<WeeklyStats>({
    searchesPerformed: 0,
    searchesLimit: 700,
    channelsDiscovered: 0,
    approvalRate: 0,
    bestSearch: { query: '', channelsFound: 0 }
  });

  useEffect(() => {
    loadPSEQuota();
    loadRecentResults();
    loadWeeklyStats();
  }, []);

  const loadPSEQuota = async () => {
    try {
      const response = await fetch('/api/google-pse/quota');
      if (response.ok) {
        const data = await response.json();
        setPseQuota(data.quota);
      }
    } catch (error) {
      console.error('Error loading PSE quota:', error);
    }
  };

  const loadRecentResults = async () => {
    try {
      const response = await fetch('/api/google-pse/recent-results');
      if (response.ok) {
        const data = await response.json();
        setRecentResults(data.results || []);
      }
    } catch (error) {
      console.error('Error loading recent results:', error);
    }
  };

  const loadWeeklyStats = async () => {
    try {
      const response = await fetch('/api/google-pse/weekly-stats');
      if (response.ok) {
        const data = await response.json();
        setWeeklyStats(data.stats);
      }
    } catch (error) {
      console.error('Error loading weekly stats:', error);
    }
  };

  const addToQueue = () => {
    if (searchQuery.trim() && !searchQueue.includes(searchQuery.trim())) {
      setSearchQueue([...searchQueue, searchQuery.trim()]);
      setSearchQuery('');
    }
  };

  const removeFromQueue = (index: number) => {
    setSearchQueue(searchQueue.filter((_, i) => i !== index));
  };

  const runSingleSearch = async (query: string) => {
    if (pseQuota.remaining <= 0) {
      alert('Daily quota exceeded!');
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetch('/api/google-pse/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Add to recent results
        const newResult: SearchResult = {
          query,
          timestamp: new Date().toISOString(),
          channelsFound: data.channelsFound || 0,
          channelsAdded: data.channelsAdded || 0,
          duplicates: data.duplicates || 0,
          topResult: data.topResult
        };
        
        setRecentResults([newResult, ...recentResults.slice(0, 4)]);
        
        // Update quota
        loadPSEQuota();
        loadWeeklyStats();
      }
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const runQueuedSearches = async () => {
    if (searchQueue.length === 0) return;
    
    for (const query of searchQueue) {
      await runSingleSearch(query);
      // Small delay between searches
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    setSearchQueue([]);
  };

  const addQuickSearch = (query: string) => {
    if (!searchQueue.includes(query)) {
      setSearchQueue([...searchQueue, query]);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  return (
    <div className="space-y-6">
      {/* Search Execution Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Run Searches
          </CardTitle>
          <CardDescription>
            Execute Google PSE searches to discover new educational channels
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Search Input */}
          <div className="flex gap-2">
            <Input
              placeholder="Enter search query (e.g., 'machine learning tutorial')"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && addToQueue()}
              className="flex-1"
            />
            <Button onClick={addToQueue} disabled={!searchQuery.trim()}>
              <Plus className="h-4 w-4 mr-1" />
              Add to Queue
            </Button>
            <Button 
              onClick={() => runSingleSearch(searchQuery)}
              disabled={!searchQuery.trim() || isSearching || pseQuota.remaining <= 0}
              variant="default"
            >
              <Search className="h-4 w-4 mr-1" />
              Search Now
            </Button>
          </div>

          {/* Quota Status */}
          <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
            <div className="flex items-center gap-4">
              <div>
                <div className="text-sm font-medium">Daily Quota</div>
                <div className="text-lg font-bold">
                  {pseQuota.used}/{pseQuota.total} searches used
                </div>
              </div>
              <div className="w-24 bg-muted rounded-full h-2">
                <div 
                  className={`h-2 rounded-full ${
                    pseQuota.used / pseQuota.total > 0.8 ? 'bg-red-500' :
                    pseQuota.used / pseQuota.total > 0.6 ? 'bg-yellow-500' : 'bg-green-500'
                  }`}
                  style={{ width: `${(pseQuota.used / pseQuota.total) * 100}%` }}
                />
              </div>
            </div>
            {recentResults.length > 0 && (
              <div className="text-sm text-muted-foreground">
                Last: "{recentResults[0].query}" ({recentResults[0].channelsFound} channels found)
              </div>
            )}
          </div>

          {/* Quick Searches */}
          <div className="space-y-2">
            <div className="text-sm font-medium">Quick Searches:</div>
            <div className="flex gap-2 flex-wrap">
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => addQuickSearch('trending educational topics')}
              >
                <TrendingUp className="h-3 w-3 mr-1" />
                Trending Topics
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => addQuickSearch('competitor analysis channels')}
              >
                <Users className="h-3 w-3 mr-1" />
                Competitor Analysis
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => addQuickSearch('deep dive tutorials')}
              >
                <Search className="h-3 w-3 mr-1" />
                Topic Deep Dive
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Planned Search Queue
          </CardTitle>
          <CardDescription>
            {searchQueue.length} searches queued for execution
          </CardDescription>
        </CardHeader>
        <CardContent>
          {searchQueue.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No searches queued. Add some search queries above.
            </div>
          ) : (
            <div className="space-y-3">
              {searchQueue.map((query, index) => (
                <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center font-medium">
                      {index + 1}
                    </div>
                    <span className="font-medium">"{query}"</span>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => runSingleSearch(query)}
                      disabled={isSearching || pseQuota.remaining <= 0}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFromQueue(index)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              
              <div className="flex gap-2 pt-3 border-t">
                <Button 
                  onClick={runQueuedSearches}
                  disabled={isSearching || pseQuota.remaining < searchQueue.length}
                  className="flex-1"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Run All ({searchQueue.length} searches)
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setSearchQueue([])}
                >
                  Clear Queue
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Recent Search Results
          </CardTitle>
          <CardDescription>
            Results from your latest searches
          </CardDescription>
        </CardHeader>
        <CardContent>
          {recentResults.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No recent searches. Run some searches to see results here.
            </div>
          ) : (
            <div className="space-y-4">
              {recentResults.map((result, index) => (
                <div key={index} className="p-4 border rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        "{result.query}"
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {new Date(result.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <div className="font-medium text-green-600">{result.channelsFound}</div>
                      <div className="text-muted-foreground">Channels Found</div>
                    </div>
                    <div>
                      <div className="font-medium text-blue-600">{result.channelsAdded}</div>
                      <div className="text-muted-foreground">New Channels</div>
                    </div>
                    <div>
                      <div className="font-medium text-orange-600">{result.duplicates}</div>
                      <div className="text-muted-foreground">Duplicates</div>
                    </div>
                  </div>
                  
                  {result.topResult && (
                    <div className="mt-3 p-3 bg-muted/30 rounded border">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium">{result.topResult.title}</div>
                          <div className="text-sm text-muted-foreground">
                            {formatNumber(result.topResult.subscribers)} subscribers
                          </div>
                        </div>
                        {result.topResult.autoApproved && (
                          <Badge variant="default" className="bg-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Auto-approved
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Weekly Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            This Week's Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold">{weeklyStats.searchesPerformed}</div>
              <div className="text-sm text-muted-foreground">
                /{weeklyStats.searchesLimit} searches
              </div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{weeklyStats.channelsDiscovered}</div>
              <div className="text-sm text-muted-foreground">Channels Discovered</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{Math.round(weeklyStats.approvalRate)}%</div>
              <div className="text-sm text-muted-foreground">Approval Rate</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-bold text-purple-600">{weeklyStats.bestSearch.channelsFound}</div>
              <div className="text-sm text-muted-foreground">
                Best: "{weeklyStats.bestSearch.query}"
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}