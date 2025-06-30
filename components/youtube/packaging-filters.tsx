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
    clearFilters,
    hasActiveFilters
  } = usePackagingFilters();

  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
  }, [setSearch]);

  return (
    <div className="space-y-4">
      {/* Main Filter Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search video titles..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Sort */}
        <div className="flex gap-2">
          <Select value={sortBy} onValueChange={setSortBy}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="performance_percent">Performance %</SelectItem>
              <SelectItem value="view_count">View Count</SelectItem>
              <SelectItem value="published_at">Date Published</SelectItem>
              <SelectItem value="title">Title A-Z</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="icon"
            onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
            className="shrink-0"
          >
            <SortAsc className={`h-4 w-4 transition-transform ${sortOrder === 'desc' ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Secondary Filter Row */}
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Performance Filter */}
        <Select value={performanceFilter || 'all'} onValueChange={(value) => setPerformanceFilter(value === 'all' ? null : value)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Performance Range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Performance</SelectItem>
            <SelectItem value="excellent">Excellent (+2.0+)</SelectItem>
            <SelectItem value="good">Good (0 to +2.0)</SelectItem>
            <SelectItem value="average">Average (-0.5 to 0)</SelectItem>
            <SelectItem value="poor">Poor ({"<"}-0.5)</SelectItem>
          </SelectContent>
        </Select>

        {/* Date Filter */}
        <Select value={dateFilter || 'all'} onValueChange={(value) => setDateFilter(value === 'all' ? null : value)}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Date Range" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="30days">Last 30 Days</SelectItem>
            <SelectItem value="3months">Last 3 Months</SelectItem>
            <SelectItem value="6months">Last 6 Months</SelectItem>
            <SelectItem value="1year">Last Year</SelectItem>
          </SelectContent>
        </Select>

        {/* Clear Filters */}
        {hasActiveFilters && (
          <Button variant="outline" onClick={clearFilters} className="shrink-0">
            <Filter className="h-4 w-4 mr-2" />
            Clear Filters
          </Button>
        )}
      </div>

      {/* Active Filters Display */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-2">
          {search && (
            <Badge variant="secondary">
              Search: {search}
            </Badge>
          )}
          {performanceFilter && (
            <Badge variant="secondary">
              Performance: {performanceFilter}
            </Badge>
          )}
          {dateFilter && (
            <Badge variant="secondary">
              Date: {dateFilter}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}