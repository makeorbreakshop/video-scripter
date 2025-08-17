'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase-client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AlertCircle, Plus, Search, Download, Calendar, Users, Eye, ThumbsUp, MessageCircle, Clock } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

interface CompetitorChannel {
  id: string;
  name: string;
  handle: string;
  subscriberCount: number;
  videoCount: number;
  lastImport: string;
  status: 'active' | 'importing' | 'failed';
  importProgress?: number;
  thumbnailUrl?: string;
}

interface SearchResult {
  channelId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount?: string;
  videoCount?: string;
  customUrl?: string;
  isAlreadyImported?: boolean;
  importSource?: 'competitor' | 'discovery' | null;
}

export default function CompetitorsPage() {
  const [channelInput, setChannelInput] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState('');
  const [competitorChannels, setCompetitorChannels] = useState<CompetitorChannel[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<SearchResult | null>(null);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [importedChannelIds, setImportedChannelIds] = useState<Set<string>>(new Set());
  const [channelSearchTerm, setChannelSearchTerm] = useState('');
  const { toast } = useToast();

  // Comprehensive educational channels directory (filtered to exclude imported ones)
  const allEducationalChannels = [
    // Science & STEM Education
    { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'Veritasium', category: 'Science & STEM', description: 'Science phenomena and experiments' },
    { id: 'UC6107grRI4m0o2-emgoDnAA', name: 'SmarterEveryDay', category: 'Science & STEM', description: 'Engineering and physics exploration' },
    { id: 'UCUHW94eEFW7hkUMVaZz4eDg', name: 'MinutePhysics', category: 'Science & STEM', description: 'Animated physics explanations' },
    { id: 'UCV5vCi3jPJdURZwAOO_FNfQ', name: 'The Thought Emporium', category: 'Science & STEM', description: 'DIY science experiments' },
    { id: 'UCivA7_KLKWo43tFcCkFvydw', name: 'Applied Science', category: 'Science & STEM', description: 'Advanced science and engineering' },
    { id: 'UC7DdEm33SyaTDtWYGO2CwdA', name: 'Physics Girl', category: 'Science & STEM', description: 'Physics made accessible' },
    { id: 'UCXgNowiGxwwnLeQ7DXTwXPg', name: 'The Science Asylum', category: 'Science & STEM', description: 'Physics and math concepts' },
    { id: 'UCEIwxahdLz7bap-VDs9h35A', name: 'Steve Mould', category: 'Science & STEM', description: 'Science experiments and explanations' },
    { id: 'UC1VLQPn9cYSqx8plbk9RxxQ', name: 'The Action Lab', category: 'Science & STEM', description: 'Physics experiments and demonstrations' },
    { id: 'UCtESv1e7ntJaLJYKIO1FoYw', name: 'Periodic Videos', category: 'Science & STEM', description: 'Chemistry and periodic table' },
    { id: 'UCFhXFikryT4aFcLkLw2LBLA', name: 'NileRed', category: 'Science & STEM', description: 'Chemistry experiments and reactions' },
    { id: 'UC2gXPH_9pqn8I5hbpzVNFHA', name: 'Cody\'sLab', category: 'Science & STEM', description: 'Science experiments and chemistry' },
    { id: 'UCJ0-OtVpF0wOKEqT2Z1HEtA', name: 'ElectroBOOM', category: 'Science & STEM', description: 'Electrical engineering and physics' },
    { id: 'UCMOqf8ab-42UUQIdVoKwjlQ', name: 'Practical Engineering', category: 'Science & STEM', description: 'Civil engineering concepts' },
    { id: 'UCR1IuLEqb6UEA_zQ81kwXfg', name: 'Real Engineering', category: 'Science & STEM', description: 'Engineering explanations' },
    { id: 'UCY1kMZp36IQSyNx_9h4mpCg', name: 'Mark Rober', category: 'Science & STEM', description: 'Engineering and invention' },
    { id: 'UCfMJ2MchTSW2kWaT0kK94Yw', name: 'William Osman', category: 'Science & STEM', description: 'Engineering and making' },
    { id: 'UCYO_jab_esuFRV4b17AJtAw', name: '3Blue1Brown', category: 'Science & STEM', description: 'Visual mathematics' },
    { id: 'UC4a-Gbdw7vOaccHmFo40b9g', name: 'Khan Academy', category: 'Science & STEM', description: 'Comprehensive education' },
    { id: 'UCoHhuummRZaIVX7bD4t2czg', name: 'Professor Leonard', category: 'Science & STEM', description: 'Calculus and algebra' },
    { id: 'UCFe6jenM1Bc54qtBsIJGRZQ', name: 'PatrickJMT', category: 'Science & STEM', description: 'Mathematics tutorials' },
    { id: 'UCoxcjq-8xIDTYp3uz647V5A', name: 'Numberphile', category: 'Science & STEM', description: 'Mathematics exploration' },
    { id: 'UC1_uAIS3r8Vu6JjXWvastJg', name: 'Mathologer', category: 'Science & STEM', description: 'Advanced mathematics' },
    { id: 'UCHnyfMqiRRG1u-2MsSQLbXA', name: 'MindYourDecisions', category: 'Science & STEM', description: 'Math puzzles and problems' },
    { id: 'UCEWpbFLzoYGPfuWUMFPSaoA', name: 'The Organic Chemistry Tutor', category: 'Science & STEM', description: 'Math and chemistry' },
    { id: 'UCvjgXvBlbQiydffZU7m1_aw', name: 'The Coding Train', category: 'Science & STEM', description: 'Creative coding' },
    { id: 'UC8butISFwT-Wl7EV0hUK0BQ', name: 'FreeCodeCamp', category: 'Science & STEM', description: 'Programming tutorials' },
    { id: 'UCcabW7890RKJzL968QWEykA', name: 'CS50', category: 'Science & STEM', description: 'Harvard computer science' },
    { id: 'UC29ju8bIPH5as8OGnQzwJyA', name: 'Traversy Media', category: 'Science & STEM', description: 'Web development' },
    { id: 'UCCezIgC97PvUuR4_gbFUs5g', name: 'Corey Schafer', category: 'Science & STEM', description: 'Python programming' },
    { id: 'UCWv7vMbMWH4-V0ZXdmDpPBA', name: 'Programming with Mosh', category: 'Science & STEM', description: 'Programming fundamentals' },
    { id: 'UC9-y-6csu5WGm29I7JiwpnA', name: 'Computerphile', category: 'Science & STEM', description: 'Computer science topics' },
    { id: 'UCEBb1b_L6zDS3xTUrIALZOw', name: 'MIT OpenCourseWare', category: 'Science & STEM', description: 'Computer science courses' },
    
    // History & Social Studies
    { id: 'UCX6b17PVsYBQ0ip5gyeme-Q', name: 'CrashCourse', category: 'History & Social Studies', description: 'Comprehensive world history' },
    { id: 'UCNIuvl7V8zACPpTmmNIqP2A', name: 'OverSimplified', category: 'History & Social Studies', description: 'Entertaining history summaries' },
    { id: 'UCCODtTcd5M1JavPCOr_Uydg', name: 'Extra Credits', category: 'History & Social Studies', description: 'Gaming and history' },
    { id: 'UCvPXiKxH-eH9xq-80vpgmKQ', name: 'Epic History TV', category: 'History & Social Studies', description: 'Documentary-style history' },
    { id: 'UCMmaBzfCCwZ2KqaBJjkj0fw', name: 'Kings and Generals', category: 'History & Social Studies', description: 'Military history' },
    { id: 'UC4sEmXUuWIFlxRIFBRV6VXQ', name: 'The History Guy', category: 'History & Social Studies', description: 'Forgotten history' },
    { id: 'UCc-N_gMU_EywuMSGZcUKGSg', name: 'Weird History', category: 'History & Social Studies', description: 'Unusual historical facts' },
    { id: 'UC510QYlOlKNyhy_zdQxnGYw', name: 'Simple History', category: 'History & Social Studies', description: 'Animated history' },
    { id: 'UC22BdTgxefuvUivrjesETjg', name: 'History Matters', category: 'History & Social Studies', description: 'Quick history explanations' },
    { id: 'UCHdluULl5c7bilx1x1TGzJQ', name: 'Feature History', category: 'History & Social Studies', description: 'Historical documentaries' },
    { id: 'UClfEht64_NRzQe2x1qGTXHg', name: 'AlternateHistoryHub', category: 'History & Social Studies', description: 'Alternative history scenarios' },
    { id: 'UCUcyEsEjhPEDf69RRVhRh4A', name: 'The Great War', category: 'History & Social Studies', description: 'World War I' },
    { id: 'UCLfMmOriSyPbd5JhHpnj4Ng', name: 'World War Two', category: 'History & Social Studies', description: 'World War II' },
    { id: 'UCRJkJVxaWqWYONZPQIXtZqg', name: 'History with Hilbert', category: 'History & Social Studies', description: 'European history' },
    { id: 'UCv_vLHiWVBh_FR9vbeuiY-A', name: 'Historia Civilis', category: 'History & Social Studies', description: 'Ancient Rome' },
    { id: 'UCwO-UgquohXwoe7f0e18FsA', name: 'Invicta', category: 'History & Social Studies', description: 'Ancient warfare' },
    { id: 'UCGzKdCfjMBy0cVEFwwqDJyQ', name: 'Heimler\'s History', category: 'History & Social Studies', description: 'AP US History' },
    { id: 'UCmmPgLsGAjJdiQD2BrFAFoQ', name: 'Geography Now', category: 'History & Social Studies', description: 'Countries and geography' },
    { id: 'UC9RM-iSvTu1uPJb8X5yp3EQ', name: 'Wendover Productions', category: 'History & Social Studies', description: 'Geography and logistics' },
    { id: 'UCP5tjEmvPItGyLhmjdwP7Ww', name: 'RealLifeLore', category: 'History & Social Studies', description: 'Geography and facts' },
    { id: 'UCuCkxoKLYO_EQ2GeFtbM_bw', name: 'Half as Interesting', category: 'History & Social Studies', description: 'Geography and trivia' },
    { id: 'UCz1oFxMrgrQ82-276UCOU9w', name: 'Atlas Pro', category: 'History & Social Studies', description: 'Geography and mapping' },
    { id: 'UCGc8ZVCsrR3dAuhvUbkbToQ', name: 'CityBeautiful', category: 'History & Social Studies', description: 'Urban geography' },
    { id: 'UC0intLFzLaudFG-xAvUEO-A', name: 'NotJustBikes', category: 'History & Social Studies', description: 'Urban planning and transport' },
    
    // Business & Personal Development
    { id: 'UCctXZhXmG-kf3tlIXgVZUlw', name: 'GaryVee', category: 'Business & Personal Development', description: 'Entrepreneurship and marketing' },
    { id: 'UCa-ckhlKL98F8OYCEHD8prg', name: 'Graham Stephan', category: 'Business & Personal Development', description: 'Real estate and finance' },
    { id: 'UCcefcZRL2oaA_uBNeo5UOWg', name: 'Y Combinator', category: 'Business & Personal Development', description: 'Startup advice' },
    { id: 'UCJ24N4O0bP7LGLBDvye7oCA', name: 'Matt D\'Avella', category: 'Business & Personal Development', description: 'Minimalism and productivity' },
    { id: 'UCG-KntY7aVnIGXYEBQvmBAQ', name: 'Thomas Frank', category: 'Business & Personal Development', description: 'Study and productivity' },
    { id: 'UCoOae5nYA7VqaXzerajD0lg', name: 'Ali Abdaal', category: 'Business & Personal Development', description: 'Productivity and learning' },
    { id: 'UCaP7wJdLDhIMR7XrumP7JVA', name: 'Better Ideas', category: 'Business & Personal Development', description: 'Self-improvement' },
    { id: 'UCU_W0oE_ock8bWKjALiGs8Q', name: 'Charisma on Command', category: 'Business & Personal Development', description: 'Social psychology' },
    { id: 'UCkJEpR7JmS36tajD34Gp4VA', name: 'Psych2Go', category: 'Business & Personal Development', description: 'Psychology education' },
    { id: 'UCyIe-61Y8C4_o-zZCtO4ETQ', name: 'The School of Life', category: 'Business & Personal Development', description: 'Philosophy and psychology' },
    { id: 'UCL_f53ZEJxp8TtlOkHwMV9Q', name: 'Jordan Peterson', category: 'Business & Personal Development', description: 'Psychology and philosophy' },
    { id: 'UCfMJ2MchTSW2kWaT0kK94Yw', name: 'Big Think', category: 'Business & Personal Development', description: 'Ideas and philosophy' },
    
    // Arts & Creative Education
    { id: 'UClM2LuQ1q5WEc23462tQzBg', name: 'Proko', category: 'Arts & Creative Education', description: 'Drawing and art instruction' },
    { id: 'UC5sWKjzfOZKQfDfTDfkUNqg', name: 'Art for Kids Hub', category: 'Arts & Creative Education', description: 'Art for children' },
    { id: 'UCHu2KNu6TtJ0p4hpSW7Yv7Q', name: 'Draw with Jazza', category: 'Arts & Creative Education', description: 'Drawing tutorials' },
    { id: 'UCJquYOG5EL82sKTfH9aMA9Q', name: 'Rick Beato', category: 'Arts & Creative Education', description: 'Music theory' },
    { id: 'UClyI3lFEWW6qxE2hFl9XXZQ', name: 'The Futur', category: 'Arts & Creative Education', description: 'Design education' },
    { id: 'UC5_SBQbLA9Kg7Jh5GpXoP3g', name: 'Adobe Creative Cloud', category: 'Arts & Creative Education', description: 'Design software' },
    { id: 'UCBJycsmduvYEL83R_U4JriQ', name: 'Marques Brownlee', category: 'Arts & Creative Education', description: 'Technology reviews' },
    { id: 'UCXuqSBlHAE6Xw-yeJA0Tunw', name: 'Linus Tech Tips', category: 'Arts & Creative Education', description: 'Technology reviews' },
    { id: 'UCBa659QWEk1AI4Tg--mrJ2A', name: 'Tom Scott', category: 'Arts & Creative Education', description: 'Technology and science' },
    { id: 'UCbfYPyITQ-7l4upoX8nvctg', name: 'Two Minute Papers', category: 'Arts & Creative Education', description: 'AI and research' },
    { id: 'UC4QZ_LsYcvcq7qOsOhpAX4A', name: 'ColdFusion', category: 'Arts & Creative Education', description: 'Technology history' },
    
    // Health & Specialized Content
    { id: 'UCbpMy0Fg74eXXkvXkjKgpwQ', name: 'Bon Appétit', category: 'Health & Specialized Content', description: 'Cooking instruction' },
    { id: 'UCJFp8uSYCjXOMnkUyb3CQ3Q', name: 'Tasty', category: 'Health & Specialized Content', description: 'Recipe tutorials' },
    { id: 'UCJHA_jMfCvEnv-3kRjTCQXw', name: 'Binging with Babish', category: 'Health & Specialized Content', description: 'Cooking entertainment' },
    { id: 'UChBEbMKI1eCcejTtmI32UEw', name: 'Joshua Weissman', category: 'Health & Specialized Content', description: 'Cooking techniques' },
    { id: 'UC9_p50tH3WmMslWRWKnM7dQ', name: 'Adam Ragusea', category: 'Health & Specialized Content', description: 'Food science' },
    { id: 'UCDq5v10l4wkV5-ZBIJJFbzQ', name: 'Ethan Chlebowski', category: 'Health & Specialized Content', description: 'Cooking education' },
    { id: 'UCzH5n3Ih5kgQoiDAQt2FwLw', name: 'Pro Home Cooks', category: 'Health & Specialized Content', description: 'Home cooking' },
    { id: 'UCRIZtPl9nb9RiXc9btSTQNw', name: 'Food Wishes', category: 'Health & Specialized Content', description: 'Cooking recipes' },
    { id: 'UCdauVhUKNsG9t5PNdyJ9hLQ', name: 'Maangchi', category: 'Health & Specialized Content', description: 'Korean cooking' },
    { id: 'UCfE5Cl3JBkD1LOmFIqc5DfQ', name: 'Guga Foods', category: 'Health & Specialized Content', description: 'Cooking experiments' },
  ];

  // Filter out channels that are already imported
  const availableChannels = allEducationalChannels.filter(channel => 
    !importedChannelIds.has(channel.id)
  );

  // Group channels by category
  const channelsByCategory = availableChannels.reduce((acc: Record<string, typeof availableChannels>, channel) => {
    if (!acc[channel.category]) {
      acc[channel.category] = [];
    }
    acc[channel.category].push(channel);
    return acc;
  }, {} as Record<string, typeof availableChannels>);

  // Prevent hydration issues by only rendering after mount
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Re-trigger render when mounted to format dates properly
  useEffect(() => {
    if (isMounted && competitorChannels.length > 0) {
      // Force a re-render to update date formatting
      setCompetitorChannels([...competitorChannels]);
    }
  }, [isMounted]);

  // Load competitor channels on mount (no auth required)
  useEffect(() => {
    loadCompetitorChannels();
  }, []);

  const loadCompetitorChannels = async () => {
    try {
      const response = await fetch('/api/youtube/competitor-channels');
      if (!response.ok) {
        throw new Error('Failed to fetch competitor channels');
      }
      
      const { channels } = await response.json();

      console.log('🔍 Channels loaded from API:', channels?.length);
      console.log('🔍 Raw channel data:', channels?.[0]);
      
      // Set channels directly without date formatting initially
      const formattedChannels: CompetitorChannel[] = channels?.map((channel: any) => ({
        ...channel,
        lastImport: channel.lastImport // Keep raw date for now
      })) || [];

      console.log('🔍 Final channels array:', formattedChannels.map(c => ({ name: c.name, lastImport: c.lastImport })));
      setCompetitorChannels(formattedChannels);
      
      // Update imported channel IDs for duplicate detection
      const importedIds = new Set(formattedChannels.map(c => c.id));
      setImportedChannelIds(importedIds);
    } catch (error) {
      console.error('Error loading competitor channels:', error);
      console.error('Error details:', JSON.stringify(error, null, 2));
      toast({
        title: 'Error',
        description: 'Failed to load competitor channels',
        variant: 'destructive'
      });
    }
  };

  const formatTimeAgo = (dateString: string) => {
    if (!dateString) return 'No date';
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return 'Invalid date';
      // Use ISO date format for consistency
      return date.toISOString().split('T')[0];
    } catch (error) {
      return 'Invalid date';
    }
  };

  const parseYouTubeChannelUrl = (input: string): { channelId?: string, username?: string, handle?: string } | null => {
    try {
      // Handle different YouTube channel URL formats
      const patterns = [
        // https://www.youtube.com/channel/CHANNEL_ID
        /youtube\.com\/channel\/([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/c/USERNAME
        /youtube\.com\/c\/([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/@HANDLE
        /youtube\.com\/@([a-zA-Z0-9_-]+)/,
        // https://www.youtube.com/user/USERNAME
        /youtube\.com\/user\/([a-zA-Z0-9_-]+)/,
        // Direct channel ID (UC...)
        /^(UC[a-zA-Z0-9_-]{22})$/
      ];

      for (const [index, pattern] of patterns.entries()) {
        const match = input.match(pattern);
        if (match) {
          const value = match[1];
          
          // Pattern 0 and 4 are channel IDs
          if (index === 0 || index === 4) {
            return { channelId: value };
          }
          // Pattern 1 is custom URL (c/username)
          else if (index === 1) {
            return { username: value };
          }
          // Pattern 2 is @handle
          else if (index === 2) {
            return { handle: value };
          }
          // Pattern 3 is user/username
          else if (index === 3) {
            return { username: value };
          }
        }
      }
    } catch (error) {
      console.error('Error parsing YouTube URL:', error);
    }
    
    return null;
  };

  const handleDirectUrlImport = async () => {
    if (!channelInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a YouTube channel URL',
        variant: 'destructive'
      });
      return;
    }

    // Check if it's a YouTube URL
    if (!channelInput.includes('youtube.com/')) {
      // Fall back to search functionality
      await handleSearchChannels();
      return;
    }

    setIsImporting(true);
    setImportProgress(10);
    setImportMessage('Extracting channel information...');

    try {
      // Step 1: Extract channel ID from URL
      const scrapeResponse = await fetch('/api/youtube/scrape-channel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: channelInput.trim()
        }),
      });

      const scrapeResult = await scrapeResponse.json();
      console.log('Scrape result:', scrapeResult);

      if (!scrapeResponse.ok || !scrapeResult.channelId) {
        throw new Error(scrapeResult.error || 'Failed to extract channel information');
      }

      setImportProgress(30);
      setImportMessage('Checking if channel already exists...');

      // Force a small delay to ensure UI updates
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check if channel is already imported (returned by scrape endpoint)
      if (scrapeResult.isAlreadyImported) {
        console.log('Channel is already imported, source:', scrapeResult.importSource);
        
        const displaySource = scrapeResult.importSource === 'competitor' 
          ? 'Competitor System'
          : scrapeResult.importSource === 'discovery'
          ? 'Discovery System'
          : 'System';
        
        // Update UI to show the channel exists
        setImportMessage(`⚠️ Channel already exists in ${displaySource}`);
        setImportProgress(100);
        setIsImporting(false); // Allow button to be clickable again
        
        // Don't use toast, just show in the progress bar
        console.log('UI updated with exists message');
        
        // Don't reset immediately - let user see the message
        // They can clear it by typing a new URL
        return;
      }

      setImportProgress(50);
      setImportMessage('Starting import process...');

      // Step 3: Import using the unified import endpoint with duplicate checking
      const importResponse = await fetch('/api/video-import/unified', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'competitor',
          channelIds: [scrapeResult.channelId],
          options: {
            timePeriod: 'all',
            excludeShorts: true,
            batchSize: 50
          }
        }),
      });

      setImportProgress(90);
      setImportMessage('Finalizing import...');

      const importResult = await importResponse.json();

      if (!importResponse.ok) {
        throw new Error(importResult.error || 'Failed to import channel');
      }

      // Check if channel was skipped
      if (importResult.status === 'skipped') {
        toast({
          title: 'Channel Already Imported',
          description: 'This channel has already been fully imported',
          variant: 'destructive'
        });
        setImportProgress(0);
        setChannelInput('');
        setImportMessage('');
        return;
      }
      
      // Check if it's a queued job response
      if (importResult.jobId || importResult.status === 'queued') {
        toast({
          title: 'Import Started',
          description: `Processing channel in background. You can start another import!`,
        });
        setImportProgress(100);
        // Reset UI immediately so user can start another import
        setTimeout(() => {
          setChannelInput('');
          setImportProgress(0);
        }, 1000);
      } else {
        // Legacy sync response
        setImportProgress(100);
        toast({
          title: 'Success!',
          description: importResult.message || `Imported ${importResult.imported_videos || 0} videos from the channel`,
        });
      }

      // Reset form and reload channels
      setChannelInput('');
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: (error as Error).message || 'Failed to import channel',
        variant: 'destructive'
      });
    } finally {
      // Only reset if not handled by async response
      setIsImporting(false);
      setImportProgress(0);
      setImportMessage('');
    }
  };

  const handleSearchChannels = async () => {
    if (!channelInput.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a search term or YouTube channel URL',
        variant: 'destructive'
      });
      return;
    }

    setIsSearching(true);
    setSearchResults([]);

    // Regular search
    await performChannelSearch(channelInput.trim());
  };

  const performChannelSearch = async (query: string) => {
    try {
      const response = await fetch('/api/youtube/search-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: query
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to search channels');
      }

      // Sort results by subscriber count (highest first)
      const sortedChannels = (result.channels || []).sort((a: any, b: any) => {
        const aCount = parseInt(a.subscriberCount || '0');
        const bCount = parseInt(b.subscriberCount || '0');
        return bCount - aCount;
      });

      // Check which channels are already in the system
      const checkResponse = await fetch('/api/youtube/check-existing-channels', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelIds: sortedChannels.map((c: any) => c.channelId)
        }),
      });

      let channelsWithImportStatus = sortedChannels;
      
      if (checkResponse.ok) {
        const checkResult = await checkResponse.json();
        channelsWithImportStatus = sortedChannels.map((channel: any) => {
          const status = checkResult.channelStatus?.find((s: any) => s.channelId === channel.channelId);
          return {
            ...channel,
            isAlreadyImported: status?.isExisting || false,
            importSource: status?.source || null
          };
        });
      } else {
        // Fallback to local check for competitor channels only
        channelsWithImportStatus = sortedChannels.map((channel: any) => ({
          ...channel,
          isAlreadyImported: importedChannelIds.has(channel.channelId),
          importSource: importedChannelIds.has(channel.channelId) ? 'competitor' : null
        }));
      }
      
      setSearchResults(channelsWithImportStatus);
      setShowSearchResults(true);

      if (!result.channels || result.channels.length === 0) {
        toast({
          title: 'No Results',
          description: 'No channels found for your search term',
          variant: 'default'
        });
      }

    } catch (error) {
      console.error('Search error:', error);
      toast({
        title: 'Search Failed',
        description: (error as Error).message || 'Failed to search for channels',
        variant: 'destructive'
      });
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectChannel = (channel: SearchResult) => {
    if (channel.isAlreadyImported) {
      const sourceMessage = channel.importSource === 'competitor' 
        ? 'is already imported as a competitor' 
        : channel.importSource === 'discovery'
        ? 'is already in your discovery system'
        : 'is already in your system';
      
      toast({
        title: 'Channel Already Imported',
        description: `${channel.title} ${sourceMessage}`,
        variant: 'destructive'
      });
      return;
    }
    
    setSelectedChannel(channel);
    setShowSearchResults(false);
    getChannelPreviewStats(channel.channelId);
    toast({
      title: 'Channel Selected',
      description: `Selected: ${channel.title}`,
      variant: 'default'
    });
  };

  const getChannelPreviewStats = async (channelId: string) => {
    try {
      const response = await fetch('/api/youtube/channel-preview-stats', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId,
          timePeriod: 'all',
          excludeShorts: true
        }),
      });

      const result = await response.json();
      if (response.ok) {
        console.log('Channel preview stats:', result);
      }
    } catch (error) {
      console.error('Error getting channel preview stats:', error);
    }
  };

  const handleImportChannel = async () => {
    console.log('handleImportChannel called');
    console.log('selectedChannel:', selectedChannel);
    
    if (!selectedChannel) {
      toast({
        title: 'Error',
        description: 'Please search for and select a channel first',
        variant: 'destructive'
      });
      return;
    }
    
    // No authentication required for this dev tool
    
    setIsImporting(true);
    setImportProgress(0);
    
    try {
      // Start progress simulation
      const progressInterval = setInterval(() => {
        setImportProgress(prev => Math.min(prev + 5, 90));
      }, 200);

      const response = await fetch('/api/youtube/import-competitor', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channelId: selectedChannel.channelId,
          channelName: selectedChannel.title,
          timePeriod: 'all',
          maxVideos: 'all',
          excludeShorts: true,
          userId: '00000000-0000-0000-0000-000000000000'
        }),
      });

      clearInterval(progressInterval);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to import channel');
      }

      // Check if it's a queued job response
      if (result.jobId || result.status === 'queued') {
        toast({
          title: 'Import Started',
          description: `Processing ${selectedChannel.title} in background. You can start another import!`,
        });
        setImportProgress(100);
        // Reset UI immediately so user can start another import
        setTimeout(() => {
          setSelectedChannel(null);
          setChannelInput('');
          setSearchResults([]);
          setShowSearchResults(false);
          setImportProgress(0);
          setIsImporting(false);
        }, 1000);
      } else {
        // Legacy sync response
        setImportProgress(100);
        toast({
          title: 'Success!',
          description: result.message || `Imported ${result.imported_videos} videos`,
        });
        // Reset form normally after sync import
        setChannelInput('');
        setSelectedChannel(null);
        setShowSearchResults(false);
        setSearchResults([]);
      }
      await loadCompetitorChannels();

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: 'Import Failed',
        description: (error as Error).message || 'Failed to import competitor channel',
        variant: 'destructive'
      });
    } finally {
      // Only reset if not handled by async response
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
  };

  const filteredChannels = competitorChannels.filter(channel => {
    if (!channelSearchTerm) return true;
    const searchLower = channelSearchTerm.toLowerCase();
    return (
      (channel.name && channel.name.toLowerCase().includes(searchLower)) ||
      (channel.handle && channel.handle.toLowerCase().includes(searchLower)) ||
      (channel.id && channel.id.toLowerCase().includes(searchLower))
    );
  });

  const handleChannelClick = (channelId: string) => {
    window.open(`/dashboard/youtube/channels/${channelId}`, '_blank');
  };

  // Removed handleRefreshChannel function as refresh buttons are no longer needed

  // Prevent hydration mismatch by waiting for client-side mount
  if (!isMounted) {
    return (
      <div className="container mx-auto max-w-7xl space-y-6 p-6">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Competitor Analysis</h1>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-7xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Competitor Analysis</h1>
        <p className="text-muted-foreground">
          Import and analyze competitor YouTube channels to understand their content strategies
        </p>
      </div>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="import">Import Channel</TabsTrigger>
          <TabsTrigger value="imported">Imported Channels ({competitorChannels.length})</TabsTrigger>
          <TabsTrigger value="search">Search Channels</TabsTrigger>
          <TabsTrigger value="suggested">Suggested Channels</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Import New Competitor Channel</CardTitle>
              <CardDescription>
                Add a YouTube channel to analyze their videos and performance
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="channel-url">Channel URL or Search Term</Label>
                <div className="flex gap-2">
                  <Input
                    id="channel-url"
                    placeholder="https://www.youtube.com/@channelname or search term"
                    value={channelInput}
                    onChange={(e) => {
                      setChannelInput(e.target.value);
                      // Clear any existing error messages when user types
                      if (importMessage?.includes('⚠️')) {
                        setImportProgress(0);
                        setImportMessage('');
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isImporting) {
                        if (channelInput.includes('youtube.com/')) {
                          handleDirectUrlImport();
                        } else {
                          handleSearchChannels();
                        }
                      }
                    }}
                    disabled={isImporting}
                  />
                  {channelInput.includes('youtube.com/') ? (
                    <Button 
                      onClick={handleDirectUrlImport} 
                      disabled={isImporting || !channelInput.trim()}
                    >
                      {isImporting ? (
                        <>
                          <AlertCircle className="mr-2 h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Import Channel
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button 
                      onClick={handleSearchChannels} 
                      disabled={isSearching || !channelInput.trim()}
                    >
                      {isSearching ? (
                        <>
                          <AlertCircle className="mr-2 h-4 w-4 animate-spin" />
                          Searching...
                        </>
                      ) : (
                        <>
                          <Search className="mr-2 h-4 w-4" />
                          Search
                        </>
                      )}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  Examples: https://www.youtube.com/@mkbhd or "tech reviews"
                </p>
              </div>

              {importProgress > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className={importMessage?.includes('⚠️') ? 'text-orange-500 font-medium' : ''}>
                      {importMessage || 'Import Progress'}
                    </span>
                    <span className={importMessage?.includes('⚠️') ? 'text-orange-500' : ''}>
                      {importProgress}%
                    </span>
                  </div>
                  <Progress 
                    value={importProgress} 
                    className={importMessage?.includes('⚠️') ? '[&>div]:bg-orange-500' : ''}
                  />
                </div>
              )}

              {showSearchResults && searchResults.length > 0 && (
                <div className="space-y-2">
                  <Label>Search Results</Label>
                  <div className="rounded-md border p-2 space-y-2 max-h-64 overflow-y-auto">
                    {searchResults.map((channel) => (
                      <div
                        key={channel.channelId}
                        className={`flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer ${
                          channel.isAlreadyImported ? 'opacity-60' : ''
                        }`}
                        onClick={() => handleSelectChannel(channel)}
                      >
                        <div className="flex items-center gap-3">
                          {channel.thumbnailUrl ? (
                            <img
                              src={channel.thumbnailUrl}
                              alt={channel.title}
                              className="h-10 w-10 rounded-full"
                            />
                          ) : (
                            <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full" />
                          )}
                          <div>
                            <p className="font-medium">{channel.title}</p>
                            <p className="text-sm text-muted-foreground">
                              {channel.subscriberCount || 'N/A'} subscribers
                            </p>
                          </div>
                        </div>
                        {channel.isAlreadyImported && (
                          <Badge variant="secondary">
                            {channel.importSource === 'competitor' ? 'Competitor' : 
                             channel.importSource === 'discovery' ? 'Discovery' : 'Imported'}
                          </Badge>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {selectedChannel && (
                <Card className="border-primary">
                  <CardHeader>
                    <CardTitle>Selected Channel</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center gap-3">
                      {selectedChannel.thumbnailUrl ? (
                        <img
                          src={selectedChannel.thumbnailUrl}
                          alt={selectedChannel.title}
                          className="h-16 w-16 rounded-full"
                        />
                      ) : (
                        <div className="h-16 w-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full" />
                      )}
                      <div>
                        <h3 className="font-semibold text-lg">{selectedChannel.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          {selectedChannel.subscriberCount || 'N/A'} subscribers • {selectedChannel.videoCount || 'N/A'} videos
                        </p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-sm">{selectedChannel.description}</p>
                      {selectedChannel.customUrl && (
                        <p className="text-sm text-muted-foreground">@{selectedChannel.customUrl}</p>
                      )}
                    </div>
                    <Button 
                      onClick={handleImportChannel} 
                      disabled={isImporting}
                      className="w-full"
                    >
                      {isImporting ? (
                        <>
                          <AlertCircle className="mr-2 h-4 w-4 animate-spin" />
                          Importing...
                        </>
                      ) : (
                        <>
                          <Plus className="mr-2 h-4 w-4" />
                          Import This Channel
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="imported" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Imported Competitor Channels</CardTitle>
              <CardDescription>
                Channels you've imported for competitive analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              {competitorChannels.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No competitor channels imported yet</p>
                  <p className="text-sm mt-2">Import channels from the Import tab to get started</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="mb-4">
                    <Input
                      placeholder="Search imported channels..."
                      value={channelSearchTerm}
                      onChange={(e) => setChannelSearchTerm(e.target.value)}
                      className="max-w-sm"
                    />
                  </div>
                  {filteredChannels.map((channel) => (
                    <div
                      key={channel.id}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => handleChannelClick(channel.id)}
                    >
                      <div className="flex items-center gap-4">
                        {channel.thumbnailUrl ? (
                          <img
                            src={channel.thumbnailUrl}
                            alt={channel.name}
                            className="h-12 w-12 rounded-full"
                          />
                        ) : (
                          <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                            {channel.name?.charAt(0).toUpperCase() || '?'}
                          </div>
                        )}
                        <div>
                          <h3 className="font-medium">{channel.name || 'Unknown Channel'}</h3>
                          <p className="text-sm text-muted-foreground">
                            {channel.handle ? `@${channel.handle}` : channel.id}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="font-medium">{formatNumber(channel.subscriberCount || 0)}</p>
                          <p className="text-sm text-muted-foreground">subscribers</p>
                        </div>
                        <div className="text-right">
                          <p className="font-medium">{formatNumber(channel.videoCount || 0)}</p>
                          <p className="text-sm text-muted-foreground">videos</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">
                            Last import: {formatTimeAgo(channel.lastImport)}
                          </p>
                          <Badge variant={channel.status === 'active' ? 'default' : 'secondary'}>
                            {channel.status}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Discover YouTube Channels</CardTitle>
              <CardDescription>
                Search for YouTube channels to analyze and import
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    placeholder="Search for channels (e.g., 'tech reviews', 'cooking tutorials')"
                    value={channelInput}
                    onChange={(e) => setChannelInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isSearching) {
                        handleSearchChannels();
                      }
                    }}
                  />
                  <Button onClick={handleSearchChannels} disabled={isSearching}>
                    {isSearching ? (
                      <>
                        <AlertCircle className="mr-2 h-4 w-4 animate-spin" />
                        Searching...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Search
                      </>
                    )}
                  </Button>
                </div>

                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="font-medium">Search Results ({searchResults.length})</h3>
                    <div className="grid gap-2">
                      {searchResults.map((channel) => (
                        <Card 
                          key={channel.channelId} 
                          className={`cursor-pointer hover:shadow-md transition-shadow ${
                            channel.isAlreadyImported ? 'opacity-60' : ''
                          }`}
                          onClick={() => window.open(`/dashboard/youtube/channels/${channel.channelId}`, '_blank')}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {channel.thumbnailUrl ? (
                                  <img
                                    src={channel.thumbnailUrl}
                                    alt={channel.title}
                                    className="h-12 w-12 rounded-full"
                                  />
                                ) : (
                                  <div className="h-12 w-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full" />
                                )}
                                <div>
                                  <h4 className="font-medium">{channel.title}</h4>
                                  <p className="text-sm text-muted-foreground line-clamp-1">
                                    {channel.description}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {channel.subscriberCount || 'N/A'} subscribers • {channel.videoCount || 'N/A'} videos
                                  </p>
                                </div>
                              </div>
                              {channel.isAlreadyImported ? (
                                <div className="flex items-center gap-2">
                                  <Badge variant="secondary">
                                    {channel.importSource === 'competitor' ? 'Competitor' : 
                                     channel.importSource === 'discovery' ? 'Discovery' : 'Imported'}
                                  </Badge>
                                  <Button 
                                    size="sm" 
                                    variant="outline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      window.open(`/dashboard/youtube/channels/${channel.channelId}`, '_blank');
                                    }}
                                  >
                                    View
                                  </Button>
                                </div>
                              ) : (
                                <Button 
                                  size="sm" 
                                  variant="outline"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectChannel(channel);
                                  }}
                                >
                                  Select
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="suggested" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Suggested Educational Channels</CardTitle>
              <CardDescription>
                Curated list of teaching-style channels similar to Ed Lawrence's approach
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {Object.entries(channelsByCategory).map(([category, channels]) => (
                <div key={category} className="space-y-3">
                  <h3 className="font-semibold text-lg">{category}</h3>
                  <div className="grid gap-2">
                    {channels.map((channel) => (
                      <div key={channel.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                            {channel.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <h4 className="font-medium">{channel.name}</h4>
                            <p className="text-sm text-muted-foreground">{channel.description}</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setChannelInput(`https://www.youtube.com/channel/${channel.id}`);
                            const importTab = document.querySelector('[value="import"]') as HTMLElement;
                            importTab?.click();
                          }}
                        >
                          Import
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}