'use client'

import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { motion, AnimatePresence } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { TrendingUp, Calendar, Zap, ChevronLeft, ChevronRight, Play } from 'lucide-react'

interface VideoData {
  id: string
  title: string
  viewCount: number
  publishedAt: Date
  performanceRatio: number
  thumbnail: string
  topic: string
  cluster: number
}

interface TimelineViewProps {
  videos: VideoData[]
  onSelectVideo: (video: VideoData) => void
  selectedVideo: VideoData | null
}

export function TimelineView({ videos, onSelectVideo, selectedVideo }: TimelineViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [timeRange, setTimeRange] = useState<[Date, Date] | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState<Date | null>(null)
  const [hoveredVideo, setHoveredVideo] = useState<VideoData | null>(null)
  
  useEffect(() => {
    if (!svgRef.current || videos.length === 0) return
    
    const margin = { top: 20, right: 20, bottom: 60, left: 60 }
    const width = svgRef.current.clientWidth - margin.left - margin.right
    const height = svgRef.current.clientHeight - margin.top - margin.bottom
    
    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove()
    
    const svg = d3.select(svgRef.current)
    const g = svg.append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)
    
    // Set up scales
    const xExtent = d3.extent(videos, d => d.publishedAt) as [Date, Date]
    const xScale = d3.scaleTime()
      .domain(xExtent)
      .range([0, width])
    
    const yScale = d3.scaleLog()
      .domain([1000, d3.max(videos, d => d.viewCount) || 1000000])
      .range([height, 0])
    
    const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
    
    // Add gradient for performance
    const defs = svg.append('defs')
    const gradient = defs.append('linearGradient')
      .attr('id', 'performance-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%')
    
    gradient.append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#fbbf24')
      .attr('stop-opacity', 0.8)
    
    gradient.append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#1f2937')
      .attr('stop-opacity', 0.2)
    
    // Add axes
    const xAxis = d3.axisBottom(xScale)
      .tickFormat(d3.timeFormat('%b %Y'))
    
    const yAxis = d3.axisLeft(yScale)
      .tickFormat(d => {
        if (d >= 1000000) return `${(d / 1000000).toFixed(0)}M`
        if (d >= 1000) return `${(d / 1000).toFixed(0)}K`
        return d.toString()
      })
    
    g.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(xAxis)
      .style('color', '#9ca3af')
    
    g.append('g')
      .call(yAxis)
      .style('color', '#9ca3af')
    
    // Add axis labels
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', 0 - margin.left)
      .attr('x', 0 - (height / 2))
      .attr('dy', '1em')
      .style('text-anchor', 'middle')
      .style('fill', '#9ca3af')
      .text('View Count')
    
    // Add trend lines for each cluster
    const clusters = d3.group(videos, d => d.cluster)
    clusters.forEach((clusterVideos, cluster) => {
      const sortedVideos = clusterVideos.sort((a, b) => 
        a.publishedAt.getTime() - b.publishedAt.getTime()
      )
      
      const line = d3.line<VideoData>()
        .x(d => xScale(d.publishedAt))
        .y(d => yScale(d.viewCount))
        .curve(d3.curveMonotoneX)
      
      g.append('path')
        .datum(sortedVideos)
        .attr('fill', 'none')
        .attr('stroke', colorScale(cluster.toString()))
        .attr('stroke-width', 1)
        .attr('opacity', 0.3)
        .attr('d', line)
    })
    
    // Add video dots
    const dots = g.selectAll('.video-dot')
      .data(videos)
      .enter()
      .append('g')
      .attr('class', 'video-dot')
      .attr('transform', d => `translate(${xScale(d.publishedAt)},${yScale(d.viewCount)})`)
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => setHoveredVideo(d))
      .on('mouseleave', () => setHoveredVideo(null))
      .on('click', (event, d) => onSelectVideo(d))
    
    // Add circles
    dots.append('circle')
      .attr('r', d => d.performanceRatio > 3 ? 6 : 4)
      .attr('fill', d => d.performanceRatio > 3 ? '#fbbf24' : colorScale(d.cluster.toString()))
      .attr('stroke', d => d === selectedVideo ? '#fff' : 'none')
      .attr('stroke-width', 2)
      .attr('opacity', 0.8)
      .transition()
      .duration(1000)
      .delay((d, i) => i * 2)
      .attr('r', d => d.performanceRatio > 3 ? 8 : 5)
    
    // Add outlier pulses
    dots.filter(d => d.performanceRatio > 3)
      .append('circle')
      .attr('r', 8)
      .attr('fill', 'none')
      .attr('stroke', '#fbbf24')
      .attr('stroke-width', 2)
      .attr('opacity', 0)
      .each(function() {
        const circle = d3.select(this)
        const pulse = () => {
          circle
            .attr('r', 8)
            .attr('opacity', 0.8)
            .transition()
            .duration(1500)
            .attr('r', 20)
            .attr('opacity', 0)
            .on('end', pulse)
        }
        pulse()
      })
    
    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.5, 10])
      .extent([[0, 0], [width, height]])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString())
      })
    
    svg.call(zoom)
    
    setTimeRange(xExtent)
    
    return () => {
      // Cleanup
    }
  }, [videos, selectedVideo, onSelectVideo])
  
  // Animation timeline
  useEffect(() => {
    if (!isPlaying || !timeRange) return
    
    const interval = setInterval(() => {
      setCurrentTime(prev => {
        if (!prev) return timeRange[0]
        const next = new Date(prev.getTime() + 24 * 60 * 60 * 1000 * 7) // 1 week
        if (next > timeRange[1]) {
          setIsPlaying(false)
          return timeRange[1]
        }
        return next
      })
    }, 100)
    
    return () => clearInterval(interval)
  }, [isPlaying, timeRange])
  
  // Calculate trending topics
  const trendingTopics = React.useMemo(() => {
    if (!currentTime) return []
    
    const recentVideos = videos.filter(v => {
      const diff = currentTime.getTime() - v.publishedAt.getTime()
      return diff >= 0 && diff <= 30 * 24 * 60 * 60 * 1000 // 30 days
    })
    
    const topicPerformance = d3.rollup(
      recentVideos,
      videos => ({
        avgViews: d3.mean(videos, d => d.viewCount) || 0,
        count: videos.length,
        outliers: videos.filter(v => v.performanceRatio > 3).length
      }),
      d => d.topic
    )
    
    return Array.from(topicPerformance, ([topic, stats]) => ({
      topic,
      ...stats
    })).sort((a, b) => b.outliers - a.outliers || b.avgViews - a.avgViews)
      .slice(0, 5)
  }, [videos, currentTime])
  
  return (
    <div className="relative h-full">
      <svg ref={svgRef} className="w-full h-full bg-gray-950" />
      
      {/* Timeline Controls */}
      <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2">
        <Card className="p-2 bg-black/90 backdrop-blur border-gray-700">
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCurrentTime(timeRange?.[0] || null)}
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant={isPlaying ? 'default' : 'ghost'}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              <Play className="w-4 h-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setCurrentTime(timeRange?.[1] || null)}
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
            {currentTime && (
              <div className="px-3 text-sm text-gray-400">
                {currentTime.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
              </div>
            )}
          </div>
        </Card>
      </div>
      
      {/* Trending Topics Panel */}
      <AnimatePresence>
        {currentTime && trendingTopics.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="absolute top-4 left-4 w-64"
          >
            <Card className="p-4 bg-black/90 backdrop-blur border-gray-700">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                Trending Topics
                <Badge variant="outline" className="ml-auto text-xs">
                  {currentTime.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                </Badge>
              </h3>
              <div className="space-y-2">
                {trendingTopics.map((topic, i) => (
                  <motion.div
                    key={topic.topic}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="p-2 bg-gray-900/50 rounded-lg"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">{topic.topic}</span>
                      {topic.outliers > 0 && (
                        <Badge className="bg-yellow-500/20 text-yellow-300 text-xs">
                          {topic.outliers} 🔥
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-gray-400">
                      {topic.count} videos • {(topic.avgViews / 1000).toFixed(0)}K avg
                    </div>
                  </motion.div>
                ))}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      
      {/* Hovered Video Details */}
      <AnimatePresence>
        {hoveredVideo && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute top-4 right-4 w-80 pointer-events-none"
          >
            <Card className="bg-black/95 backdrop-blur border-gray-600 overflow-hidden">
              <div className="relative">
                <img
                  src={hoveredVideo.thumbnail}
                  alt={hoveredVideo.title}
                  className="w-full h-40 object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
                <div className="absolute bottom-2 left-3 right-3">
                  <h4 className="font-semibold text-sm line-clamp-2">
                    {hoveredVideo.title}
                  </h4>
                </div>
              </div>
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">
                    {hoveredVideo.publishedAt.toLocaleDateString()}
                  </span>
                  <span className="font-medium">
                    {hoveredVideo.viewCount.toLocaleString()} views
                  </span>
                </div>
                {hoveredVideo.performanceRatio > 3 && (
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-yellow-500" />
                    <span className="text-sm text-yellow-500">
                      Outlier: {hoveredVideo.performanceRatio.toFixed(1)}x average
                    </span>
                  </div>
                )}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}