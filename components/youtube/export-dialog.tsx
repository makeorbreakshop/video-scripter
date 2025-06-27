/**
 * Export Dialog Component
 * Handles data export functionality using Shadcn Dialog patterns
 */

'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';
import { CalendarIcon, Download, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExportOptions } from './types';

export function ExportDialog() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportOptions, setExportOptions] = useState<ExportOptions>({
    format: 'csv',
    dateRange: {
      from: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
      to: new Date(),
    },
    includeMetrics: {
      views: true,
      ctr: true,
      retention: true,
      likes: true,
      comments: true,
    },
  });

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setExportProgress(0);

      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setExportProgress((prev) => {
          if (prev >= 90) {
            clearInterval(progressInterval);
            return prev;
          }
          return prev + 10;
        });
      }, 200);

      const response = await fetch('/api/youtube/analytics/export', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(exportOptions),
      });

      clearInterval(progressInterval);
      setExportProgress(100);

      if (!response.ok) {
        throw new Error('Export failed');
      }

      // Handle file download
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `youtube-analytics-${format(new Date(), 'yyyy-MM-dd')}.${exportOptions.format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: 'Export successful',
        description: 'Your analytics data has been downloaded.',
      });

      setIsOpen(false);

    } catch (error) {
      console.error('Export error:', error);
      toast({
        title: 'Export failed',
        description: 'There was an error exporting your data. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsExporting(false);
      setExportProgress(0);
    }
  };

  const handleMetricToggle = (metric: keyof ExportOptions['includeMetrics']) => {
    setExportOptions(prev => ({
      ...prev,
      includeMetrics: {
        ...prev.includeMetrics,
        [metric]: !prev.includeMetrics[metric],
      },
    }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Download className="h-4 w-4 mr-2" />
          Export Data
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Export Analytics Data</DialogTitle>
          <DialogDescription>
            Export your YouTube analytics data for external analysis or reporting.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Format Selection */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label htmlFor="format" className="text-right">
              Format
            </Label>
            <Select
              value={exportOptions.format}
              onValueChange={(value: 'csv' | 'json') =>
                setExportOptions(prev => ({ ...prev, format: value }))
              }
            >
              <SelectTrigger className="col-span-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    CSV
                  </div>
                </SelectItem>
                <SelectItem value="json">
                  <div className="flex items-center">
                    <FileText className="h-4 w-4 mr-2" />
                    JSON
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-4 items-center gap-4">
            <Label className="text-right">Date Range</Label>
            <div className="col-span-3 space-y-2">
              <div className="flex space-x-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !exportOptions.dateRange.from && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {exportOptions.dateRange.from ? (
                        format(exportOptions.dateRange.from, 'LLL dd, y')
                      ) : (
                        <span>From date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={exportOptions.dateRange.from}
                      onSelect={(date) =>
                        date &&
                        setExportOptions(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, from: date },
                        }))
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !exportOptions.dateRange.to && 'text-muted-foreground'
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {exportOptions.dateRange.to ? (
                        format(exportOptions.dateRange.to, 'LLL dd, y')
                      ) : (
                        <span>To date</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar
                      mode="single"
                      selected={exportOptions.dateRange.to}
                      onSelect={(date) =>
                        date &&
                        setExportOptions(prev => ({
                          ...prev,
                          dateRange: { ...prev.dateRange, to: date },
                        }))
                      }
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>

          {/* Metrics Selection */}
          <div className="grid grid-cols-4 items-start gap-4">
            <Label className="text-right mt-2">Include Metrics</Label>
            <div className="col-span-3 space-y-2">
              {Object.entries(exportOptions.includeMetrics).map(([metric, enabled]) => (
                <div key={metric} className="flex items-center space-x-2">
                  <Checkbox
                    id={metric}
                    checked={enabled}
                    onCheckedChange={() => handleMetricToggle(metric as keyof ExportOptions['includeMetrics'])}
                  />
                  <Label htmlFor={metric} className="capitalize">
                    {metric === 'ctr' ? 'CTR' : metric.replace('_', ' ')}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          {/* Export Progress */}
          {isExporting && (
            <div className="space-y-2">
              <Label>Export Progress</Label>
              <Progress value={exportProgress} className="w-full" />
              <p className="text-sm text-muted-foreground">
                {exportProgress < 100 ? 'Generating export...' : 'Download starting...'}
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end space-x-2">
          <Button variant="outline" onClick={() => setIsOpen(false)} disabled={isExporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={isExporting}>
            {isExporting ? 'Exporting...' : 'Export'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}