import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { act } from 'react';

// Mock the components we're testing
jest.mock('next/link', () => {
  return ({ children, href }: any) => <a href={href}>{children}</a>;
});

// Mock fetch for API calls
global.fetch = jest.fn();

// Import the component we're testing
import TitleGeneratorPage from '@/app/title-generator/page';

describe('Title Generator Page E2E Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  describe('Initial Page Load', () => {
    it('should render the title generator form', () => {
      render(<TitleGeneratorPage />);
      
      expect(screen.getByText('Semantic Title Generator')).toBeInTheDocument();
      expect(screen.getByPlaceholderText('e.g., best woodworking tools for beginners')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /generate titles/i })).toBeInTheDocument();
    });

    it('should show the info cards', () => {
      render(<TitleGeneratorPage />);
      
      expect(screen.getByText(/How it works/i)).toBeInTheDocument();
      expect(screen.getByText(/Pool-and-Cluster Architecture/i)).toBeInTheDocument();
      expect(screen.getByText(/Pattern Classification/i)).toBeInTheDocument();
    });
  });

  describe('Form Interaction', () => {
    it('should enable submit button when concept is entered', async () => {
      const user = userEvent.setup();
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      const submitButton = screen.getByRole('button', { name: /generate titles/i });
      
      // Initially disabled
      expect(submitButton).toBeDisabled();
      
      // Type in the input
      await user.type(input, 'woodworking tools');
      
      // Should be enabled now
      expect(submitButton).not.toBeDisabled();
    });

    it('should clear input when clear button is clicked', async () => {
      const user = userEvent.setup();
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners') as HTMLInputElement;
      
      // Type in the input
      await user.type(input, 'woodworking tools');
      expect(input.value).toBe('woodworking tools');
      
      // Click clear
      const clearButton = screen.getByRole('button', { name: /clear/i });
      await user.click(clearButton);
      
      // Should be cleared
      expect(input.value).toBe('');
    });
  });

  describe('API Integration', () => {
    it('should show loading state during API call', async () => {
      const user = userEvent.setup();
      
      // Mock API response with delay
      (global.fetch as jest.Mock).mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve({
          ok: true,
          json: async () => ({ suggestions: [] })
        }), 100))
      );
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      const submitButton = screen.getByRole('button', { name: /generate titles/i });
      
      await user.type(input, 'woodworking tools');
      await user.click(submitButton);
      
      // Should show loading states
      expect(screen.getByText(/Searching pattern database.../i)).toBeInTheDocument();
      
      // Wait for API to complete
      await waitFor(() => {
        expect(screen.queryByText(/Searching pattern database.../i)).not.toBeInTheDocument();
      });
    });

    it('should display error message on API failure', async () => {
      const user = userEvent.setup();
      
      // Mock API error
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('API Error'));
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      const submitButton = screen.getByRole('button', { name: /generate titles/i });
      
      await user.type(input, 'woodworking tools');
      await user.click(submitButton);
      
      // Should show error
      await waitFor(() => {
        expect(screen.getByText(/Failed to generate titles/i)).toBeInTheDocument();
      });
    });
  });

  describe('Results Display', () => {
    const mockSuccessResponse = {
      suggestions: [
        {
          title: 'Top 10 Woodworking Tools Every Beginner Must Have',
          pattern: {
            id: '1',
            name: 'Top [Number] [Items] Every [Audience] Must Have',
            performance_lift: 3.5,
            examples: ['Example 1', 'Example 2'],
            pattern_type: 'WIDE',
            thread_count: 5,
            found_by_threads: ['how-to', 'beginner', 'essential']
          },
          evidence: {
            confidence_score: 0.85,
            sample_size: 25,
            evidence_summary: 'Strong performance across multiple channels'
          }
        },
        {
          title: 'Essential Woodworking Tools for Beginners',
          pattern: {
            id: '2',
            name: 'Essential [Topic] for [Audience]',
            performance_lift: 2.8,
            examples: ['Example 3', 'Example 4'],
            pattern_type: 'DEEP',
            thread_count: 2,
            found_by_threads: ['essential', 'beginner']
          },
          evidence: {
            confidence_score: 0.75,
            sample_size: 15,
            evidence_summary: 'Consistent performance in niche'
          }
        }
      ],
      debug: {
        searchStats: {
          totalVideos: 1500,
          totalQueries: 90,
          avgVideosPerQuery: 16.7
        }
      }
    };

    it('should display title suggestions with pattern types', async () => {
      const user = userEvent.setup();
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse
      });
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      const submitButton = screen.getByRole('button', { name: /generate titles/i });
      
      await user.type(input, 'woodworking tools');
      await user.click(submitButton);
      
      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Top 10 Woodworking Tools Every Beginner Must Have')).toBeInTheDocument();
      });
      
      // Check WIDE pattern badge
      expect(screen.getByText('🌐 WIDE')).toBeInTheDocument();
      expect(screen.getByText('3.5x')).toBeInTheDocument();
      
      // Check DEEP pattern badge
      expect(screen.getByText('🎯 DEEP')).toBeInTheDocument();
      expect(screen.getByText('2.8x')).toBeInTheDocument();
    });

    it('should allow copying titles to clipboard', async () => {
      const user = userEvent.setup();
      
      // Mock clipboard API
      Object.assign(navigator, {
        clipboard: {
          writeText: jest.fn().mockResolvedValue(undefined)
        }
      });
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse
      });
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      await user.type(input, 'woodworking tools');
      await user.click(screen.getByRole('button', { name: /generate titles/i }));
      
      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Top 10 Woodworking Tools Every Beginner Must Have')).toBeInTheDocument();
      });
      
      // Click copy button (find by the Copy icon)
      const copyButtons = screen.getAllByRole('button', { name: /copy/i });
      await user.click(copyButtons[0]);
      
      // Should have copied to clipboard
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Top 10 Woodworking Tools Every Beginner Must Have');
    });

    it('should show thread provenance on expand', async () => {
      const user = userEvent.setup();
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse
      });
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      await user.type(input, 'woodworking tools');
      await user.click(screen.getByRole('button', { name: /generate titles/i }));
      
      // Wait for results
      await waitFor(() => {
        expect(screen.getByText('Top 10 Woodworking Tools Every Beginner Must Have')).toBeInTheDocument();
      });
      
      // Click expand button
      const expandButtons = screen.getAllByRole('button', { name: /show details/i });
      await user.click(expandButtons[0]);
      
      // Should show thread information
      await waitFor(() => {
        expect(screen.getByText(/Found by 5 threads/i)).toBeInTheDocument();
        expect(screen.getByText('how-to')).toBeInTheDocument();
        expect(screen.getByText('beginner')).toBeInTheDocument();
        expect(screen.getByText('essential')).toBeInTheDocument();
      });
    });
  });

  describe('Debug Panel', () => {
    it('should toggle debug panel visibility', async () => {
      const user = userEvent.setup();
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          suggestions: [],
          debug: {
            threadExpansion: { threads: [] },
            poolAndCluster: { clusters: [] }
          }
        })
      });
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      await user.type(input, 'woodworking tools');
      await user.click(screen.getByRole('button', { name: /generate titles/i }));
      
      // Wait for results
      await waitFor(() => {
        expect(screen.getByText(/0 title suggestions found/i)).toBeInTheDocument();
      });
      
      // Toggle debug panel
      const debugToggle = screen.getByRole('button', { name: /show debug info/i });
      await user.click(debugToggle);
      
      // Should show debug tabs
      expect(screen.getByText('Thread Expansion')).toBeInTheDocument();
      expect(screen.getByText('Pool & Cluster')).toBeInTheDocument();
    });
  });

  describe('Search Stats Display', () => {
    it('should display search statistics after results', async () => {
      const user = userEvent.setup();
      
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => mockSuccessResponse
      });
      
      render(<TitleGeneratorPage />);
      
      const input = screen.getByPlaceholderText('e.g., best woodworking tools for beginners');
      await user.type(input, 'woodworking tools');
      await user.click(screen.getByRole('button', { name: /generate titles/i }));
      
      // Wait for results and stats
      await waitFor(() => {
        expect(screen.getByText(/1,500 videos analyzed/i)).toBeInTheDocument();
        expect(screen.getByText(/90 queries executed/i)).toBeInTheDocument();
      });
    });
  });
});