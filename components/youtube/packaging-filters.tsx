'use client';

import { useState, useCallback } from 'react';
import { Search, Filter, SortAsc } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usePackagingFilters } from '@/hooks/use-packaging-filters';
import { Badge } from '@/components/ui/badge';

export function PackagingFilters() {
  const {
    search,
    setSearch,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    performanceFilter,
    setPerformanceFilter,
    dateFilter,
    setDateFilter,
    competitorFilter,
    setCompetitorFilter,
    minViews,
    setMinViews,
    maxViews,
    setMaxViews,
    clearFilters,
    hasActiveFilters
  } = usePackagingFilters();

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, [setSearch]);

  const getSortLabel = () => {
    const labels = {
      'performance_percent': 'Performance %',
      'view_count': 'Views',
      'published_at': 'Date',
      'title': 'Title'
    };
    return labels[sortBy] || 'Performance %';
  };

  const getCompetitorLabel = () => {
    const labels = {
      'mine': 'My Videos',
      'competitors': 'Competitors',
      'all': 'All Videos'
    };
    return labels[competitorFilter] || 'My Videos';
  };

  const getPerformanceLabel = () => {
    const labels = {
      'excellent': 'Excellent',
      'good': 'Good',
      'average': 'Average', 
      'poor': 'Poor'
    };
    return performanceFilter ? labels[performanceFilter] : 'All Performance';
  };

  const getDateLabel = () => {
    const labels = {
      '30days': '30 Days',
      '3months': '3 Months', 
      '6months': '6 Months',
      '1year': '1 Year'
    };
    return dateFilter ? labels[dateFilter] : 'All Time';
  };

  return (
    <div className="flex flex-wrap items-center gap-2 py-2">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px] max-w-[400px]">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search video titles..."
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-10 text-sm h-9"
        />
      </div>

      {/* Sort */}
      <div className="flex items-center gap-1">
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-32 text-sm h-9 border-r-0 rounded-r-none bg-background">
            <SelectValue placeholder="Sort by..." className="text-foreground font-medium">
              {getSortLabel()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="performance_percent">Performance %</SelectItem>
            <SelectItem value="view_count">Views</SelectItem>
            <SelectItem value="published_at">Date</SelectItem>
            <SelectItem value="title">Title</SelectItem>
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="h-9 w-9 rounded-l-none border-l-0 bg-background"
          title={`Sort ${sortOrder === 'asc' ? 'descending' : 'ascending'}`}
        >
          <SortAsc className={`h-3 w-3 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
        </Button>
      </div>

      {/* Source Filter */}
      <Select value={competitorFilter || 'mine'} onValueChange={(value) => setCompetitorFilter(value as any)}>
        <SelectTrigger className="w-32 text-sm h-9 bg-background">
          <SelectValue placeholder="Source..." className="text-foreground font-medium">
            {getCompetitorLabel()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="mine">My Videos</SelectItem>
          <SelectItem value="competitors">Competitors</SelectItem>
          <SelectItem value="all">All Videos</SelectItem>
        </SelectContent>
      </Select>

      {/* Performance Filter */}
      <Select value={performanceFilter || 'all'} onValueChange={(value) => setPerformanceFilter(value === 'all' ? null : value)}>
        <SelectTrigger className="w-40 text-sm h-9 bg-background">
          <SelectValue placeholder="Performance..." className="text-foreground font-medium">
            {getPerformanceLabel()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Performance</SelectItem>
          <SelectItem value="excellent">Excellent (2.0x+)</SelectItem>
          <SelectItem value="good">Good (1.0-2.0x)</SelectItem>
          <SelectItem value="average">Average (0.5-1.0x)</SelectItem>
          <SelectItem value="poor">Poor (&lt;0.5x)</SelectItem>
        </SelectContent>
      </Select>

      {/* Date Filter */}
      <Select value={dateFilter || 'all'} onValueChange={(value) => setDateFilter(value === 'all' ? null : value)}>
        <SelectTrigger className="w-28 text-sm h-9 bg-background">
          <SelectValue placeholder="Time..." className="text-foreground font-medium">
            {getDateLabel()}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Time</SelectItem>
          <SelectItem value="30days">30 Days</SelectItem>
          <SelectItem value="3months">3 Months</SelectItem>
          <SelectItem value="6months">6 Months</SelectItem>
          <SelectItem value="1year">1 Year</SelectItem>
        </SelectContent>
      </Select>

      {/* View Count Filter */}
      <div className="flex items-center gap-1">
        <Input
          placeholder="Min views"
          value={minViews}
          onChange={(e) => setMinViews(e.target.value)}
          type="number"
          className="w-24 text-sm h-9"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          placeholder="Max views"
          value={maxViews}
          onChange={(e) => setMaxViews(e.target.value)}
          type="number"
          className="w-24 text-sm h-9"
        />
      </div>

      {/* Clear Filters */}
      {hasActiveFilters && (
        <Button 
          variant="outline" 
          size="sm"
          onClick={clearFilters} 
          className="h-9 w-9"
          title="Clear all filters"
        >
          ×
        </Button>
      )}
    </div>
  );
}