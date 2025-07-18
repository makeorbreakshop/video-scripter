import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { DebugPanel } from '@/components/debug-panel';

describe('DebugPanel Component', () => {
  const mockDebugData = {
    threadExpansion: {
      threads: [
        {
          thread_name: 'how-to-tutorials',
          angle: 'Instructional content for skill building',
          intent: 'Learn specific techniques',
          queries: [
            'how to use woodworking tools',
            'woodworking tools tutorial',
            'woodworking tools for beginners guide'
          ],
          results_count: 150
        },
        {
          thread_name: 'tool-reviews',
          angle: 'Product evaluations and comparisons',
          intent: 'Make informed purchase decisions',
          queries: [
            'best woodworking tools review',
            'woodworking tools comparison'
          ],
          results_count: 120
        }
      ]
    },
    poolAndCluster: {
      totalPooled: 1500,
      performanceFiltered: 1200,
      deduplicated: 1000,
      clusters: [
        {
          cluster_id: 'cluster-1',
          size: 50,
          thread_overlap: 5,
          avg_performance: 3.2,
          is_wide: true,
          sample_titles: [
            'Top 10 Essential Woodworking Tools',
            'Must-Have Woodworking Tools for Beginners',
            'Best Woodworking Tools 2024'
          ],
          thread_sources: ['how-to', 'reviews', 'beginner', 'essential', 'top-lists']
        },
        {
          cluster_id: 'cluster-2',
          size: 30,
          thread_overlap: 2,
          avg_performance: 2.5,
          is_wide: false,
          sample_titles: [
            'Woodworking Safety Tips',
            'How to Maintain Your Tools'
          ],
          thread_sources: ['safety', 'maintenance']
        }
      ],
      clusteringMethod: 'DBSCAN',
      epsilon: 0.15,
      minPoints: 3,
      noisePoints: 50
    },
    embeddings: {
      queries: ['woodworking tools'],
      embeddings_generated: 1,
      dimensions: 512,
      model: 'text-embedding-3-small'
    },
    searchResults: {
      total_results: 1500,
      score_distribution: {
        '0.9-1.0': 10,
        '0.8-0.9': 150,
        '0.7-0.8': 500,
        '0.6-0.7': 600,
        '0.5-0.6': 240
      }
    },
    performance: {
      tiers: {
        outstanding: { count: 50, threshold: 5.0 },
        high: { count: 200, threshold: 3.0 },
        above_average: { count: 400, threshold: 2.0 },
        average: { count: 350, threshold: 1.0 }
      }
    },
    patterns: {
      total_patterns: 25,
      wide_patterns: 10,
      deep_patterns: 15,
      avg_confidence: 0.82
    },
    costs: {
      total: 0.025,
      breakdown: {
        'OpenAI Embeddings': 0.001,
        'OpenAI GPT-4o-mini': 0.02,
        'Pinecone Search': 0.004
      },
      timeline: {
        thread_expansion: 500,
        embeddings: 200,
        search: 2000,
        clustering: 1500,
        pattern_discovery: 3000,
        total: 7200
      }
    }
  };

  it('should render with closed state by default', () => {
    render(<DebugPanel isOpen={false} onToggle={() => {}} debugData={mockDebugData} />);
    
    expect(screen.queryByText('Thread Expansion')).not.toBeInTheDocument();
  });

  it('should show all tabs when open', () => {
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    expect(screen.getByText('Thread Expansion')).toBeInTheDocument();
    expect(screen.getByText('Embeddings')).toBeInTheDocument();
    expect(screen.getByText('Search Results')).toBeInTheDocument();
    expect(screen.getByText('Pool & Cluster')).toBeInTheDocument();
    expect(screen.getByText('Performance')).toBeInTheDocument();
    expect(screen.getByText('Patterns')).toBeInTheDocument();
    expect(screen.getByText('Costs & Timeline')).toBeInTheDocument();
  });

  it('should switch between tabs', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Initially on Thread Expansion tab
    expect(screen.getByText('15 search threads generated')).toBeInTheDocument();
    
    // Click Pool & Cluster tab
    await user.click(screen.getByText('Pool & Cluster'));
    
    // Should show cluster data
    expect(screen.getByText('Pooling Process')).toBeInTheDocument();
    expect(screen.getByText('1,500 videos from all threads')).toBeInTheDocument();
  });

  it('should display WIDE vs DEEP cluster badges', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Navigate to Pool & Cluster tab
    await user.click(screen.getByText('Pool & Cluster'));
    
    // Check for WIDE and DEEP badges
    expect(screen.getByText('🌐 WIDE')).toBeInTheDocument();
    expect(screen.getByText('🎯 DEEP')).toBeInTheDocument();
  });

  it('should show cost breakdown', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Navigate to Costs tab
    await user.click(screen.getByText('Costs & Timeline'));
    
    // Check cost display
    expect(screen.getByText('$0.025')).toBeInTheDocument();
    expect(screen.getByText('OpenAI GPT-4o-mini')).toBeInTheDocument();
    expect(screen.getByText('$0.020')).toBeInTheDocument();
  });

  it('should handle missing debug data gracefully', () => {
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={{}} />);
    
    // Should still render without crashing
    expect(screen.getByText('Thread Expansion')).toBeInTheDocument();
  });

  it('should display thread queries with expand/collapse', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Should show collapsed view with "... and X more"
    expect(screen.getByText(/how to use woodworking tools/)).toBeInTheDocument();
    expect(screen.queryByText(/woodworking tools for beginners guide/)).not.toBeInTheDocument();
  });

  it('should show clustering parameters', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Navigate to Pool & Cluster tab
    await user.click(screen.getByText('Pool & Cluster'));
    
    // Check DBSCAN parameters
    expect(screen.getByText('DBSCAN')).toBeInTheDocument();
    expect(screen.getByText('85% similarity')).toBeInTheDocument();
    expect(screen.getByText('Min 3 videos')).toBeInTheDocument();
  });

  it('should display performance timeline', async () => {
    const user = userEvent.setup();
    render(<DebugPanel isOpen={true} onToggle={() => {}} debugData={mockDebugData} />);
    
    // Navigate to Costs tab
    await user.click(screen.getByText('Costs & Timeline'));
    
    // Check timeline
    expect(screen.getByText('Total: 7.2s')).toBeInTheDocument();
    expect(screen.getByText('Pattern Discovery')).toBeInTheDocument();
    expect(screen.getByText('3.0s')).toBeInTheDocument();
  });
});