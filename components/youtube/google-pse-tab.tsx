'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { 
  Search, 
  Plus, 
  Play, 
  Trash2, 
  TrendingUp,
  Clock,
  CheckCircle,
  AlertCircle,
  Users,
  FileText,
  Copy
} from 'lucide-react';

interface DiscoveredChannel {
  name: string;
  url: string;
  channelId?: string;
  confidence: string;
  source: string;
  videoTitle?: string;
  videoUrl?: string;
  isNew: boolean;
  meetsFilters?: boolean;
  filterReasons?: string[];
  subscriberCount?: number;
  lastVideoDate?: string;
}

interface SearchResult {
  query: string;
  timestamp: string;
  channelsFound: number;
  channelsAdded: number;
  duplicates: number;
  filtered?: number;
  totalResults: number;
  channels?: DiscoveredChannel[];
  topResult?: {
    title: string;
    channelUrl?: string;
    confidence?: string;
    videoTitle?: string;
    subscribers: number;
    autoApproved: boolean;
  };
  rawResults?: any[]; // Raw Google PSE results for debugging
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
  const [debugMode, setDebugMode] = useState(false);
  const [expandedDebug, setExpandedDebug] = useState<number | null>(null);
  const [expandedResults, setExpandedResults] = useState<number[]>([]);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkSearchText, setBulkSearchText] = useState('');
  const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

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

  const runSingleSearch = async (query: string, isBatchMode: boolean = false) => {
    if (pseQuota.remaining <= 0) {
      alert('Daily quota exceeded!');
      return null;
    }

    if (!isBatchMode) {
      setIsSearching(true);
    }
    
    try {
      const response = await fetch('/api/google-pse/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, includeDebug: debugMode })
      });

      if (response.ok) {
        const data = await response.json();
        
        // Create the result object
        const newResult: SearchResult = {
          query,
          timestamp: new Date().toISOString(),
          channelsFound: data.channelsFound || 0,
          channelsAdded: data.channelsAdded || 0,
          duplicates: data.duplicates || 0,
          totalResults: data.totalResults || 0,
          channels: data.channels,
          topResult: data.topResult,
          rawResults: data.rawResults // Include raw results for debugging
        };
        
        // Only update results immediately if not in batch mode
        if (!isBatchMode) {
          setRecentResults(prev => [newResult, ...prev.slice(0, 9)]);
          // Update quota
          loadPSEQuota();
          loadWeeklyStats();
        }
        
        return newResult;
      }
      return null;
    } catch (error) {
      console.error('Search failed:', error);
      return null;
    } finally {
      if (!isBatchMode) {
        setIsSearching(false);
      }
    }
  };

  const runQueuedSearches = async () => {
    if (searchQueue.length === 0) return;
    
    setIsSearching(true);
    setBatchProgress({ current: 0, total: searchQueue.length });
    const batchResults: SearchResult[] = [];
    
    try {
      for (let i = 0; i < searchQueue.length; i++) {
        const query = searchQueue[i];
        setBatchProgress({ current: i + 1, total: searchQueue.length });
        
        const result = await runSingleSearch(query, true);
        if (result) {
          batchResults.push(result);
        }
        // Small delay between searches
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Add all results at once, preserving the order
      if (batchResults.length > 0) {
        setRecentResults(prev => [...batchResults.reverse(), ...prev].slice(0, 20));
      }
      
      // Update quota and stats once after all searches
      loadPSEQuota();
      loadWeeklyStats();
      
      setSearchQueue([]);
    } finally {
      setIsSearching(false);
      setBatchProgress({ current: 0, total: 0 });
    }
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

  const cleanSearchQuery = (line: string): string => {
    // Remove common list formats
    let cleaned = line.trim();
    
    // Remove numbered list formats like "1. ", "2) ", etc.
    cleaned = cleaned.replace(/^\d+[\.\)]\s*/, '');
    
    // Remove bullet points
    cleaned = cleaned.replace(/^[-*•]\s*/, '');
    
    // Remove surrounding quotes (both double and single, including smart quotes)
    cleaned = cleaned.replace(/^["'"'""](.*)["'"'""]$/, '$1');
    
    // Clean up any remaining quotes at start or end
    cleaned = cleaned.replace(/^["'"'""]|["'"'""]$/g, '');
    
    return cleaned.trim();
  };

  const handleBulkImport = () => {
    // Parse the bulk text input
    const lines = bulkSearchText
      .split('\n')
      .map(cleanSearchQuery)
      .filter(line => line.length > 0);
    
    // Remove duplicates and filter out queries already in queue
    const uniqueQueries = [...new Set(lines)];
    const newQueries = uniqueQueries.filter(q => !searchQueue.includes(q));
    
    if (newQueries.length > 0) {
      setSearchQueue([...searchQueue, ...newQueries]);
      setBulkSearchText('');
      setBulkModalOpen(false);
    }
  };

  // Get cleaned queries for preview
  const getCleanedQueries = () => {
    return bulkSearchText
      .split('\n')
      .map(cleanSearchQuery)
      .filter(line => line.length > 0);
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
            
            {/* Bulk Import Modal */}
            <Dialog open={bulkModalOpen} onOpenChange={setBulkModalOpen}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <FileText className="h-4 w-4 mr-1" />
                  Bulk Import
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Bulk Import Search Queries</DialogTitle>
                  <DialogDescription>
                    Paste multiple search queries (one per line). Duplicates will be automatically removed.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="bg-muted/50 p-3 rounded-lg border">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-sm font-medium">Example Format:</div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          const examples = [
                            "ASL sign language tutorials",
                            "braille reading lessons", 
                            "speed reading techniques",
                            "memory palace training",
                            "voice acting tutorials",
                            "beatboxing lessons",
                            "ventriloquism course",
                            "stand-up comedy masterclass",
                            "Etsy seller tutorials",
                            "Amazon FBA course",
                            "Shopify dropshipping guide",
                            "TikTok Shop tutorial"
                          ];
                          setBulkSearchText(examples.join('\n'));
                        }}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Copy Examples
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">
                      ASL sign language tutorials<br/>
                      braille reading lessons<br/>
                      speed reading techniques<br/>
                      memory palace training
                    </div>
                  </div>
                  
                  {/* Show cleaning preview if text contains common patterns */}
                  {bulkSearchText && (bulkSearchText.match(/^\s*\d+[\.\)]\s*/m) || bulkSearchText.includes('"')) && (
                    <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="text-sm font-medium text-blue-700 dark:text-blue-300 mb-2">
                        Preview after cleaning:
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-400 font-mono max-h-24 overflow-y-auto">
                        {getCleanedQueries().slice(0, 5).map((q, i) => (
                          <div key={i}>{q}</div>
                        ))}
                        {getCleanedQueries().length > 5 && (
                          <div className="text-blue-500 dark:text-blue-400">
                            ...and {getCleanedQueries().length - 5} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  
                  <Textarea
                    placeholder="Paste your search queries here..."
                    value={bulkSearchText}
                    onChange={(e) => setBulkSearchText(e.target.value)}
                    className="min-h-[300px] font-mono text-sm"
                  />
                  
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-muted-foreground">
                      {(() => {
                        const cleanedQueries = getCleanedQueries();
                        const newQueries = cleanedQueries.filter(q => !searchQueue.includes(q));
                        return (
                          <>
                            <span className="font-medium">{cleanedQueries.length}</span> queries detected
                            {cleanedQueries.length > 0 && (
                              <span className="ml-2">
                                ({newQueries.length} new)
                              </span>
                            )}
                          </>
                        );
                      })()}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setBulkSearchText('');
                          setBulkModalOpen(false);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleBulkImport}
                        disabled={!bulkSearchText.trim() || getCleanedQueries().length === 0}
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add to Queue
                      </Button>
                    </div>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
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
            <div className="flex items-center gap-4">
              {recentResults.length > 0 && (
                <div className="text-sm text-muted-foreground">
                  Last: "{recentResults[0].query}" ({recentResults[0].channelsFound} channels found, {recentResults[0].channelsAdded} new)
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDebugMode(!debugMode)}
                className={debugMode ? 'bg-blue-100 text-blue-700' : ''}
              >
                🐛 Debug {debugMode ? 'ON' : 'OFF'}
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
                      onClick={async () => {
                        const result = await runSingleSearch(query, false);
                        if (result) {
                          // Remove from queue after successful search
                          removeFromQueue(index);
                        }
                      }}
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
                  {isSearching && batchProgress.total > 0 ? (
                    <>
                      <div className="h-4 w-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Running {batchProgress.current}/{batchProgress.total}
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Run All ({searchQueue.length} searches)
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline"
                  onClick={() => setSearchQueue([])}
                  disabled={isSearching}
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
                  
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <div className="font-medium text-green-600">{result.channelsFound}</div>
                      <div className="text-muted-foreground">Found</div>
                    </div>
                    <div>
                      <div className="font-medium text-blue-600">{result.channelsAdded}</div>
                      <div className="text-muted-foreground">Added</div>
                    </div>
                    <div>
                      <div className="font-medium text-orange-600">{result.duplicates}</div>
                      <div className="text-muted-foreground">Duplicates</div>
                    </div>
                    <div>
                      <div className="font-medium text-red-600">{result.filtered || 0}</div>
                      <div className="text-muted-foreground">Filtered</div>
                    </div>
                  </div>
                  
                  {/* Collapsible channel details */}
                  <div className="mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (expandedResults.includes(index)) {
                          setExpandedResults(expandedResults.filter(i => i !== index));
                        } else {
                          setExpandedResults([...expandedResults, index]);
                        }
                      }}
                      className="text-sm"
                    >
                      {expandedResults.includes(index) ? '▼' : '▶'} 
                      {result.channels && result.channels.length > 0 
                        ? `Show ${result.channels.length} discovered channels`
                        : 'No channels found'}
                    </Button>
                  </div>

                  {/* Show discovered channels when expanded */}
                  {expandedResults.includes(index) && result.channels && result.channels.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="text-sm font-medium mb-2">Discovered Channels:</div>
                      <div className="space-y-2 max-h-60 overflow-y-auto">
                        {result.channels.map((channel, idx) => (
                          <div key={idx} className="p-2 bg-muted/30 rounded border text-sm">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="font-medium truncate">
                                  {channel.name}
                                  {channel.subscriberCount !== undefined && (
                                    <span className="text-xs text-muted-foreground ml-2">
                                      ({formatNumber(channel.subscriberCount)} subs)
                                    </span>
                                  )}
                                </div>
                                {channel.videoTitle && (
                                  <div className="text-xs text-muted-foreground truncate">
                                    From: "{channel.videoTitle}"
                                  </div>
                                )}
                                <div className="flex items-center gap-2 mt-1">
                                  <Badge 
                                    variant={channel.confidence === 'high' ? 'default' : 'secondary'}
                                    className="text-xs"
                                  >
                                    {channel.confidence}
                                  </Badge>
                                  <Badge 
                                    variant="outline" 
                                    className="text-xs"
                                  >
                                    {channel.source}
                                  </Badge>
                                  {channel.isNew ? (
                                    channel.meetsFilters === false ? (
                                      <Badge variant="destructive" className="text-xs">
                                        Filtered
                                      </Badge>
                                    ) : (
                                      <Badge className="text-xs bg-green-600">
                                        New
                                      </Badge>
                                    )
                                  ) : (
                                    <Badge variant="secondary" className="text-xs">
                                      Duplicate
                                    </Badge>
                                  )}
                                </div>
                                {channel.filterReasons && channel.filterReasons.length > 0 && (
                                  <div className="text-xs text-red-600 mt-1">
                                    {channel.filterReasons.join(', ')}
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-1">
                                {channel.videoUrl && (
                                  <a
                                    href={channel.videoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-500 hover:text-blue-600"
                                  >
                                    Video →
                                  </a>
                                )}
                                {channel.url && (
                                  <a
                                    href={channel.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs text-blue-500 hover:text-blue-600"
                                  >
                                    Channel →
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {/* Debug Mode: Show Raw Results */}
                  {debugMode && result.rawResults && (
                    <div className="mt-3 border-t pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedDebug(expandedDebug === index ? null : index)}
                        className="text-xs"
                      >
                        {expandedDebug === index ? '🔽' : '🔾'} Show Raw Google PSE Results ({result.rawResults.length} items)
                      </Button>
                      
                      {expandedDebug === index && (
                        <div className="mt-2 space-y-2">
                          <div className="text-xs font-medium text-muted-foreground mb-2">
                            Raw search results from Google PSE:
                          </div>
                          <div className="max-h-96 overflow-y-auto space-y-2">
                            {result.rawResults.map((item: any, idx: number) => (
                              <div key={idx} className="p-3 bg-muted/20 rounded text-xs space-y-1 border">
                                <div className="font-medium text-blue-600">
                                  #{idx + 1}: {item.title}
                                </div>
                                <div className="text-green-700 break-all">
                                  URL: {item.link}
                                </div>
                                <div className="text-gray-600 italic">
                                  Snippet: {item.snippet}
                                </div>
                                {item.pagemap && (
                                  <details className="mt-2">
                                    <summary className="cursor-pointer text-purple-600 font-medium">
                                      PageMap Data (structured data)
                                    </summary>
                                    <pre className="mt-1 p-2 bg-black/5 rounded overflow-x-auto text-[10px]">
                                      {JSON.stringify(item.pagemap, null, 2)}
                                    </pre>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

    </div>
  );
}