'use client';

import { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

export function ExportButton() {
  const [isExporting, setIsExporting] = useState(false);
  const searchParams = useSearchParams();

  const handleExport = async () => {
    try {
      setIsExporting(true);
      
      // Build the export URL with current filters
      const params = new URLSearchParams();
      searchParams.forEach((value, key) => {
        if (value) {
          params.set(key, value);
        }
      });

      const response = await fetch(`/api/youtube/packaging?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch data for export');
      }

      const result = await response.json();
      
      if (result.error || !result.data) {
        throw new Error(result.error || 'No data to export');
      }

      // Convert to CSV
      const csvData = convertToCSV(result.data);
      
      // Download CSV
      downloadCSV(csvData, 'packaging-analysis.csv');
      
      toast.success('Export completed successfully');
    } catch (error) {
      console.error('Export failed:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button onClick={handleExport} disabled={isExporting}>
      {isExporting ? (
        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
      ) : (
        <Download className="h-4 w-4 mr-2" />
      )}
      {isExporting ? 'Exporting...' : 'Export CSV'}
    </Button>
  );
}

function convertToCSV(data: any[]): string {
  if (!data.length) return '';

  const headers = [
    'Video ID',
    'Title',
    'Current Views',
    'Baseline Views',
    'Performance %',
    'Published Date',
    'Thumbnail URL'
  ];

  const rows = data.map(video => [
    video.id,
    `"${video.title.replace(/"/g, '""')}"`, // Escape quotes in title
    video.view_count,
    video.baseline_views,
    video.performance_percent,
    video.published_at,
    video.thumbnail_url
  ]);

  return [headers, ...rows]
    .map(row => row.join(','))
    .join('\n');
}

function downloadCSV(csvContent: string, filename: string) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}