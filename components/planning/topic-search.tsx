'use client'

import React, { useState } from 'react'
import { Search, Loader2, Sparkles } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface TopicSearchProps {
  onSearch: (results: any) => void
  existingTopic?: any
}

const POPULAR_TOPICS = [
  'React hooks tutorial',
  'JavaScript tips and tricks',
  'Web development roadmap',
  'CSS animations',
  'TypeScript best practices',
  'Node.js authentication',
  'Python for beginners',
  'Data structures explained'
]

export default function TopicSearch({ onSearch, existingTopic }: TopicSearchProps) {
  const [query, setQuery] = useState(existingTopic?.query || '')
  const [isSearching, setIsSearching] = useState(false)

  const handleSearch = async () => {
    if (!query.trim()) return

    setIsSearching(true)
    try {
      // Call your API to search for videos on this topic
      const response = await fetch('/api/planning/search-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query })
      })

      const data = await response.json()
      onSearch({
        query,
        results: data.videos,
        patterns: data.patterns,
        outliers: data.outliers
      })
    } catch (error) {
      console.error('Search failed:', error)
    } finally {
      setIsSearching(false)
    }
  }

  const handleQuickSearch = (topic: string) => {
    setQuery(topic)
    // Auto-search when clicking a popular topic
    setTimeout(() => {
      const submitButton = document.querySelector('[data-search-submit]') as HTMLButtonElement
      submitButton?.click()
    }, 100)
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">What video do you want to make?</CardTitle>
          <CardDescription>
            Search for a topic to see what's working well and plan your video accordingly
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="e.g., 'React tutorial', 'productivity tips', 'cooking basics'"
                className="pl-10"
              />
            </div>
            <Button
              onClick={handleSearch}
              disabled={isSearching || !query.trim()}
              data-search-submit
            >
              {isSearching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Searching
                </>
              ) : (
                <>
                  <Search className="mr-2 h-4 w-4" />
                  Search
                </>
              )}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm text-gray-600">Popular topics:</p>
            <div className="flex flex-wrap gap-2">
              {POPULAR_TOPICS.map((topic) => (
                <Badge
                  key={topic}
                  variant="secondary"
                  className="cursor-pointer hover:bg-gray-200"
                  onClick={() => handleQuickSearch(topic)}
                >
                  <Sparkles className="mr-1 h-3 w-3" />
                  {topic}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {existingTopic && (
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Currently researching:</p>
                <p className="font-medium">{existingTopic.query}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setQuery('')
                  onSearch(null)
                }}
              >
                Clear topic
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}