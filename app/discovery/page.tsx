'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import { Search, TrendingUp, Sparkles, BarChart3, Play, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

// Cluster visualization component
function ClusterVisualization({ clusters, videos, onSelectCluster, selectedCluster, dimensions }: any) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!clusters.length || !svgRef.current) return

    d3.select(svgRef.current).selectAll('*').remove()
    const svg = d3.select(svgRef.current)
    const { width, height } = dimensions
    const g = svg.append('g')

    // Setup zoom
    const zoom = d3.zoom()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })
    svg.call(zoom as any)

    // Create force simulation for clusters
    const clusterNodes = clusters.map((cluster: any) => ({
      ...cluster,
      x: width / 2 + cluster.position.x,
      y: height / 2 + cluster.position.y,
      radius: Math.sqrt(cluster.size) * 5 + 20
    }))

    const simulation = d3.forceSimulation(clusterNodes)
      .force('charge', d3.forceManyBody().strength(-1000))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius((d: any) => d.radius + 20))

    // Draw clusters
    const clusterGroup = g.append('g')
      .selectAll('g')
      .data(clusterNodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (event, d: any) => {
        onSelectCluster(d.id)
      })

    // Cluster circles
    clusterGroup.append('circle')
      .attr('r', (d: any) => d.radius)
      .attr('fill', (d: any) => {
        const hue = (d.id * 137.5) % 360 // Golden angle
        return `hsl(${hue}, 50%, 50%)`
      })
      .attr('fill-opacity', 0.6)
      .attr('stroke', (d: any) => selectedCluster === d.id ? '#fff' : 'none')
      .attr('stroke-width', 3)

    // Cluster labels
    clusterGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.5em')
      .attr('fill', '#fff')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text((d: any) => d.inferredTopic)
      .each(function(d: any) {
        const text = d3.select(this)
        const words = d.inferredTopic.split(' ')
        text.text('')
        words.forEach((word: string, i: number) => {
          text.append('tspan')
            .attr('x', 0)
            .attr('dy', i === 0 ? '-0.5em' : '1.2em')
            .text(word)
        })
      })

    // Video count
    clusterGroup.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d: any) => {
        const lines = d.inferredTopic.split(' ').length
        return `${lines * 0.6 + 0.5}em`
      })
      .attr('fill', '#fff')
      .attr('font-size', '12px')
      .attr('opacity', 0.8)
      .text((d: any) => `${d.size} videos`)

    // Update positions
    simulation.on('tick', () => {
      clusterGroup.attr('transform', (d: any) => `translate(${d.x},${d.y})`)
    })

    return () => {
      simulation.stop()
    }
  }, [clusters, selectedCluster, onSelectCluster, dimensions])

  return (
    <svg 
      ref={svgRef} 
      width={dimensions.width} 
      height={dimensions.height}
      className="bg-gray-950"
      style={{ background: 'radial-gradient(circle at center, #111827 0%, #030712 100%)' }}
    />
  )
}

