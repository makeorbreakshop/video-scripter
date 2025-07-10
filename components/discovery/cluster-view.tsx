'use client'

import React, { useEffect, useRef, useState } from 'react'
import * as d3 from 'd3'
import { motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TrendingUp, Users, Clock, BarChart } from 'lucide-react'

interface VideoData {
  id: string
  title: string
  viewCount: number
  cluster: number
  performanceRatio: number
  thumbnail: string
  topic: string
}

interface ClusterViewProps {
  videos: VideoData[]
  onSelectVideo: (video: VideoData) => void
  selectedVideo: VideoData | null
}

export function ClusterView({ videos, onSelectVideo, selectedVideo }: ClusterViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hoveredCluster, setHoveredCluster] = useState<number | null>(null)
  
  useEffect(() => {
    if (!svgRef.current) return
    
    const width = svgRef.current.clientWidth
    const height = svgRef.current.clientHeight
    
    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove()
    
    // Process data into clusters
    const clusters = d3.group(videos, d => d.cluster)
    const clusterData = Array.from(clusters, ([cluster, videos]) => {
      const avgViews = d3.mean(videos, d => d.viewCount) || 0
      const avgPerformance = d3.mean(videos, d => d.performanceRatio) || 0
      const outlierCount = videos.filter(v => v.performanceRatio > 3).length
      
      return {
        cluster,
        videos,
        avgViews,
        avgPerformance,
        outlierCount,
        size: videos.length,
        x: 0,
        y: 0
      }
    })
    
    // Create force simulation
    const simulation = d3.forceSimulation(clusterData)
      .force('charge', d3.forceManyBody().strength(-1000))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(d => Math.sqrt(d.size) * 20))
    
    const svg = d3.select(svgRef.current)
    
    // Create gradient definitions
    const defs = svg.append('defs')
    
    clusterData.forEach((d, i) => {
      const gradient = defs.append('radialGradient')
        .attr('id', `cluster-gradient-${i}`)
        .attr('cx', '50%')
        .attr('cy', '50%')
        .attr('r', '50%')
      
      gradient.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', `hsl(${i * 40}, 70%, 60%)`)
        .attr('stop-opacity', 0.8)
      
      gradient.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', `hsl(${i * 40}, 70%, 40%)`)
        .attr('stop-opacity', 0.3)
    })
    
    // Create cluster groups
    const clusterGroups = svg.selectAll('.cluster-group')
      .data(clusterData)
      .enter()
      .append('g')
      .attr('class', 'cluster-group')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        // Find best performing video in cluster
        const bestVideo = d.videos.reduce((prev, curr) => 
          curr.performanceRatio > prev.performanceRatio ? curr : prev
        )
        onSelectVideo(bestVideo)
      })
      .on('mouseenter', (event, d) => setHoveredCluster(d.cluster))
      .on('mouseleave', () => setHoveredCluster(null))
    
    // Add cluster circles
    clusterGroups.append('circle')
      .attr('r', d => Math.sqrt(d.size) * 10)
      .attr('fill', (d, i) => `url(#cluster-gradient-${i})`)
      .attr('stroke', d => d.outlierCount > 0 ? '#fbbf24' : '#4b5563')
      .attr('stroke-width', d => d.outlierCount > 0 ? 3 : 1)
      .attr('filter', 'url(#glow)')
    
    // Add glow filter
    const filter = defs.append('filter')
      .attr('id', 'glow')
    
    filter.append('feGaussianBlur')
      .attr('stdDeviation', '3')
      .attr('result', 'coloredBlur')
    
    const feMerge = filter.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'coloredBlur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')
    
    // Add cluster labels
    clusterGroups.append('text')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '14')
      .attr('font-weight', 'bold')
      .text(d => d.videos[0].topic)
    
    // Add outlier indicators
    clusterGroups.filter(d => d.outlierCount > 0)
      .append('text')
      .attr('text-anchor', 'middle')
      .attr('y', d => -Math.sqrt(d.size) * 10 - 10)
      .attr('fill', '#fbbf24')
      .attr('font-size', '12')
      .text(d => `🔥 ${d.outlierCount} outliers`)
    
    // Run simulation
    simulation.on('tick', () => {
      clusterGroups.attr('transform', d => `translate(${d.x}, ${d.y})`)
    })
    
    // Cleanup
    return () => {
      simulation.stop()
    }
  }, [videos, onSelectVideo])
  
  // Calculate cluster stats
  const clusterStats = React.useMemo(() => {
    const clusters = d3.group(videos, d => d.cluster)
    return Array.from(clusters, ([cluster, videos]) => {
      const topic = videos[0].topic
      const avgViews = Math.round(d3.mean(videos, d => d.viewCount) || 0)
      const outlierCount = videos.filter(v => v.performanceRatio > 3).length
      const topVideo = videos.reduce((prev, curr) => 
        curr.viewCount > prev.viewCount ? curr : prev
      )
      
      return { cluster, topic, avgViews, outlierCount, topVideo, size: videos.length }
    }).sort((a, b) => b.outlierCount - a.outlierCount)
  }, [videos])
  
  return (
    <div className="relative h-full">
      <svg ref={svgRef} className="w-full h-full" />
      
      {/* Cluster Stats Panel */}
      <div className="absolute top-4 right-4 w-80 space-y-4">
        <Card className="p-4 bg-black/90 backdrop-blur border-gray-700">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart className="w-4 h-4" />
            Cluster Analysis
          </h3>
          <div className="space-y-3">
            {clusterStats.slice(0, 5).map((stat) => (
              <motion.div
                key={stat.cluster}
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className={`p-3 rounded-lg border cursor-pointer transition-all ${
                  hoveredCluster === stat.cluster
                    ? 'bg-white/10 border-white/30'
                    : 'bg-gray-900/50 border-gray-800'
                }`}
                onMouseEnter={() => setHoveredCluster(stat.cluster)}
                onMouseLeave={() => setHoveredCluster(null)}
              >
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">{stat.topic}</h4>
                  {stat.outlierCount > 0 && (
                    <Badge className="bg-yellow-500/20 text-yellow-300">
                      {stat.outlierCount} outliers
                    </Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="flex items-center gap-1 text-gray-400">
                    <Users className="w-3 h-3" />
                    <span>{stat.size} videos</span>
                  </div>
                  <div className="flex items-center gap-1 text-gray-400">
                    <TrendingUp className="w-3 h-3" />
                    <span>{(stat.avgViews / 1000).toFixed(0)}K avg</span>
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500 truncate">
                  Top: {stat.topVideo.title}
                </div>
              </motion.div>
            ))}
          </div>
        </Card>
        
        {/* Legend */}
        <Card className="p-3 bg-black/90 backdrop-blur border-gray-700">
          <div className="text-xs space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600" />
              <span className="text-gray-400">High outlier density</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-gray-600" />
              <span className="text-gray-400">Normal performance</span>
            </div>
            <div className="text-gray-500 mt-2">
              Circle size = Number of videos
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}