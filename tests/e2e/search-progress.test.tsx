import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SearchProgress } from '@/components/search-progress';

describe('SearchProgress Component', () => {
  it('should show initial searching state', () => {
    render(<SearchProgress currentStep="searching" />);
    
    expect(screen.getByText('Searching pattern database...')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('should show clustering state', () => {
    render(<SearchProgress currentStep="clustering" videosFound={1500} />);
    
    expect(screen.getByText('Clustering 1,500 videos by content similarity...')).toBeInTheDocument();
  });

  it('should show analyzing state', () => {
    render(<SearchProgress currentStep="analyzing" clustersFound={15} />);
    
    expect(screen.getByText('Analyzing 15 content clusters for patterns...')).toBeInTheDocument();
  });

  it('should show generating state', () => {
    render(<SearchProgress currentStep="generating" patternsFound={25} />);
    
    expect(screen.getByText('Generating titles from 25 patterns...')).toBeInTheDocument();
  });

  it('should handle missing counts gracefully', () => {
    render(<SearchProgress currentStep="clustering" />);
    
    expect(screen.getByText('Clustering videos by content similarity...')).toBeInTheDocument();
  });

  it('should display all progress steps', () => {
    render(<SearchProgress currentStep="analyzing" videosFound={1000} clustersFound={10} />);
    
    // Check all steps are visible
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Cluster')).toBeInTheDocument();
    expect(screen.getByText('Analyze')).toBeInTheDocument();
    expect(screen.getByText('Generate')).toBeInTheDocument();
  });

  it('should highlight the current step', () => {
    const { container } = render(<SearchProgress currentStep="clustering" />);
    
    // Check that clustering step has active styling
    const clusterStep = screen.getByText('Cluster').closest('div');
    expect(clusterStep).toHaveClass('text-primary');
  });
});