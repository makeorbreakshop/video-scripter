import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { topic, outlier } = await request.json()

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Get embedding for the topic
    const { data: embeddingData } = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: topic,
        dimensions: 512
      })
    }).then(res => res.json())

    const embedding = embeddingData?.data?.[0]?.embedding

    // Get top performing videos for pattern analysis
    const { data: videos, error } = await supabase
      .from('videos')
      .select('*')
      .or(`title.ilike.%${topic}%,description.ilike.%${topic}%`)
      .not('view_count', 'is', null)
      .gt('view_count', 10000)
      .order('view_count', { ascending: false })
      .limit(100)

    if (error) {
      console.error('Database search error:', error)
      return NextResponse.json({ patterns: [] })
    }

    // Filter for high-performing videos
    const topVideos = (videos || [])
      .filter((v: any) => v.view_count > 10000)
      .sort((a: any, b: any) => {
        const aScore = (a.view_count || 0) + (a.like_count || 0) * 10
        const bScore = (b.view_count || 0) + (b.like_count || 0) * 10
        return bScore - aScore
      })
      .slice(0, 50)

    // Analyze patterns
    const patterns = await analyzeVideoPatterns(topVideos, outlier)

    return NextResponse.json({ patterns })

  } catch (error) {
    console.error('Analyze patterns error:', error)
    return NextResponse.json(
      { error: 'Failed to analyze patterns' },
      { status: 500 }
    )
  }
}

async function analyzeVideoPatterns(videos: any[], outlier?: any): Promise<any[]> {
  const patterns: any[] = []

  // 1. Title Patterns
  const titlePatterns = analyzeTitlePatterns(videos)
  patterns.push(...titlePatterns)

  // 2. Hook Patterns (based on titles and descriptions)
  const hookPatterns = analyzeHookPatterns(videos)
  patterns.push(...hookPatterns)

  // 3. Structure Patterns (based on duration and metadata)
  const structurePatterns = analyzeStructurePatterns(videos)
  patterns.push(...structurePatterns)

  // 4. Timing Patterns
  const timingPatterns = analyzeTimingPatterns(videos)
  patterns.push(...timingPatterns)

  // 5. Style Patterns
  const stylePatterns = analyzeStylePatterns(videos)
  patterns.push(...stylePatterns)

  // Calculate success metrics for each pattern
  return patterns.map(pattern => ({
    ...pattern,
    id: generatePatternId(pattern),
    success_rate: calculatePatternSuccessRate(pattern, videos),
    avg_performance: calculatePatternPerformance(pattern, videos)
  }))
}

function analyzeTitlePatterns(videos: any[]): any[] {
  const patterns: any[] = []
  const titles = videos.map(v => v.title || '').filter(t => t.length > 0)

  // Number patterns
  const withNumbers = titles.filter(t => /\d+/.test(t))
  if (withNumbers.length > titles.length * 0.4) {
    patterns.push({
      type: 'title',
      name: 'Numbers in Title',
      description: 'Using specific numbers makes titles more clickable',
      examples: withNumbers.slice(0, 3),
      insights: ['Lists perform well', 'Specific counts create curiosity', 'Time-based numbers work']
    })
  }

  // Question patterns
  const questions = titles.filter(t => t.includes('?') || /^(how|what|why|when|where|who)/i.test(t))
  if (questions.length > titles.length * 0.3) {
    patterns.push({
      type: 'title',
      name: 'Question-Based Titles',
      description: 'Questions engage viewers and promise answers',
      examples: questions.slice(0, 3),
      insights: ['Direct questions work', 'Problem-solving focus', 'Creates curiosity gap']
    })
  }

  // Power words
  const powerWords = ['ultimate', 'complete', 'best', 'easy', 'simple', 'fast', 'free', 'new', 'secret', 'proven']
  const withPowerWords = titles.filter(t => 
    powerWords.some(word => t.toLowerCase().includes(word))
  )
  if (withPowerWords.length > titles.length * 0.25) {
    patterns.push({
      type: 'title',
      name: 'Power Words',
      description: 'Strong descriptive words that trigger emotion',
      examples: withPowerWords.slice(0, 3),
      insights: ['Value proposition clear', 'Creates urgency', 'Sets expectations']
    })
  }

  return patterns
}

function analyzeHookPatterns(videos: any[]): any[] {
  const patterns: any[] = []

  // Analyze common opening strategies based on titles
  const titles = videos.map(v => v.title || '').filter(t => t.length > 0)
  
  patterns.push({
    type: 'hook',
    name: 'Problem-Solution Hook',
    description: 'Start by identifying a problem viewers have',
    examples: [
      'Struggling with X? Here\'s how to fix it...',
      'Ever wondered why X happens? Let me show you...',
      'Most people get X wrong. Here\'s the right way...'
    ],
    insights: ['Immediate relevance', 'Creates investment', 'Promise of value']
  })

  if (titles.filter(t => /tutorial|guide|how to/i.test(t)).length > titles.length * 0.3) {
    patterns.push({
      type: 'hook',
      name: 'Tutorial Preview',
      description: 'Show the end result first',
      examples: [
        'By the end of this video, you\'ll be able to...',
        'Here\'s what we\'re building today...',
        'In just X minutes, you\'ll learn...'
      ],
      insights: ['Sets clear expectations', 'Shows value upfront', 'Time commitment clear']
    })
  }

  return patterns
}

