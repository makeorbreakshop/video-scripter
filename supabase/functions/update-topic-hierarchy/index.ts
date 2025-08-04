import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Hierarchy mapping - embedded to avoid file system access
const hierarchyMapping = {
  "0": { "name": "Woodworking Projects & Tool Reviews", "category": "DIY & Crafts", "subcategory": "Woodworking" },
  "1": { "name": "AI Business & Stock Trading", "category": "Business", "subcategory": "Finance & Trading" },
  "2": { "name": "Home Cleaning & Organization Routines", "category": "Lifestyle", "subcategory": "Home & Organization" },
  "3": { "name": "Running & Fitness Training", "category": "Health & Fitness", "subcategory": "Workouts" },
  "4": { "name": "Tiny Living & Alternative Housing", "category": "Lifestyle", "subcategory": "Alternative Living" },
  "5": { "name": "Tesla & Electric Vehicle Reviews", "category": "Technology", "subcategory": "Electric Vehicles" },
  "6": { "name": "Guitar Tutorials & Music Gear", "category": "Music", "subcategory": "Instruments" },
  "7": { "name": "Disney Parks & Travel Vlogs", "category": "Travel", "subcategory": "Theme Parks" },
  "8": { "name": "Live Streaming & 3D Content", "category": "Technology", "subcategory": "Other" },
  "9": { "name": "Instagram Marketing & E-commerce", "category": "Business", "subcategory": "Digital Marketing" },
  "10": { "name": "Audio Equipment & Music Production", "category": "Technology", "subcategory": "Audio Technology" },
  "11": { "name": "Stock Market & Real Estate Investing", "category": "Finance", "subcategory": "Investing" },
  "12": { "name": "Camera Gear & Photography Reviews", "category": "Technology", "subcategory": "Photography & Video" },
  "13": { "name": "Spanish Language Learning", "category": "Education", "subcategory": "Language Learning" },
  "14": { "name": "YouTube Channel Growth Strategies", "category": "Business", "subcategory": "Digital Marketing" },
  "15": { "name": "Creative Woodworking Ideas", "category": "DIY & Crafts", "subcategory": "Woodworking" }
  // Note: Full mapping will be loaded from request body
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get request body
    const { fullMapping, batchSize = 10, startFrom = 0 } = await req.json()
    
    // Use provided mapping or default
    const mapping = fullMapping || hierarchyMapping
    const clusterIds = Object.keys(mapping).map(id => parseInt(id)).sort((a, b) => a - b)
    
    // Create a ReadableStream for streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          controller.enqueue(encoder.encode(`data: {"status": "starting", "totalClusters": ${clusterIds.length}}\n\n`))

          let totalUpdated = 0
          let errors = 0

          // Process clusters in batches
          for (let i = startFrom; i < clusterIds.length; i += batchSize) {
            const batch = clusterIds.slice(i, Math.min(i + batchSize, clusterIds.length))
            
            controller.enqueue(encoder.encode(`data: {"status": "processing", "batch": ${Math.floor(i/batchSize) + 1}, "progress": ${i}/${clusterIds.length}}\n\n`))

            // Update each cluster in the batch
            for (const clusterId of batch) {
              const clusterMapping = mapping[clusterId.toString()]
              if (!clusterMapping) continue

              try {
                // Perform the update
                const { error, count } = await supabase
                  .from('videos')
                  .update({
                    topic_domain: clusterMapping.category,
                    topic_niche: clusterMapping.subcategory,
                    topic_micro: clusterMapping.name,
                    updated_at: new Date().toISOString()
                  })
                  .eq('topic_cluster_id', clusterId)

                if (error) throw error

                // Get actual count since update doesn't return it
                const { count: actualCount } = await supabase
                  .from('videos')
                  .select('*', { count: 'exact', head: true })
                  .eq('topic_cluster_id', clusterId)

                totalUpdated += actualCount || 0
                
                controller.enqueue(encoder.encode(`data: {"status": "updated", "clusterId": ${clusterId}, "count": ${actualCount}}\n\n`))
                
              } catch (error) {
                errors++
                controller.enqueue(encoder.encode(`data: {"status": "error", "clusterId": ${clusterId}, "error": "${error.message}"}\n\n`))
              }
            }

            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 100))
          }

          // Send completion
          controller.enqueue(encoder.encode(`data: {"status": "completed", "totalUpdated": ${totalUpdated}, "errors": ${errors}}\n\n`))
          
        } catch (error) {
          controller.enqueue(encoder.encode(`data: {"status": "fatal_error", "error": "${error.message}"}\n\n`))
        } finally {
          controller.close()
        }
      }
    })

    // Return streaming response
    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })


  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})