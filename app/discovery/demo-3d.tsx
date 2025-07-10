'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, Text, Billboard, Line, Html } from '@react-three/drei'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Filter, TrendingUp, Zap, Eye, Star, Play, X, ChevronRight, Sparkles, BarChart3, Layers } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

// Sample video data with simulated embeddings
const generateVideoData = () => {
  const topics = [
    'Productivity', 'Tech Reviews', 'DIY Projects', 'Cooking', 'Music Theory',
    'Fitness', 'Photography', 'Business', 'Science', 'Art Tutorials'
  ]
  
  const videos = []
  const now = new Date()
  
  for (let i = 0; i < 200; i++) {
    const topicIndex = Math.floor(Math.random() * topics.length)
    const viewCount = Math.floor(Math.random() * 1000000) + 1000
    const channelAvg = Math.floor(viewCount / (Math.random() * 5 + 1))
    const daysAgo = Math.floor(Math.random() * 365)
    
    videos.push({
      id: `video-${i}`,
      title: `${topics[topicIndex]} Video ${i}`,
      thumbnail: `https://picsum.photos/seed/${i}/320/180`,
      viewCount,
      channelAvg,
      performanceRatio: viewCount / channelAvg,
      topic: topics[topicIndex],
      publishedAt: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
      // Simulated 3D embedding coordinates
      position: [
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20,
        (Math.random() - 0.5) * 20
      ],
      cluster: topicIndex,
      isOutlier: viewCount / channelAvg > 3
    })
  }
  return videos
}