// Original Force Graph Component
function ForceGraph({ videos, selectedVideo, onSelectVideo, dimensions, visualMode = 'performance', connectionThreshold = 0.3 }: any) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simulationRef = useRef<any>(null)

  useEffect(() => {
    if (!videos.length || !svgRef.current) return

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove()

    const svg = d3.select(svgRef.current)
    const { width, height } = dimensions

    // Create container for zoom
    const g = svg.append('g')

    // Setup zoom
    const zoom = d3.zoom()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoom as any)

    // Prepare data - create nodes and links
    const nodes = videos.map((video: any) => ({
      ...video,
      fx: null,
      fy: null,
      x: Math.random() * width,
      y: Math.random() * height
    }))

    // Create links based on mode
    const links: any[] = []
    
    if (visualMode === 'semantic') {
      // For semantic mode, create links based on title similarity
      nodes.forEach((source, i) => {
        nodes.slice(i + 1).forEach(target => {
          // Simple similarity: shared words in title (in real app, use embeddings)
          const sourceWords = new Set(source.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3))
          const targetWords = new Set(target.title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3))
          const intersection = [...sourceWords].filter(x => targetWords.has(x))
          const union = new Set([...sourceWords, ...targetWords])
          const similarity = union.size > 0 ? intersection.length / union.size : 0
          
          if (similarity >= connectionThreshold && links.length < 500) {
            links.push({
              source: source.id,
              target: target.id,
              strength: similarity,
              type: 'semantic'
            })
          }
        })
      })
    }

    // Create force simulation
    const simulation = d3.forceSimulation(nodes)
    
    if (visualMode === 'semantic' && links.length > 0) {
      simulation
        .force('link', d3.forceLink(links).id((d: any) => d.id).distance(150).strength((d: any) => d.strength * 0.5))
        .force('charge', d3.forceManyBody().strength(-300))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius((d: any) => Math.sqrt(d.view_count) / 80 + 15))
    } else {
      simulation
        .force('charge', d3.forceManyBody().strength(-100))
        .force('x', d3.forceX(width / 2).strength(0.05))
        .force('y', d3.forceY(height / 2).strength(0.05))
        .force('collision', d3.forceCollide().radius((d: any) => Math.sqrt(d.view_count) / 80 + 10))
    }

    simulationRef.current = simulation

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', '#6366f1')
      .attr('stroke-opacity', (d: any) => Math.min(d.strength * 0.5, 0.3))
      .attr('stroke-width', (d: any) => Math.max(d.strength * 3, 1))

    // Count connections for each node in semantic mode
    if (visualMode === 'semantic') {
      const connectionCounts = new Map()
      links.forEach((link: any) => {
        connectionCounts.set(link.source, (connectionCounts.get(link.source) || 0) + 1)
        connectionCounts.set(link.target, (connectionCounts.get(link.target) || 0) + 1)
      })
      nodes.forEach(node => {
        node.connections = connectionCounts.get(node.id) || 0
      })
    }
    
    // Draw nodes
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('circle')
      .data(nodes)
      .join('circle')
      .attr('r', (d: any) => {
        const baseSize = Math.sqrt(d.view_count) / 80
        return Math.min(baseSize + 8, 40) // Cap max size
      })
      .attr('fill', (d: any) => {
        if (visualMode === 'semantic' && d.connections > 0) {
          // Color by connection count
          const scale = d3.scaleLinear()
            .domain([0, 10])
            .range(['#6366f1', '#ec4899'])
          return scale(Math.min(d.connections, 10))
        }
        return d.isOutlier ? '#f59e0b' : '#4b5563'
      })
      .attr('fill-opacity', (d: any) => {
        if (visualMode === 'semantic' && d.connections > 0) return 0.9
        return d.isOutlier ? 0.9 : 0.6
      })
      .attr('stroke', (d: any) => {
        if (selectedVideo?.id === d.id) return '#fff'
        return d.isOutlier ? '#f59e0b' : '#374151'
      })
      .attr('stroke-width', (d: any) => selectedVideo?.id === d.id ? 3 : 1)
      .style('cursor', 'pointer')
      .on('click', (event, d: any) => {
        onSelectVideo(d)
      })
      .on('mouseenter', function(event, d: any) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', (d: any) => {
            const baseSize = Math.sqrt(d.view_count) / 80
            return Math.min(baseSize + 10, 45)
          })
        
        // Show tooltip
        const tooltip = g.append('g')
          .attr('id', 'tooltip')
          .attr('transform', `translate(${d.x},${d.y})`)
        
        const text = tooltip.append('text')
          .attr('text-anchor', 'middle')
          .attr('y', -15)
          .attr('fill', '#fff')
          .attr('font-size', '11px')
          .attr('font-weight', '500')
          .text(() => {
            const content = visualMode === 'semantic' && d.connections
              ? `${d.title} (${d.connections} links)`
              : d.title
            return content.length > 40 ? content.substring(0, 40) + '...' : content
          })
        
        const bbox = (text.node() as any).getBBox()
        const padding = 8
        
        tooltip.insert('rect', 'text')
          .attr('x', bbox.x - padding)
          .attr('y', bbox.y - padding)
          .attr('width', bbox.width + padding * 2)
          .attr('height', bbox.height + padding * 2)
          .attr('fill', '#000')
          .attr('fill-opacity', 0.9)
          .attr('rx', 4)
      })
      .on('mouseleave', function(event, d: any) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('r', (d: any) => {
            const baseSize = Math.sqrt(d.view_count) / 80
            return Math.min(baseSize + 8, 40)
          })
        
        g.select('#tooltip').remove()
      })

    // Add drag behavior
    node.call(d3.drag<any, any>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null
      })
    )

    // Update positions on tick
    simulation.on('tick', () => {
      if (visualMode === 'semantic' && links.length > 0) {
        link
          .attr('x1', (d: any) => d.source.x)
          .attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x)
          .attr('y2', (d: any) => d.target.y)
      }
      
      node
        .attr('cx', (d: any) => d.x)
        .attr('cy', (d: any) => d.y)
    })

    return () => {
      simulation.stop()
    }
  }, [videos, selectedVideo, onSelectVideo, dimensions, visualMode, connectionThreshold])

  return (
    <svg 
      ref={svgRef} 
      width={dimensions.width} 
      height={dimensions.height}
      className="bg-gray-950"
      style={{ background: 'radial-gradient(circle at center, #111827 0%, #030712 100%)' }}
    />
  )
}

