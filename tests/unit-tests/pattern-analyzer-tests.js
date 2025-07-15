/**
 * Unit Tests for Individual Pattern Analyzers
 * Tests each analyzer in isolation with controlled test data
 */

import { PatternDiscoveryService } from '../../lib/pattern-discovery-service.ts';
import dotenv from 'dotenv';

dotenv.config();

// Test data fixtures
const testVideos = {
  titlePatterns: [
    {
      id: 'vid1',
      title: 'How to Build a Bookshelf for Beginners',
      view_count: 50000,
      rolling_baseline_views: 20000,
      channel_avg_views: 25000,
      published_at: '2024-01-15T10:00:00Z',
      format_type: 'tutorial',
      duration: 'PT15M30S',
      topic_cluster: 'woodworking_beginner'
    },
    {
      id: 'vid2',
      title: 'Beginner Guide to Router Basics',
      view_count: 60000,
      rolling_baseline_views: 25000,
      channel_avg_views: 22000,
      published_at: '2024-01-20T14:30:00Z',
      format_type: 'tutorial',
      duration: 'PT18M20S',
      topic_cluster: 'woodworking_beginner'
    },
    {
      id: 'vid3',
      title: 'Essential Beginner Woodworking Tools',
      view_count: 70000,
      rolling_baseline_views: 30000,
      channel_avg_views: 28000,
      published_at: '2024-01-25T09:15:00Z',
      format_type: 'listicle',
      duration: 'PT12M45S',
      topic_cluster: 'woodworking_beginner'
    },
    {
      id: 'vid4',
      title: '5 Beginner Mistakes I Made Woodworking',
      view_count: 80000,
      rolling_baseline_views: 20000,
      channel_avg_views: 25000,
      published_at: '2024-01-30T11:00:00Z',
      format_type: 'listicle',
      duration: 'PT14M10S',
      topic_cluster: 'woodworking_beginner'
    }
  ],

  structurePatterns: [
    {
      id: 'vid5',
      title: 'Quick DIY Project',
      view_count: 30000,
      rolling_baseline_views: 15000,
      channel_avg_views: 18000,
      published_at: '2024-01-10T16:00:00Z',
      format_type: 'tutorial',
      duration: 'PT8M30S',
      topic_cluster: 'diy_quick'
    },
    {
      id: 'vid6',
      title: 'Ultimate Guide to Advanced Woodworking Techniques',
      view_count: 25000,
      rolling_baseline_views: 20000,
      channel_avg_views: 22000,
      published_at: '2024-01-12T13:45:00Z',
      format_type: 'tutorial',
      duration: 'PT35M15S',
      topic_cluster: 'woodworking_advanced'
    },
    {
      id: 'vid7',
      title: 'How to Fix Your Broken Table?',
      view_count: 45000,
      rolling_baseline_views: 18000,
      channel_avg_views: 20000,
      published_at: '2024-01-14T10:30:00Z',
      format_type: 'repair',
      duration: 'PT11M20S',
      topic_cluster: 'furniture_repair'
    },
    {
      id: 'vid8',
      title: 'AMAZING Woodworking Transformation!',
      view_count: 55000,
      rolling_baseline_views: 25000,
      channel_avg_views: 28000,
      published_at: '2024-01-16T15:20:00Z',
      format_type: 'transformation',
      duration: 'PT16M45S',
      topic_cluster: 'woodworking_transformation'
    }
  ],

  durationPatterns: [
    {
      id: 'vid9',
      title: 'Quick 5-Minute Fix',
      view_count: 40000,
      rolling_baseline_views: 20000,
      channel_avg_views: 22000,
      published_at: '2024-01-08T12:00:00Z',
      format_type: 'tutorial',
      duration: 'PT5M30S',
      topic_cluster: 'quick_fixes'
    },
    {
      id: 'vid10',
      title: 'Detailed Cabinet Build',
      view_count: 35000,
      rolling_baseline_views: 25000,
      channel_avg_views: 28000,
      published_at: '2024-01-18T09:30:00Z',
      format_type: 'tutorial',
      duration: 'PT45M20S',
      topic_cluster: 'cabinet_making'
    },
    {
      id: 'vid11',
      title: 'Perfect Tutorial Length',
      view_count: 60000,
      rolling_baseline_views: 20000,
      channel_avg_views: 25000,
      published_at: '2024-01-22T14:15:00Z',
      format_type: 'tutorial',
      duration: 'PT15M45S',
      topic_cluster: 'woodworking_tutorials'
    }
  ],

  timingPatterns: [
    {
      id: 'vid12',
      title: 'Monday Project Start',
      view_count: 30000,
      rolling_baseline_views: 20000,
      channel_avg_views: 22000,
      published_at: '2024-01-08T10:00:00Z', // Monday
      format_type: 'tutorial',
      duration: 'PT12M30S',
      topic_cluster: 'weekly_projects'
    },
    {
      id: 'vid13',
      title: 'Tuesday Tips',
      view_count: 50000,
      rolling_baseline_views: 18000,
      channel_avg_views: 20000,
      published_at: '2024-01-09T11:30:00Z', // Tuesday
      format_type: 'tips',
      duration: 'PT8M45S',
      topic_cluster: 'tips_tricks'
    },
    {
      id: 'vid14',
      title: 'Weekend Build',
      view_count: 35000,
      rolling_baseline_views: 25000,
      channel_avg_views: 28000,
      published_at: '2024-01-13T15:00:00Z', // Saturday
      format_type: 'tutorial',
      duration: 'PT25M10S',
      topic_cluster: 'weekend_projects'
    }
  ]
};