// Particle system for video nodes
function VideoNode({ video, onSelect, isHighlighted, showLabels }: any) {
  const mesh = useRef<THREE.Mesh>(null)
  const [hovered, setHovered] = useState(false)
  
  useFrame((state) => {
    if (mesh.current) {
      mesh.current.scale.setScalar(
        1 + (hovered ? 0.5 : 0) + (isHighlighted ? 0.3 : 0) + 
        Math.sin(state.clock.elapsedTime * 2 + video.position[0]) * 0.05
      )
    }
  })
  
  const color = video.isOutlier ? '#fbbf24' : `hsl(${video.cluster * 36}, 70%, 50%)`
  const size = Math.log(video.viewCount) / 10
  
  return (
    <group position={video.position}>
      <mesh
        ref={mesh}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onClick={() => onSelect(video)}
      >
        <sphereGeometry args={[size, 16, 16]} />
        <meshPhongMaterial 
          color={color}
          emissive={color}
          emissiveIntensity={video.isOutlier ? 0.5 : 0.2}
          opacity={isHighlighted ? 1 : 0.8}
          transparent
        />
      </mesh>
      
      {(hovered || showLabels) && (
        <Billboard>
          <Text
            position={[0, size + 0.5, 0]}
            fontSize={0.3}
            color="white"
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.05}
            outlineColor="black"
          >
            {video.title}
          </Text>
        </Billboard>
      )}
      
      {hovered && (
        <Html position={[0, size + 1, 0]} center>
          <div className="bg-black/90 text-white p-2 rounded-lg text-xs whitespace-nowrap">
            <div className="font-bold">{video.title}</div>
            <div className="text-gray-300">{video.viewCount.toLocaleString()} views</div>
            {video.isOutlier && (
              <div className="text-yellow-400">🔥 {video.performanceRatio.toFixed(1)}x average</div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

// Main 3D scene
function VideoGalaxy({ videos, selectedVideo, onSelectVideo, filters }: any) {
  const { camera } = useThree()
  
  const filteredVideos = useMemo(() => {
    return videos.filter((video: any) => {
      if (filters.onlyOutliers && !video.isOutlier) return false
      if (filters.minViews && video.viewCount < filters.minViews) return false
      if (filters.searchQuery) {
        return video.title.toLowerCase().includes(filters.searchQuery.toLowerCase())
      }
      return true
    })
  }, [videos, filters])
  
  useEffect(() => {
    if (selectedVideo) {
      camera.position.lerp(
        new THREE.Vector3(
          selectedVideo.position[0] + 5,
          selectedVideo.position[1] + 5,
          selectedVideo.position[2] + 5
        ),
        0.5
      )
    }
  }, [selectedVideo, camera])
  
  return (
    <>
      <ambientLight intensity={0.5} />
      <pointLight position={[10, 10, 10]} intensity={1} />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />
      
      {filteredVideos.map((video: any) => (
        <VideoNode
          key={video.id}
          video={video}
          onSelect={onSelectVideo}
          isHighlighted={selectedVideo?.id === video.id}
          showLabels={filters.showLabels}
        />
      ))}
      
      <OrbitControls
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        zoomSpeed={0.5}
        panSpeed={0.5}
        rotateSpeed={0.5}
      />
    </>
  )
}

// Outlier detection panel
function OutlierPanel({ videos, onSelectVideo }: any) {
  const outliers = videos
    .filter((v: any) => v.isOutlier)
    .sort((a: any, b: any) => b.performanceRatio - a.performanceRatio)
    .slice(0, 10)
  
  return (
    <Card className="p-4 bg-black/80 backdrop-blur border-yellow-500/20">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-yellow-500" />
        <h3 className="font-semibold text-yellow-500">Top Outliers</h3>
      </div>
      <div className="space-y-2">
        {outliers.map((video: any) => (
          <motion.div
            key={video.id}
            whileHover={{ scale: 1.02 }}
            className="p-2 bg-yellow-500/10 rounded-lg cursor-pointer border border-yellow-500/20"
            onClick={() => onSelectVideo(video)}
          >
            <div className="flex items-center justify-between">
              <div className="flex-1 truncate text-sm">{video.title}</div>
              <Badge variant="outline" className="ml-2 border-yellow-500 text-yellow-500">
                {video.performanceRatio.toFixed(1)}x
              </Badge>
            </div>
            <div className="text-xs text-gray-400 mt-1">
              {video.viewCount.toLocaleString()} views
            </div>
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

// Pattern extraction panel
function PatternExtractor({ selectedVideo }: any) {
  if (!selectedVideo) return null
  
  const patterns = {
    titleFormula: "How to [Action] in [Time]",
    powerWords: ["Secret", "Easy", "Simple", "Quick"],
    thumbnailStyle: "Before/After Split",
    avgLength: "12:34"
  }
  
  return (
    <Card className="p-4 bg-black/80 backdrop-blur">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-4 h-4 text-purple-500" />
        <h3 className="font-semibold">Extracted Patterns</h3>
      </div>
      <div className="space-y-3">
        <div>
          <div className="text-xs text-gray-400">Title Formula</div>
          <div className="text-sm font-mono bg-purple-500/10 p-2 rounded mt-1">
            {patterns.titleFormula}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-400">Power Words</div>
          <div className="flex gap-2 mt-1">
            {patterns.powerWords.map(word => (
              <Badge key={word} className="bg-purple-500/20 text-purple-300">
                {word}
              </Badge>
            ))}
          </div>
        </div>
        <Button className="w-full bg-purple-500 hover:bg-purple-600">
          Add to Pattern Bank
        </Button>
      </div>
    </Card>
  )
}

// Main discovery page with 3D
export default function Discovery3DPage() {
  const [videos] = useState(generateVideoData())
  const [selectedVideo, setSelectedVideo] = useState<any>(null)
  const [show3D, setShow3D] = useState(false)
  const [filters, setFilters] = useState({
    searchQuery: '',
    onlyOutliers: false,
    minViews: 0,
    showLabels: false
  })
  
  return (
    <div className="h-screen bg-gray-950 text-white flex">
      {/* Left Sidebar */}
      <div className="w-80 border-r border-gray-800 p-4 space-y-4 overflow-y-auto">
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent">
            Semantic Discovery
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Explore patterns across 50K+ videos
          </p>
        </div>
        
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search videos..."
            className="pl-10 bg-gray-900 border-gray-700"
            value={filters.searchQuery}
            onChange={(e) => setFilters({ ...filters, searchQuery: e.target.value })}
          />
        </div>
        
        {/* Enable 3D Toggle */}
        <Card className="p-4 bg-gray-900 border-gray-800">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">Enable 3D View</label>
            <Switch
              checked={show3D}
              onCheckedChange={setShow3D}
            />
          </div>
        </Card>
        
        {/* Filters */}
        <Card className="p-4 bg-gray-900 border-gray-800 space-y-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
          </h3>
          
          <div className="flex items-center justify-between">
            <label className="text-sm">Only Outliers</label>
            <Switch
              checked={filters.onlyOutliers}
              onCheckedChange={(checked) => setFilters({ ...filters, onlyOutliers: checked })}
            />
          </div>
          
          {show3D && (
            <div className="flex items-center justify-between">
              <label className="text-sm">Show Labels</label>
              <Switch
                checked={filters.showLabels}
                onCheckedChange={(checked) => setFilters({ ...filters, showLabels: checked })}
              />
            </div>
          )}
          
          <div>
            <label className="text-sm text-gray-400">Min Views: {filters.minViews.toLocaleString()}</label>
            <Slider
              value={[filters.minViews]}
              onValueChange={([value]) => setFilters({ ...filters, minViews: value })}
              max={100000}
              step={1000}
              className="mt-2"
            />
          </div>
        </Card>
        
        {/* Outliers Panel */}
        <OutlierPanel videos={videos} onSelectVideo={setSelectedVideo} />
      </div>
      
      {/* Main View */}
      <div className="flex-1 relative">
        {show3D ? (
          <Canvas camera={{ position: [0, 0, 30], fov: 60 }}>
            <fog attach="fog" args={['#0a0a0a', 30, 100]} />
            <VideoGalaxy
              videos={videos}
              selectedVideo={selectedVideo}
              onSelectVideo={setSelectedVideo}
              filters={filters}
            />
          </Canvas>
        ) : (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <Layers className="w-16 h-16 mx-auto text-gray-600 mb-4" />
              <h3 className="text-xl font-semibold mb-2">3D Semantic Visualization</h3>
              <p className="text-gray-400 max-w-md mx-auto mb-4">
                Toggle the 3D view switch in the sidebar to see interactive clustering visualization
              </p>
              <Button onClick={() => setShow3D(true)}>
                Enable 3D View
              </Button>
            </div>
          </div>
        )}
        
        {/* Selected Video Details */}
        <AnimatePresence>
          {selectedVideo && (
            <motion.div
              initial={{ opacity: 0, x: 100 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 100 }}
              className="absolute right-0 top-0 w-96 h-full p-4 space-y-4 overflow-y-auto"
            >
              <Card className="bg-black/90 backdrop-blur border-gray-700">
                <div className="relative">
                  <img
                    src={selectedVideo.thumbnail}
                    alt={selectedVideo.title}
                    className="w-full rounded-t-lg"
                  />
                  <Button
                    size="icon"
                    variant="ghost"
                    className="absolute top-2 right-2"
                    onClick={() => setSelectedVideo(null)}
                  >
                    <X className="w-4 h-4" />
                  </Button>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent rounded-t-lg" />
                  <div className="absolute bottom-4 left-4 right-4">
                    <h3 className="font-semibold text-lg">{selectedVideo.title}</h3>
                  </div>
                </div>
                
                <div className="p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-gray-400" />
                      <span>{selectedVideo.viewCount.toLocaleString()} views</span>
                    </div>
                    {selectedVideo.isOutlier && (
                      <Badge className="bg-yellow-500/20 text-yellow-300">
                        {selectedVideo.performanceRatio.toFixed(1)}x Outlier
                      </Badge>
                    )}
                  </div>
                  
                  <div className="flex gap-2">
                    <Button size="sm" className="flex-1">
                      <Play className="w-4 h-4 mr-1" />
                      Watch
                    </Button>
                    <Button size="sm" variant="outline" className="flex-1">
                      <Star className="w-4 h-4 mr-1" />
                      Save
                    </Button>
                  </div>
                </div>
              </Card>
              
              <PatternExtractor selectedVideo={selectedVideo} />
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Performance Stats Overlay */}
        <div className="absolute top-4 left-4 space-y-2">
          <Card className="px-3 py-2 bg-black/80 backdrop-blur border-gray-700">
            <div className="text-xs text-gray-400">Total Videos</div>
            <div className="text-lg font-bold">{videos.length.toLocaleString()}</div>
          </Card>
          <Card className="px-3 py-2 bg-black/80 backdrop-blur border-gray-700">
            <div className="text-xs text-gray-400">Outliers Found</div>
            <div className="text-lg font-bold text-yellow-500">
              {videos.filter((v: any) => v.isOutlier).length}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}