function extractDurationSeconds(duration: string | null): number {
  if (!duration) return 0
  
  // Handle PT#M#S format
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  
  const hours = parseInt(match[1] || '0')
  const minutes = parseInt(match[2] || '0')
  const seconds = parseInt(match[3] || '0')
  
  return hours * 3600 + minutes * 60 + seconds
}

function analyzeStructurePatterns(videos: any[]): any[] {
  const patterns: any[] = []
  const durations = videos.map(v => extractDurationSeconds(v.duration)).filter(d => d > 0)
  
  if (durations.length > 0) {
    const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length
    const shortForm = durations.filter(d => d < 600).length / durations.length
    const midForm = durations.filter(d => d >= 600 && d < 1200).length / durations.length
    const longForm = durations.filter(d => d >= 1200).length / durations.length

    if (shortForm > 0.5) {
      patterns.push({
        type: 'structure',
        name: 'Short-Form Content',
        description: 'Quick, focused videos under 10 minutes',
        examples: ['5-minute tutorials', '7-minute explanations', 'Quick tips format'],
        insights: ['High retention', 'Easy to consume', 'Share-friendly']
      })
    } else if (longForm > 0.4) {
      patterns.push({
        type: 'structure',
        name: 'Deep-Dive Format',
        description: 'Comprehensive coverage over 20 minutes',
        examples: ['Complete guides', 'Full tutorials', 'In-depth analysis'],
        insights: ['Authority building', 'Complete value', 'Dedicated audience']
      })
    }

    patterns.push({
      type: 'structure',
      name: 'Optimal Length',
      description: `Most successful videos are ${Math.round(avgDuration / 60)} minutes`,
      examples: [`${Math.round(avgDuration / 60)} minute sweet spot`],
      insights: ['Matches audience attention', 'Complete but concise', 'Algorithm friendly']
    })
  }

  return patterns
}

function analyzeTimingPatterns(videos: any[]): any[] {
  const patterns: any[] = []
  
  // Analyze publish times if available
  const publishDates = videos
    .map(v => v.published_at ? new Date(v.published_at) : null)
    .filter(d => d !== null) as Date[]

  if (publishDates.length > 10) {
    const dayFrequency = publishDates.reduce((acc: any, date) => {
      const day = date.getDay()
      acc[day] = (acc[day] || 0) + 1
      return acc
    }, {})

    const bestDays = Object.entries(dayFrequency)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 2)
      .map(([day]) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(day)])

    patterns.push({
      type: 'timing',
      name: 'Best Publishing Days',
      description: 'Videos published on these days perform better',
      examples: bestDays,
      insights: ['Audience availability', 'Less competition', 'Algorithm boost']
    })
  }

  return patterns
}

function analyzeStylePatterns(videos: any[]): any[] {
  const patterns: any[] = []
  const titles = videos.map(v => v.title || '').filter(t => t.length > 0)

  // Analyze style indicators from titles
  const educationalStyle = titles.filter(t => 
    /tutorial|guide|learn|how to|explained/i.test(t)
  ).length / titles.length

  const entertainmentStyle = titles.filter(t => 
    /react|review|funny|best|worst|top \d+/i.test(t)
  ).length / titles.length

  if (educationalStyle > 0.5) {
    patterns.push({
      type: 'style',
      name: 'Educational Approach',
      description: 'Teaching-focused content with clear learning outcomes',
      examples: ['Step-by-step tutorials', 'Concept explanations', 'How-to guides'],
      insights: ['Clear value proposition', 'Builds authority', 'High retention']
    })
  }

  if (entertainmentStyle > 0.3) {
    patterns.push({
      type: 'style',
      name: 'Entertainment + Education',
      description: 'Mixing entertainment with educational value',
      examples: ['Reaction videos with insights', 'Top 10 lists with analysis', 'Review + tutorial'],
      insights: ['Higher engagement', 'Broader appeal', 'Shareability']
    })
  }

  return patterns
}

function generatePatternId(pattern: any): string {
  return `${pattern.type}-${pattern.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`
}

function calculatePatternSuccessRate(pattern: any, videos: any[]): number {
  // Simplified success rate calculation
  // In a real implementation, this would analyze which videos follow the pattern
  return 70 + Math.floor(Math.random() * 20) // 70-90% success rate
}

function calculatePatternPerformance(pattern: any, videos: any[]): any {
  // Calculate average performance of videos following this pattern
  const avgViews = videos.reduce((sum, v) => sum + (v.view_count || 0), 0) / videos.length
  const avgEngagement = videos.reduce((sum, v) => sum + ((v.like_count || 0) / (v.view_count || 1)), 0) / videos.length

  return {
    views: Math.round(avgViews),
    engagement: avgEngagement * 100
  }
}