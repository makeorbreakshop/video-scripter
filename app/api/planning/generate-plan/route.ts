import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!
})

export async function POST(request: NextRequest) {
  try {
    const { topic, inspiration, patterns } = await request.json()

    if (!topic) {
      return NextResponse.json({ error: 'Topic is required' }, { status: 400 })
    }

    // Build context from inspiration and patterns
    const context = buildPlanContext(topic, inspiration, patterns)

    // Generate video plan using AI
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo-preview',
      messages: [
        {
          role: 'system',
          content: `You are a YouTube video planning expert. Create detailed, actionable video plans based on successful patterns and examples. Focus on practical, specific advice that creators can immediately use.`
        },
        {
          role: 'user',
          content: context
        }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })

    const planData = JSON.parse(completion.choices[0].message.content || '{}')

    // Ensure all required fields are present
    const plan = {
      title: planData.title || `${topic} - Complete Guide`,
      hook: planData.hook || 'In this video, I\'ll show you...',
      outline: planData.outline || ['Introduction', 'Main Content', 'Examples', 'Summary'],
      keywords: planData.keywords || extractKeywords(topic),
      thumbnail_ideas: planData.thumbnail_ideas || generateThumbnailIdeas(topic),
      estimated_length: planData.estimated_length || '10-15 minutes',
      call_to_action: planData.call_to_action || 'If you found this helpful, please like and subscribe!',
      unique_angle: planData.unique_angle || 'A fresh perspective on ' + topic
    }

    return NextResponse.json({ plan })

  } catch (error) {
    console.error('Generate plan error:', error)
    return NextResponse.json(
      { error: 'Failed to generate plan' },
      { status: 500 }
    )
  }
}

function buildPlanContext(topic: string, inspiration: any, patterns: any[]): string {
  let context = `Create a detailed video plan for the topic: "${topic}"\n\n`

  if (inspiration) {
    context += `INSPIRATION VIDEO:\n`
    context += `Title: ${inspiration.title}\n`
    context += `Views: ${inspiration.views}\n`
    context += `Why it worked: ${inspiration.outlier_reason}\n\n`
  }

  if (patterns && patterns.length > 0) {
    context += `SUCCESSFUL PATTERNS TO INCORPORATE:\n`
    patterns.forEach((pattern: any) => {
      context += `\n${pattern.type.toUpperCase()} - ${pattern.name}:\n`
      context += `Description: ${pattern.description}\n`
      context += `Key insights: ${pattern.insights.join(', ')}\n`
    })
    context += '\n'
  }

  context += `
Please generate a comprehensive video plan in JSON format with these fields:
{
  "title": "Engaging, SEO-friendly title incorporating successful patterns",
  "hook": "First 15 seconds script that grabs attention and promises value",
  "unique_angle": "What makes this video different from others on the topic",
  "outline": [
    "Introduction with hook",
    "Main point 1 with specific details",
    "Main point 2 with examples",
    "Main point 3 with demonstrations",
    "Practical application",
    "Summary and CTA"
  ],
  "keywords": ["primary keyword", "secondary keywords", "related terms"],
  "thumbnail_ideas": [
    "Thumbnail concept 1 with visual elements",
    "Thumbnail concept 2 with text overlay ideas",
    "Thumbnail concept 3 with emotion/reaction"
  ],
  "estimated_length": "X-Y minutes based on content depth",
  "call_to_action": "Specific CTA that encourages engagement"
}

Make the plan specific, actionable, and based on the successful patterns provided.`

  return context
}

function extractKeywords(topic: string): string[] {
  // Basic keyword extraction
  const words = topic.toLowerCase().split(/\s+/)
  const commonWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for']
  const keywords = words.filter(w => !commonWords.includes(w) && w.length > 2)
  
  // Add related terms
  const related = []
  if (topic.includes('tutorial')) related.push('guide', 'how to', 'learn')
  if (topic.includes('react')) related.push('javascript', 'frontend', 'web development')
  if (topic.includes('python')) related.push('programming', 'coding', 'development')
  
  return [...new Set([...keywords, ...related])].slice(0, 10)
}

function generateThumbnailIdeas(topic: string): string[] {
  return [
    `Split screen showing before/after results related to ${topic}`,
    `Close-up reaction shot with bold text overlay highlighting the main benefit`,
    `Clean, minimal design with the key concept visualized and a number/statistic`
  ]
}