/**
 * Analytics Data Table Component
 * Displays video performance data using Shadcn DataTable pattern
 */

'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  useReactTable,
  SortingState,
  ColumnFiltersState,
} from '@tanstack/react-table';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { ArrowUpDown, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { VideoAnalytics } from './types';

export function AnalyticsDataTable() {
  const [data, setData] = useState<VideoAnalytics[]>([]);
  const [loading, setLoading] = useState(true);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [rowSelection, setRowSelection] = useState({});

  useEffect(() => {
    fetchVideoAnalytics();
  }, []);

  const fetchVideoAnalytics = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/youtube/analytics/videos');
      if (!response.ok) {
        throw new Error('Failed to fetch video analytics');
      }
      const videos = await response.json();
      setData(videos);
    } catch (error) {
      console.error('Error fetching video analytics:', error);
    } finally {
      setLoading(false);
    }
  };

  const columns: ColumnDef<VideoAnalytics>[] = useMemo(() => [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
      enableHiding: false,
    },
    {
      accessorKey: 'title',
      header: 'Video',
      cell: ({ row }) => {
        const title = row.getValue('title') as string;
        const videoId = row.original.video_id;
        return (
          <div className="space-y-1">
            <div className="font-medium line-clamp-2 max-w-xs">
              {title}
            </div>
            <div className="text-xs text-muted-foreground">
              {new Date(row.original.published_at).toLocaleDateString()}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: 'views',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Views
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => (
        <div className="font-medium">
          {row.getValue<number>('views').toLocaleString()}
        </div>
      ),
    },
    {
      accessorKey: 'ctr',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          CTR
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const ctr = row.getValue<number>('ctr');
        return ctr ? `${(ctr * 100).toFixed(1)}%` : 'N/A';
      },
    },
    {
      accessorKey: 'retention_avg',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Retention
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const retention = row.getValue<number>('retention_avg');
        return retention ? `${(retention * 100).toFixed(1)}%` : 'N/A';
      },
    },
    {
      id: 'trend',
      header: 'Trend',
      cell: ({ row }) => {
        const trend = row.original.trend_direction;
        const percentage = row.original.trend_percentage;
        
        return (
          <TrendBadge 
            direction={trend} 
            percentage={percentage} 
          />
        );
      },
    },
    {
      accessorKey: 'likes',
      header: ({ column }) => (
        <Button
          variant="ghost"
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
        >
          Likes
          <ArrowUpDown className="ml-2 h-4 w-4" />
        </Button>
      ),
      cell: ({ row }) => {
        const likes = row.getValue<number>('likes');
        return likes ? likes.toLocaleString() : 'N/A';
      },
    },
  ], []);

  const table = useReactTable({
    data,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: {
      sorting,
      columnFilters,
      rowSelection,
    },
    initialState: {
      pagination: {
        pageSize: 25,
      },
    },
  });

  if (loading) {
    return <DataTableSkeleton />;
  }

  return (
    <div className="space-y-4">
      {/* Filter Input */}
      <div className="flex items-center justify-between">
        <Input
          placeholder="Filter videos..."
          value={(table.getColumn('title')?.getFilterValue() as string) ?? ''}
          onChange={(event) =>
            table.getColumn('title')?.setFilterValue(event.target.value)
          }
          className="max-w-sm"
        />
        <div className="text-sm text-muted-foreground">
          {table.getFilteredSelectedRowModel().rows.length} of{' '}
          {table.getFilteredRowModel().rows.length} row(s) selected
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-end space-x-2">
        <div className="flex-1 text-sm text-muted-foreground">
          Page {table.getState().pagination.pageIndex + 1} of{' '}
          {table.getPageCount()}
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            <ChevronLeft className="h-4 w-4" />
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function TrendBadge({ 
  direction, 
  percentage 
}: { 
  direction: 'up' | 'down' | 'stable'; 
  percentage: number;
}) {
  if (direction === 'stable') {
    return (
      <Badge variant="secondary" className="space-x-1">
        <Minus className="h-3 w-3" />
        <span>Stable</span>
      </Badge>
    );
  }

  const isPositive = direction === 'up';
  const Icon = isPositive ? TrendingUp : TrendingDown;
  const variant = isPositive ? 'default' : 'destructive';

  return (
    <Badge variant={variant} className="space-x-1">
      <Icon className="h-3 w-3" />
      <span>{Math.abs(percentage).toFixed(1)}%</span>
    </Badge>
  );
}

function DataTableSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="h-8 w-64 bg-muted animate-pulse rounded" />
        <div className="h-8 w-24 bg-muted animate-pulse rounded" />
      </div>
      <div className="space-y-2">
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-16 w-full bg-muted animate-pulse rounded" />
        ))}
      </div>
    </div>
  );
}