export default function DiscoveryPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [onlyOutliers, setOnlyOutliers] = useState(false)
  const [minViews, setMinViews] = useState(10000)
  const [videos, setVideos] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedVideo, setSelectedVideo] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [showGraph, setShowGraph] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [visualMode, setVisualMode] = useState<'semantic' | 'performance' | 'clusters'>('clusters')
  const [connectionThreshold, setConnectionThreshold] = useState(0.3)
  const [sampleMode, setSampleMode] = useState<'top' | 'recent' | 'random' | 'smart'>('smart')
  const [clusters, setClusters] = useState<any[]>([])
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)

  // Update dimensions on resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        })
      }
    }

    updateDimensions()
    window.addEventListener('resize', updateDimensions)
    return () => window.removeEventListener('resize', updateDimensions)
  }, [])

  // Fetch videos from API
  useEffect(() => {
    const fetchVideos = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({
          search: searchQuery,
          onlyOutliers: onlyOutliers.toString(),
          minViews: minViews.toString(),
          limit: '500',
          sampleMode: sampleMode
        })
        
        const response = await fetch(`/api/discovery/videos?${params}`)
        
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        
        const data = await response.json()
        
        if (data.videos) {
          setVideos(data.videos)
          setError(null)
        } else if (data.error) {
          setError(data.error)
        }
      } catch (error: any) {
        setError(error.message || 'Failed to fetch videos')
      } finally {
        setLoading(false)
      }
    }
    
    const timer = setTimeout(fetchVideos, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, onlyOutliers, minViews, selectedCluster])
  
  // Fetch clusters
  useEffect(() => {
    const fetchClusters = async () => {
      try {
        const response = await fetch('/api/discovery/clusters')
        const data = await response.json()
        if (data.clusters) {
          setClusters(data.clusters)
        }
      } catch (error) {
        console.error('Error fetching clusters:', error)
      }
    }
    
    if (visualMode === 'clusters') {
      fetchClusters()
    }
  }, [visualMode])

  // Get top outliers
  const topOutliers = videos
    .filter(v => v.isOutlier)
    .sort((a, b) => b.performance_ratio - a.performance_ratio)
    .slice(0, 5)

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium">Discovery</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {visualMode === 'clusters' 
                ? `${clusters.length} topic clusters from 50K+ videos`
                : `Showing ${videos.length.toLocaleString()} of 50K+ videos`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {showGraph && (
              <div className="flex items-center bg-gray-800 rounded-lg p-1">
                <Button
                  variant={visualMode === 'performance' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setVisualMode('performance')}
                  className="text-xs"
                >
                  Performance
                </Button>
                <Button
                  variant={visualMode === 'semantic' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setVisualMode('semantic')}
                  className="text-xs"
                >
                  Semantic
                </Button>
                <Button
                  variant={visualMode === 'clusters' ? "default" : "ghost"}
                  size="sm"
                  onClick={() => setVisualMode('clusters')}
                  className="text-xs"
                >
                  BERT Clusters
                </Button>
              </div>
            )}
            <Button
              variant={showGraph ? "default" : "ghost"}
              size="sm"
              onClick={() => setShowGraph(!showGraph)}
            >
              <BarChart3 className="w-4 h-4 mr-2" />
              {showGraph ? 'Hide' : 'Show'} Graph
            </Button>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Sidebar */}
        <aside className="w-80 border-r border-gray-800 bg-gray-900/50">
          <div className="p-4 space-y-4">
            {/* Search */}
            <div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                <Input
                  placeholder="Search videos..."
                  className="pl-10 bg-gray-800/50 border-gray-700 focus:border-gray-600"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Filters */}
            <div className="space-y-4 pt-4 border-t border-gray-800">
              <h3 className="text-sm font-medium text-gray-300">Filters</h3>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm text-gray-400">Outliers only</label>
                  <Switch
                    checked={onlyOutliers}
                    onCheckedChange={setOnlyOutliers}
                  />
                </div>
                
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-gray-400">Min views</label>
                    <span className="text-sm text-gray-300">{minViews.toLocaleString()}</span>
                  </div>
                  <Slider
                    value={[minViews]}
                    onValueChange={([value]) => setMinViews(value)}
                    max={1000000}
                    step={1000}
                    className="w-full"
                  />
                </div>
              </div>
              
              {visualMode === 'semantic' && showGraph && (
                <div className="mt-4 pt-4 border-t border-gray-800">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-sm text-gray-400">Connection threshold</label>
                    <span className="text-sm text-gray-300">{Math.round(connectionThreshold * 100)}%</span>
                  </div>
                  <Slider
                    value={[connectionThreshold]}
                    onValueChange={([value]) => setConnectionThreshold(value)}
                    min={0.1}
                    max={0.8}
                    step={0.1}
                    className="w-full"
                  />
                  <p className="text-xs text-gray-500 mt-2">
                    Shows connections with {Math.round(connectionThreshold * 100)}%+ similarity
                  </p>
                </div>
              )}
            </div>

            {/* Sampling Mode */}
            <div className="pt-4 border-t border-gray-800">
              <h3 className="text-sm font-medium text-gray-300 mb-3">Video Sample</h3>
              <div className="space-y-2">
                <button
                  onClick={() => setSampleMode('smart')}
                  className={`w-full text-left p-2 rounded text-sm ${
                    sampleMode === 'smart' ? 'bg-gray-700' : 'hover:bg-gray-800'
                  }`}
                >
                  <div className="font-medium">Smart Sample</div>
                  <div className="text-xs text-gray-400">Diverse mix across performance</div>
                </button>
                <button
                  onClick={() => setSampleMode('top')}
                  className={`w-full text-left p-2 rounded text-sm ${
                    sampleMode === 'top' ? 'bg-gray-700' : 'hover:bg-gray-800'
                  }`}
                >
                  <div className="font-medium">Top Performers</div>
                  <div className="text-xs text-gray-400">Highest view videos</div>
                </button>
                <button
                  onClick={() => setSampleMode('recent')}
                  className={`w-full text-left p-2 rounded text-sm ${
                    sampleMode === 'recent' ? 'bg-gray-700' : 'hover:bg-gray-800'
                  }`}
                >
                  <div className="font-medium">Recent</div>
                  <div className="text-xs text-gray-400">Latest uploads</div>
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-3">
                For performance, showing max 500 videos. Use search and filters to explore specific content.
              </p>
            </div>

            {/* Cluster Info */}
            {visualMode === 'clusters' && selectedCluster !== null && (
              <div className="pt-4 border-t border-gray-800">
                <h3 className="text-sm font-medium text-gray-300 mb-3">
                  Cluster Details
                </h3>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  {clusters.find(c => c.id === selectedCluster) && (
                    <div>
                      <p className="font-medium mb-2">
                        {clusters.find(c => c.id === selectedCluster).inferredTopic}
                      </p>
                      <p className="text-sm text-gray-400">
                        {clusters.find(c => c.id === selectedCluster).size} videos
                      </p>
                      <button
                        onClick={() => {
                          setSelectedCluster(null)
                          setVideos([])
                        }}
                        className="text-xs text-blue-400 hover:text-blue-300 mt-2"
                      >
                        ← Back to all clusters
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Top Outliers */}
            {topOutliers.length > 0 && visualMode !== 'clusters' && (
              <div className="pt-4 border-t border-gray-800">
                <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center">
                  <TrendingUp className="w-3.5 h-3.5 mr-1.5 text-amber-500" />
                  Top Performers
                </h3>
                <div className="space-y-2">
                  {topOutliers.map((video) => (
                    <button
                      key={video.id}
                      className="w-full text-left p-3 rounded-lg bg-gray-800/30 hover:bg-gray-800/50 transition-all duration-200 border border-gray-800 hover:border-gray-700"
                      onClick={() => setSelectedVideo(video)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm line-clamp-2">{video.title}</p>
                        <Badge className="bg-amber-500/10 text-amber-400 border-0 font-medium shrink-0">
                          {video.formattedRatio}x
                        </Badge>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{video.formattedViews} views</p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 relative">
          {error && (
            <div className="absolute top-4 left-4 right-4 p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400 z-10">
              {error}
            </div>
          )}

          {showGraph && !loading && (visualMode === 'clusters' ? clusters.length > 0 : videos.length > 0) ? (
            <div ref={containerRef} className="w-full h-full">
              {visualMode === 'clusters' ? (
                <ClusterVisualization
                  clusters={clusters}
                  videos={videos}
                  onSelectCluster={(clusterId: number) => {
                    setSelectedCluster(clusterId)
                    // Fetch videos from this cluster
                    const params = new URLSearchParams({
                      cluster: clusterId.toString(),
                      limit: '100'
                    })
                    fetch(`/api/discovery/videos?${params}`)
                      .then(res => res.json())
                      .then(data => {
                        if (data.videos) setVideos(data.videos)
                      })
                  }}
                  selectedCluster={selectedCluster}
                  dimensions={dimensions}
                />
              ) : (
                <ForceGraph
                  videos={videos}
                  selectedVideo={selectedVideo}
                  onSelectVideo={setSelectedVideo}
                  dimensions={dimensions}
                  visualMode={visualMode}
                  connectionThreshold={connectionThreshold}
                />
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                {loading ? (
                  <>
                    <div className="w-12 h-12 border-2 border-gray-700 border-t-gray-400 rounded-full animate-spin mx-auto mb-4" />
                    <p className="text-gray-400">Loading videos...</p>
                  </>
                ) : videos.length === 0 ? (
                  <>
                    <BarChart3 className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                    <p className="text-gray-400">No videos found</p>
                  </>
                ) : (
                  <>
                    <BarChart3 className="w-12 h-12 text-gray-700 mx-auto mb-4" />
                    <p className="text-gray-400">Enable graph view to see visualization</p>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Selected Video Panel */}
          {selectedVideo && (
            <div className="absolute right-0 top-0 bottom-0 w-96 bg-gray-900/95 backdrop-blur border-l border-gray-800 shadow-2xl overflow-y-auto">
              <div className="relative">
                <img
                  src={selectedVideo.thumbnail_url}
                  alt={selectedVideo.title}
                  className="w-full aspect-video object-cover"
                />
                <button
                  className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                  onClick={() => setSelectedVideo(null)}
                >
                  <X className="w-4 h-4" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-gray-900 to-transparent p-6 pt-12">
                  <h3 className="text-lg font-medium mb-1">{selectedVideo.title}</h3>
                  <p className="text-sm text-gray-400">{selectedVideo.channel_name}</p>
                </div>
              </div>

              <div className="p-6 space-y-6">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Views</p>
                    <p className="text-lg font-medium">{selectedVideo.formattedViews}</p>
                  </div>
                  <div className="bg-gray-800/50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">Performance</p>
                    <p className="text-lg font-medium text-amber-500">{selectedVideo.formattedRatio}x</p>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button 
                    className="flex-1"
                    onClick={() => window.open(`https://youtube.com/watch?v=${selectedVideo.id}`, '_blank')}
                  >
                    <Play className="w-4 h-4 mr-2" />
                    Watch
                  </Button>
                  <Button variant="secondary" className="flex-1">
                    <Sparkles className="w-4 h-4 mr-2" />
                    Analyze
                  </Button>
                </div>

                {/* Pattern Insights */}
                <div className="pt-4 border-t border-gray-800">
                  <h4 className="text-sm font-medium mb-3">Pattern Insights</h4>
                  <div className="space-y-2">
                    <div className="bg-gray-800/30 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Title Pattern</p>
                      <p className="text-sm font-mono">
                        {selectedVideo.title.includes('How') ? 'How-to Guide' : 
                         selectedVideo.title.includes('Why') ? 'Explanation' :
                         selectedVideo.title.match(/^\d+/) ? 'Listicle' : 'General'}
                      </p>
                    </div>
                    <div className="bg-gray-800/30 rounded-lg p-3">
                      <p className="text-xs text-gray-400 mb-1">Published</p>
                      <p className="text-sm">{new Date(selectedVideo.published_at).toLocaleDateString()}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}