class PatternAnalyzerTests {
  constructor() {
    this.service = new PatternDiscoveryService();
    this.results = { passed: 0, failed: 0, total: 0 };
  }

  logTest(testName, passed, message, data = null) {
    this.results.total++;
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${testName}: ${message}`);
    
    if (data) {
      console.log(`   Data: ${JSON.stringify(data, null, 2)}`);
    }
    
    if (passed) {
      this.results.passed++;
    } else {
      this.results.failed++;
    }
  }

  async runAllTests() {
    console.log('🧪 Running Pattern Analyzer Unit Tests\n');
    
    try {
      await this.testTitlePatternAnalyzer();
      await this.testTitleStructureAnalyzer();
      await this.testFormatOutlierAnalyzer();
      await this.testDurationPatternAnalyzer();
      await this.testTimingPatternAnalyzer();
      await this.testTopicClusterAnalyzer();
      
      this.generateReport();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
    }
  }

  async testTitlePatternAnalyzer() {
    console.log('\n📋 Testing Title Pattern Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'TitlePatternAnalyzer');
      
      if (!analyzer) {
        this.logTest('Title Pattern Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 2
      };
      
      // Test with videos containing "beginner" pattern
      const patterns = await analyzer.discover(testVideos.titlePatterns, context);
      
      this.logTest('Title Pattern Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} title patterns`);
      
