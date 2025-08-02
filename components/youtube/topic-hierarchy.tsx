'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Tag, Layers, Hash } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

interface TopicNode {
  name: string;
  count: number;
  cluster_id?: number;
  children?: TopicNode[];
}

interface TopicHierarchyData {
  hierarchy: TopicNode[];
  totalClusters: number;
  totalVideos: number;
}

export function TopicHierarchy() {
  const [data, setData] = useState<TopicHierarchyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchTopicHierarchy();
  }, []);

  const fetchTopicHierarchy = async () => {
    try {
      const response = await fetch('/api/topics/hierarchy');
      const result = await response.json();
      setData(result);
      // Expand first few top-level nodes by default
      if (result.hierarchy.length > 0) {
        setExpandedNodes(new Set([result.hierarchy[0].name]));
      }
    } catch (error) {
      console.error('Error fetching topic hierarchy:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleNode = (nodePath: string) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodePath)) {
        newSet.delete(nodePath);
      } else {
        newSet.add(nodePath);
      }
      return newSet;
    });
  };

  const renderNode = (node: TopicNode, level: number = 0, path: string = '') => {
    const nodePath = path ? `${path}>${node.name}` : node.name;
    const isExpanded = expandedNodes.has(nodePath);
    const hasChildren = node.children && node.children.length > 0;
    const percentage = data ? (node.count / data.totalVideos) * 100 : 0;

    const levelColors = [
      'text-blue-500 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 dark:bg-blue-500/10 dark:hover:bg-blue-500/20',
      'text-purple-500 dark:text-purple-400 bg-purple-500/10 hover:bg-purple-500/20 dark:bg-purple-500/10 dark:hover:bg-purple-500/20',
      'text-green-500 dark:text-green-400 bg-green-500/10 hover:bg-green-500/20 dark:bg-green-500/10 dark:hover:bg-green-500/20'
    ];

    const levelIcons = [Layers, Tag, Hash];
    const Icon = levelIcons[level] || Hash;

    return (
      <div key={nodePath} className="w-full">
        <div
          className={cn(
            "flex items-center gap-2 py-2 px-3 rounded-md transition-colors cursor-pointer",
            levelColors[level] || 'text-gray-600 dark:text-gray-400 bg-gray-500/10 hover:bg-gray-500/20 dark:bg-gray-500/10 dark:hover:bg-gray-500/20'
          )}
          style={{ marginLeft: `${level * 24}px` }}
          onClick={() => hasChildren && toggleNode(nodePath)}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="h-4 w-4 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 flex-shrink-0" />
            )
          ) : (
            <div className="w-4" />
          )}
          
          <Icon className="h-4 w-4 flex-shrink-0" />
          
          <span className="flex-grow font-medium text-sm truncate">{node.name}</span>
          
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="text-xs bg-gray-800 dark:bg-gray-800 text-gray-200 dark:text-gray-200 border-gray-700">
              {node.count.toLocaleString()} videos
            </Badge>
            
            <div className="w-20">
              <Progress value={percentage} className="h-2" />
            </div>
            
            <span className="text-xs text-gray-500 dark:text-gray-400 w-12 text-right">
              {percentage.toFixed(1)}%
            </span>
          </div>
        </div>

        {hasChildren && isExpanded && (
          <div className="mt-1">
            {node.children!.map(child => 
              renderNode(child, level + 1, nodePath)
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Topic Hierarchy</CardTitle>
          <CardDescription>Loading BERTopic classification structure...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Topic Hierarchy</CardTitle>
          <CardDescription>Failed to load topic data</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Topic Hierarchy</CardTitle>
            <CardDescription>
              BERTopic classification with {data.totalClusters} clusters across {data.totalVideos.toLocaleString()} videos
            </CardDescription>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-blue-500 dark:text-blue-400" />
              <span className="text-gray-600 dark:text-gray-400">Domain</span>
            </div>
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-purple-500 dark:text-purple-400" />
              <span className="text-gray-600 dark:text-gray-400">Niche</span>
            </div>
            <div className="flex items-center gap-2">
              <Hash className="h-4 w-4 text-green-500 dark:text-green-400" />
              <span className="text-gray-600 dark:text-gray-400">Micro-topic</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="space-y-1 p-6">
          {data.hierarchy.map(node => renderNode(node))}
        </div>
      </CardContent>
    </Card>
  );
}