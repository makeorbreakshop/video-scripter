import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SearchStats } from '@/components/search-stats';

describe('SearchStats Component', () => {
  const mockStats = {
    totalVideos: 1523,
    totalQueries: 90,
    avgVideosPerQuery: 16.9
  };

  it('should display all statistics', () => {
    render(<SearchStats stats={mockStats} />);
    
    expect(screen.getByText('1,523 videos analyzed')).toBeInTheDocument();
    expect(screen.getByText('90 queries executed')).toBeInTheDocument();
    expect(screen.getByText('16.9 videos/query avg')).toBeInTheDocument();
  });

  it('should format large numbers with commas', () => {
    render(<SearchStats stats={{ totalVideos: 10000, totalQueries: 100, avgVideosPerQuery: 100 }} />);
    
    expect(screen.getByText('10,000 videos analyzed')).toBeInTheDocument();
  });

  it('should handle zero values', () => {
    render(<SearchStats stats={{ totalVideos: 0, totalQueries: 0, avgVideosPerQuery: 0 }} />);
    
    expect(screen.getByText('0 videos analyzed')).toBeInTheDocument();
    expect(screen.getByText('0 queries executed')).toBeInTheDocument();
    expect(screen.getByText('0 videos/query avg')).toBeInTheDocument();
  });

  it('should display icons for each stat', () => {
    const { container } = render(<SearchStats stats={mockStats} />);
    
    // Check for presence of icons (using lucide-react icon classes)
    expect(container.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3);
  });
});