      if (patterns.length > 0) {
        const pattern = patterns[0];
        
        // Test pattern structure
        this.logTest('Title Pattern Structure', 
          pattern.pattern_type === 'title', 
          'Pattern type is title');
        
        this.logTest('Title Pattern Data', 
          pattern.pattern_data && pattern.pattern_data.name, 
          'Pattern has name');
        
        this.logTest('Title Pattern Performance', 
          pattern.performance_stats && typeof pattern.performance_stats.avg === 'number', 
          `Performance avg: ${pattern.performance_stats.avg?.toFixed(2)}`);
        
        this.logTest('Title Pattern Evidence', 
          pattern.evidence_count > 0, 
          `Evidence count: ${pattern.evidence_count}`);
        
        // Test for "beginner" pattern specifically
        const beginnerPattern = patterns.find(p => 
          p.pattern_data.ngram && p.pattern_data.ngram.includes('beginner'));
        
        this.logTest('Beginner Pattern Detection', 
          !!beginnerPattern, 
          'Found "beginner" pattern in titles');
      }
      
    } catch (error) {
      this.logTest('Title Pattern Analyzer', false, error.message);
    }
  }

  async testTitleStructureAnalyzer() {
    console.log('\n📋 Testing Title Structure Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'TitleStructureAnalyzer');
      
      if (!analyzer) {
        this.logTest('Title Structure Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'mixed',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 2
      };
      
      const patterns = await analyzer.discover(testVideos.structurePatterns, context);
      
      this.logTest('Structure Pattern Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} structure patterns`);
      
      if (patterns.length > 0) {
        // Test word count patterns
        const wordCountPattern = patterns.find(p => 
          p.pattern_data.word_count_range);
        
        this.logTest('Word Count Pattern', 
          !!wordCountPattern, 
          'Found word count pattern');
        
        // Test punctuation patterns
        const punctuationPattern = patterns.find(p => 
          p.pattern_data.punctuation_type);
        
        this.logTest('Punctuation Pattern', 
          !!punctuationPattern, 
          'Found punctuation pattern');
        
        // Test question mark pattern specifically
        const questionPattern = patterns.find(p => 
          p.pattern_data.punctuation_type === 'questions');
        
        this.logTest('Question Mark Pattern', 
          !!questionPattern, 
          'Detected question mark performance boost');
      }
      
    } catch (error) {
      this.logTest('Title Structure Analyzer', false, error.message);
    }
  }

  async testFormatOutlierAnalyzer() {
    console.log('\n📋 Testing Format Outlier Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'FormatOutlierAnalyzer');
      
      if (!analyzer) {
        this.logTest('Format Outlier Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 2
      };
      
      const patterns = await analyzer.discover(testVideos.titlePatterns, context);
      
      this.logTest('Format Outlier Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} format patterns`);
      
      if (patterns.length > 0) {
        const pattern = patterns[0];
        
        this.logTest('Format Pattern Type', 
          pattern.pattern_type === 'format', 
          'Pattern type is format');
        
        this.logTest('Format Pattern Data', 
          pattern.pattern_data.format, 
          `Format: ${pattern.pattern_data.format}`);
        
        this.logTest('Format Performance Lift', 
          pattern.pattern_data.performance_lift > 1.0, 
          `Lift: ${pattern.pattern_data.performance_lift?.toFixed(2)}x`);
        
        // Test specific format dominance
        const listiclePattern = patterns.find(p => 
          p.pattern_data.format === 'listicle');
        
        if (listiclePattern) {
          this.logTest('Listicle Format Dominance', 
            listiclePattern.pattern_data.performance_lift > 1.0, 
            `Listicle lift: ${listiclePattern.pattern_data.performance_lift?.toFixed(2)}x`);
        }
      }
      
    } catch (error) {
      this.logTest('Format Outlier Analyzer', false, error.message);
    }
  }

  async testDurationPatternAnalyzer() {
    console.log('\n📋 Testing Duration Pattern Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'DurationPatternAnalyzer');
      
      if (!analyzer) {
        this.logTest('Duration Pattern Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'mixed',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 1
      };
      
      const patterns = await analyzer.discover(testVideos.durationPatterns, context);
      
      this.logTest('Duration Pattern Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} duration patterns`);
      
      if (patterns.length > 0) {
        const pattern = patterns[0];
        
        this.logTest('Duration Pattern Type', 
          pattern.pattern_type === 'duration', 
          'Pattern type is duration');
        
        this.logTest('Duration Range', 
          pattern.pattern_data.duration_range, 
          `Range: ${pattern.pattern_data.duration_range}`);
        
        // Test duration parsing
        const fifteenMinPattern = patterns.find(p => 
          p.pattern_data.duration_range === '15-25min');
        
        this.logTest('15-25 Minute Sweet Spot', 
          !!fifteenMinPattern, 
          'Found 15-25 minute optimal duration');
      }
      
    } catch (error) {
      this.logTest('Duration Pattern Analyzer', false, error.message);
    }
  }

  async testTimingPatternAnalyzer() {
    console.log('\n📋 Testing Timing Pattern Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'TimingPatternAnalyzer');
      
      if (!analyzer) {
        this.logTest('Timing Pattern Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'mixed',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 1
      };
      
      const patterns = await analyzer.discover(testVideos.timingPatterns, context);
      
      this.logTest('Timing Pattern Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} timing patterns`);
      
      if (patterns.length > 0) {
        const pattern = patterns[0];
        
        this.logTest('Timing Pattern Type', 
          pattern.pattern_type === 'timing', 
          'Pattern type is timing');
        
        this.logTest('Day of Week', 
          pattern.pattern_data.day_of_week, 
          `Day: ${pattern.pattern_data.day_of_week}`);
        
        // Test Tuesday performance boost
        const tuesdayPattern = patterns.find(p => 
          p.pattern_data.day_of_week === 'Tuesday');
        
        this.logTest('Tuesday Performance Boost', 
          !!tuesdayPattern, 
          'Found Tuesday publishing advantage');
      }
      
    } catch (error) {
      this.logTest('Timing Pattern Analyzer', false, error.message);
    }
  }

  async testTopicClusterAnalyzer() {
    console.log('\n📋 Testing Topic Cluster Analyzer');
    
    try {
      const analyzer = this.service.analyzers.find(a => a.constructor.name === 'TopicClusterAnalyzer');
      
      if (!analyzer) {
        this.logTest('Topic Cluster Analyzer', false, 'Analyzer not found');
        return;
      }
      
      const context = {
        topic_cluster: 'woodworking_beginner',
        min_performance: 1.0,
        min_confidence: 0.5,
        min_videos: 2
      };
      
      const patterns = await analyzer.discover(testVideos.titlePatterns, context);
      
      this.logTest('Topic Cluster Discovery', 
        Array.isArray(patterns), 
        `Found ${patterns.length} topic patterns`);
      
      if (patterns.length > 0) {
        const pattern = patterns[0];
        
        this.logTest('Topic Pattern Type', 
          pattern.pattern_type === 'topic_cluster', 
          'Pattern type is topic_cluster');
        
        this.logTest('Topic Cluster Name', 
          pattern.pattern_data.topic_cluster, 
          `Topic: ${pattern.pattern_data.topic_cluster}`);
        
        this.logTest('Dominant Formats', 
          Array.isArray(pattern.pattern_data.dominant_formats), 
          `Formats: ${pattern.pattern_data.dominant_formats?.map(f => f.format).join(', ')}`);
        
        // Test format distribution
        const hasFormatData = pattern.pattern_data.dominant_formats?.length > 0;
        this.logTest('Format Distribution', 
          hasFormatData, 
          'Has format distribution data');
      }
      
    } catch (error) {
      this.logTest('Topic Cluster Analyzer', false, error.message);
    }
  }

  generateReport() {
    console.log('\n' + '=' * 60);
    console.log('📊 PATTERN ANALYZER UNIT TEST RESULTS');
    console.log('=' * 60);
    
    const passRate = (this.results.passed / this.results.total * 100).toFixed(1);
    
    console.log(`\n📈 Summary:`);
    console.log(`   Total Tests: ${this.results.total}`);
    console.log(`   ✅ Passed: ${this.results.passed}`);
    console.log(`   ❌ Failed: ${this.results.failed}`);
    console.log(`   📊 Pass Rate: ${passRate}%`);
    
    if (this.results.failed === 0) {
      console.log('\n✅ All analyzer tests passed!');
      console.log('   Pattern analyzers are working correctly.');
    } else {
      console.log('\n❌ Some tests failed.');
      console.log('   Please review the analyzer implementations.');
    }
  }
}

// Run the tests
const tests = new PatternAnalyzerTests();
tests.runAllTests().catch(console.error);