'use client'

import React, { useState, useEffect } from 'react'
import { FileText, Download, Copy, Check, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/use-toast'

interface VideoPlanProps {
  topic: any
  plan: any
  onUpdatePlan: (plan: any) => void
}

interface VideoPlanData {
  title: string
  hook: string
  outline: string[]
  keywords: string[]
  thumbnail_ideas: string[]
  estimated_length: string
  call_to_action: string
  unique_angle: string
}

export default function VideoPlan({ topic, plan, onUpdatePlan }: VideoPlanProps) {
  const [videoPlan, setVideoPlan] = useState<VideoPlanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const { toast } = useToast()

  useEffect(() => {
    generatePlan()
  }, [topic, plan])

  const generatePlan = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/planning/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          topic: topic.query,
          inspiration: plan.inspiration,
          patterns: plan.pattern
        })
      })
      const data = await response.json()
      setVideoPlan(data.plan)
      onUpdatePlan({ ...plan, generatedPlan: data.plan })
    } catch (error) {
      console.error('Failed to generate plan:', error)
      toast({
        title: 'Error',
        description: 'Failed to generate video plan. Please try again.',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
    }
  }

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text)
    setCopied(field)
    setTimeout(() => setCopied(null), 2000)
    toast({
      title: 'Copied!',
      description: `${field} copied to clipboard`
    })
  }

  const exportPlan = () => {
    if (!videoPlan) return

    const planText = `
VIDEO PLAN: ${videoPlan.title}
Topic: ${topic.query}

TITLE: ${videoPlan.title}

HOOK:
${videoPlan.hook}

UNIQUE ANGLE:
${videoPlan.unique_angle}

OUTLINE:
${videoPlan.outline.map((item, idx) => `${idx + 1}. ${item}`).join('\n')}

KEYWORDS:
${videoPlan.keywords.join(', ')}

THUMBNAIL IDEAS:
${videoPlan.thumbnail_ideas.map((idea, idx) => `${idx + 1}. ${idea}`).join('\n')}

ESTIMATED LENGTH: ${videoPlan.estimated_length}

CALL TO ACTION:
${videoPlan.call_to_action}
    `.trim()

    const blob = new Blob([planText], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `video-plan-${topic.query.replace(/\s+/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)

    toast({
      title: 'Exported!',
      description: 'Video plan downloaded successfully'
    })
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400 mr-2" />
          <span className="text-gray-600">Generating your video plan...</span>
        </CardContent>
      </Card>
    )
  }

  if (!videoPlan) return null

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Your Video Plan</CardTitle>
              <CardDescription>
                Customized plan based on successful patterns for "{topic.query}"
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={generatePlan}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </Button>
              <Button size="sm" onClick={exportPlan}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="overview" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="content">Content</TabsTrigger>
              <TabsTrigger value="production">Production</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Video Title</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(videoPlan.title, 'Title')}
                  >
                    {copied === 'Title' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Input
                  value={videoPlan.title}
                  onChange={(e) => setVideoPlan({ ...videoPlan, title: e.target.value })}
                  className="font-medium"
                />
              </div>

              <div className="space-y-2">
                <Label>Unique Angle</Label>
                <Textarea
                  value={videoPlan.unique_angle}
                  onChange={(e) => setVideoPlan({ ...videoPlan, unique_angle: e.target.value })}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label>Keywords & Tags</Label>
                <div className="flex flex-wrap gap-2">
                  {videoPlan.keywords.map((keyword, idx) => (
                    <Badge key={idx} variant="secondary">
                      {keyword}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Estimated Length</Label>
                  <Input
                    value={videoPlan.estimated_length}
                    onChange={(e) => setVideoPlan({ ...videoPlan, estimated_length: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Best Time to Post</Label>
                  <Input value="Tuesday/Thursday 2-4 PM" readOnly />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="content" className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Hook (First 15 seconds)</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => copyToClipboard(videoPlan.hook, 'Hook')}
                  >
                    {copied === 'Hook' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Textarea
                  value={videoPlan.hook}
                  onChange={(e) => setVideoPlan({ ...videoPlan, hook: e.target.value })}
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Video Outline</Label>
                <div className="space-y-2">
                  {videoPlan.outline.map((item, idx) => (
                    <div key={idx} className="flex gap-2">
                      <span className="text-sm text-gray-500 w-6">{idx + 1}.</span>
                      <Input
                        value={item}
                        onChange={(e) => {
                          const newOutline = [...videoPlan.outline]
                          newOutline[idx] = e.target.value
                          setVideoPlan({ ...videoPlan, outline: newOutline })
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Call to Action</Label>
                <Textarea
                  value={videoPlan.call_to_action}
                  onChange={(e) => setVideoPlan({ ...videoPlan, call_to_action: e.target.value })}
                  rows={2}
                />
              </div>
            </TabsContent>

            <TabsContent value="production" className="space-y-4">
              <div className="space-y-2">
                <Label>Thumbnail Ideas</Label>
                <div className="space-y-3">
                  {videoPlan.thumbnail_ideas.map((idea, idx) => (
                    <Card key={idx}>
                      <CardContent className="p-3">
                        <div className="flex gap-2">
                          <span className="text-sm font-medium text-gray-500">#{idx + 1}</span>
                          <p className="text-sm">{idea}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Production Notes</Label>
                <Textarea
                  placeholder="Add any additional notes for filming, editing, or post-production..."
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}