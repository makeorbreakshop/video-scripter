"use client";

import { useState } from 'react'
import { toast } from 'sonner'

const sampleAnalysisData = {
  "content_analysis": {
    "structural_organization": [
      { "title": "Introduction", "start_time": "0:00", "end_time": "0:15", "description": "Laser Dave introduces the hack for heat glazing engraved acrylic to create an opaque effect" },
      { "title": "Materials", "start_time": "0:15", "end_time": "0:30", "description": "Explanation of materials needed (clear 1/4 inch cast acrylic) with QR code reference" },
      { "title": "Goal Explanation", "start_time": "0:30", "end_time": "0:45", "description": "Overview of creating a 3D relief pattern with glazed effect" },
      { "title": "File Preparation", "start_time": "0:45", "end_time": "1:00", "description": "Explanation of creating three separate files (cut, 3D relief, black overlay)" },
      { "title": "Process Demonstration", "start_time": "1:00", "end_time": "2:30", "description": "Step-by-step walkthrough of cutting, engraving, cleaning, and glazing" },
      { "title": "Conclusion", "start_time": "2:30", "end_time": "3:00", "description": "Final result showcase and call to action" }
    ],
    "key_points": [
      { "point": "File separation", "timestamp": "0:45", "elaboration": "Design must be split into three files: cut outline, 3D relief, and black overlay" },
      { "point": "Sequence importance", "timestamp": "1:15", "elaboration": "Cutting must be done first to prevent heat distortion of the 3D engraving" },
      { "point": "The glazing hack", "timestamp": "2:00", "elaboration": "Take laser 0.5 inches out of focus and reduce to 125 DPI to create glazing effect" },
      { "point": "Surface preparation", "timestamp": "1:45", "elaboration": "Clean residue with brass brush and compressed air between engraving and glazing" },
      { "point": "Template positioning", "timestamp": "1:10", "elaboration": "Create a template for precise positioning of the acrylic between processes" }
    ],
    "technical_information": [
      { "topic": "Laser specifications", "details": "Speedy 400 120-watt laser" },
      { "topic": "Relief engraving settings", "details": "100% power, 30 speed, 1000 DPI" },
      { "topic": "Glazing settings", "details": "Standard acrylic parameters with 0.5 inch defocus and 125 DPI" },
      { "topic": "Material", "details": "Quarter-inch (6mm) cast acrylic, optically clear" }
    ],
    "expertise_elements": "The video demonstrates advanced knowledge of laser physics by manipulating focus distance to control beam diameter and heat distribution. The presenter shows expertise in material science through understanding how acrylic responds to different heat applications, and reveals workflow optimization knowledge by explaining the proper sequence to prevent distortion.",
    "visual_elements": [
      { "element": "Finished product showcase", "purpose": "Demonstrates end result to hook viewer interest" },
      { "element": "Step-by-step process footage", "purpose": "Provides visual guidance for replication" },
      { "element": "QR code", "purpose": "Offers access to specific material information" },
      { "element": "Close-up shots", "purpose": "Shows detail of the effect for clarity" }
    ]
  },
  "audience_analysis": {
    "sentiment_overview": {
      "positive": 75,
      "neutral": 25,
      "negative": 0,
      "key_themes": ["appreciation for technique", "technical curiosity", "implementation questions", "amazement at results"]
    },
    "praise_points": [
      { "topic": "Visual effect quality", "frequency": "high", "examples": ["I am amazed at the scale engraving quality, just WOW!", "Amazing ⭐️☝️", "Damn... its really cool hack!"] },
      { "topic": "Tutorial quality", "frequency": "medium", "examples": ["These are Awesome Stricks & Tips!!!", "You Definitely Support your customers!!!"] },
      { "topic": "Resource provision", "frequency": "low", "examples": ["I think you are Literally the ONLY Manufacture who makes these detail of Videos with Down Loadable Cut Files"] }
    ],
    "questions_gaps": [
      { "question": "File preparation process", "frequency": "high", "context": "How to create files from scratch for different designs" },
      { "question": "Equipment compatibility", "frequency": "medium", "context": "Whether technique works with different laser models/software" },
      { "question": "Material variations", "frequency": "low", "context": "Whether other materials can achieve similar effects" },
      { "question": "Timing concerns", "frequency": "low", "context": "Process duration and efficiency" }
    ],
    "use_cases": [
      { "case": "Decorative signage", "context": "Creating unique visual displays with depth and translucency" },
      { "case": "Custom products", "context": "Producing distinctive acrylic items with premium appearance" },
      { "case": "Artistic pieces", "context": "Using the technique for creative expression in acrylic art" }
    ],
    "demographic_signals": {
      "expertise_level": "Mixed - from beginners to experienced laser operators",
      "industry_focus": ["Laser engraving businesses", "Makers/fabricators", "Sign producers", "Artists"],
      "notable_segments": ["International audience (multiple languages in comments)", "Existing Trotec customers", "Potential customers evaluating capabilities"]
    },
    "engagement_patterns": [
      { "pattern": "Technical questioning", "indicators": ["So how would a file actually be setup", "Won't running the laser att 100% massively shorten the lifespan", "I have a Question, my equipment it's a Speedy 400 flexx"] },
      { "pattern": "Implementation attempts", "indicators": ["I'm actually having some issues about glazing my acrylic panel", "I'll Try to explain: since now i printed with a UV printer"] },
      { "pattern": "Simple appreciation", "indicators": ["Amazing", "Nice 👌", "Спасибо!", "🙏"] }
    ]
  },
  "content_gaps": {
    "missing_information": [
      { "topic": "Design file creation", "importance": "high", "context": "How to create the three separate files from any design" },
      { "topic": "Alternative designs", "importance": "medium", "context": "Applying technique to designs other than fish scale pattern" },
      { "topic": "Troubleshooting", "importance": "medium", "context": "Common issues and solutions when attempting the technique" },
      { "topic": "Material variations", "importance": "low", "context": "Whether the technique works with colored or different types of acrylic" }
    ],
    "follow_up_opportunities": "Several clear opportunities exist for follow-up content: (1) detailed tutorial on creating the design files from scratch using graphic software, (2) variations of the technique with different patterns and effects, (3) common troubleshooting guide for issues like uneven glazing or lack of transparency, (4) advanced applications combining this technique with others for more complex products.",
    "clarity_issues": "The most significant clarity issue relates to file preparation - comments indicate confusion about how to create and set up the three required files. The video assumes viewers understand how to create relief files and doesn't explain the design process. Additionally, some viewers expressed confusion about how to adapt the technique to different designs.",
    "depth_breadth_balance": "The video offers excellent depth on the specific technique with the fish scale pattern but lacks breadth in terms of applications, variations, and adaptations. It's highly focused on one specific effect, which provides clarity but limits its applicability across different use cases. More examples or a brief showcase of different applications would improve balance."
  },
  "framework_elements": {
    "overall_structure": "The video follows a logical linear progression from introduction to conclusion with clear step-by-step instructions. It uses a goal-oriented approach, first stating what will be accomplished, then methodically showing each step required to achieve the result.",
    "section_ratios": {
      "introduction": 0.15,
      "main_content": 0.75,
      "conclusion": 0.1
    },
    "information_hierarchy": "Information flows from conceptual (what will be created) to practical (step-by-step process) to technical (specific machine settings). The video prioritizes the sequence of operations over deep explanations of why each works, focusing on replicability rather than theoretical understanding.",
    "pacing_flow": "The pacing is methodical and deliberate, with appropriate time dedicated to each step based on its complexity. The video moves efficiently without rushing, spending more time on the unique glazing technique which is the core innovation. Visual transitions between steps help maintain viewer orientation throughout the process."
  },
  "engagement_techniques": {
    "hook_strategy": "The video opens with a brief showcase of the final product - an impressive looking glazed acrylic piece with a unique visual effect - to immediately demonstrate value and grab attention. This shows the end result before explaining how to achieve it, motivating viewers to continue watching.",
    "retention_mechanisms": [
      { "technique": "Progressive revelation", "implementation": "Sequentially revealing each step of the process creates curiosity about the next phase", "effectiveness": "high" },
      { "technique": "Technical specificity", "implementation": "Providing exact settings and parameters gives viewers confidence in their ability to replicate", "effectiveness": "high" },
      { "technique": "Reasoning explanations", "implementation": "Explaining why certain steps are done in specific order (cutting first to prevent distortion)", "effectiveness": "medium" },
      { "technique": "Visual demonstration", "implementation": "Showing the process and results rather than just explaining them", "effectiveness": "high" }
    ],
    "pattern_interrupts": [
      { "type": "Transition between processes", "timestamp": "1:15", "purpose": "Maintains interest by shifting from cutting to engraving" },
      { "type": "Close-up detail shots", "timestamp": "1:45", "purpose": "Adds visual variety and highlights important details" },
      { "type": "Process explanation", "timestamp": "2:00", "purpose": "Breaks from demonstration to explain the 'hack' technique" }
    ],
    "interaction_prompts": [
      { "prompt_type": "Resource access", "implementation": "QR code for materials and downloadable design files" },
      { "prompt_type": "Question solicitation", "implementation": "Explicit invitation to leave questions in comments" },
      { "prompt_type": "Channel subscription", "implementation": "Request to like and subscribe for future laser hacks" }
    ]
  },
  "value_delivery": {
    "information_packaging": "Information is packaged as an actionable 'hack' - a specific technique that provides unique results not achievable through standard procedures. The presenter frames the content as specialized knowledge being shared from expert to viewer, positioning it as valuable insider information rather than basic instruction.",
    "problem_solution_framing": "The video addresses the implicit problem of creating visually distinctive acrylic pieces that stand out from standard engravings. The solution (out-of-focus glazing) is presented as a clever hack that transforms ordinary engravings into premium-looking products with minimal additional effort or equipment.",
    "practical_application": [
      { "application": "Premium signage", "context": "Creating upscale business signs with distinctive visual effects" },
      { "application": "Award plaques", "context": "Producing recognition items with elegant transparency effects" },
      { "application": "Decorative displays", "context": "Crafting artistic pieces that play with light and transparency" },
      { "application": "Branded products", "context": "Creating distinctive promotional items with luxury appearance" }
    ],
    "trust_building": [
      { "element": "Technical expertise demonstration", "implementation": "Showing deep understanding of laser physics and material interaction" },
      { "element": "Complete process transparency", "implementation": "Nothing is hidden; entire workflow is revealed including preparation steps" },
      { "element": "Company affiliation", "implementation": "Presenter identified as Trotec representative, lending institutional credibility" },
      { "element": "Resource provision", "implementation": "Offering downloadable files and material specifications without paywalls" }
    ]
  },
  "implementation_blueprint": {
    "content_template": "1. Hook: Show impressive final result\n2. Introduce technique and its unique value\n3. List materials and equipment needed\n4. Explain file preparation requirements\n5. Demonstrate process step-by-step with clear delineation between phases\n6. Highlight the key technical innovation (the 'hack')\n7. Show comparison between before and after\n8. Conclude with applications and call to action",
    "key_sections": [
      { "section": "Hook and introduction", "purpose": "Capture attention and establish value proposition", "content_guidance": "Show best example of final result and briefly explain what makes it special" },
      { "section": "Materials and preparation", "purpose": "Enable viewer replication", "content_guidance": "Be specific about materials, files, and preparation steps" },
      { "section": "Key innovation", "purpose": "Provide central value insight", "content_guidance": "Explain the 'hack' technique clearly with technical specifics" },
      { "section": "Process demonstration", "purpose": "Show practical implementation", "content_guidance": "Visual demonstration with commentary explaining each step" },
      { "section": "Result showcase", "purpose": "Reward viewer attention", "content_guidance": "Clear comparison between standard technique and enhanced technique" }
    ],
    "engagement_points": [
      { "point": "Initial result showcase", "implementation": "Show compelling finished piece within first 10 seconds" },
      { "point": "Technical explanation", "implementation": "Explain the physics behind the technique to build authority" },
      { "point": "Resource provision", "implementation": "Offer downloadable files and accessible materials information" },
      { "point": "Before/after comparison", "implementation": "Demonstrate transformation from standard to enhanced appearance" }
    ],
    "differentiation_opportunities": [
      { "opportunity": "Design complexity", "implementation": "Demonstrate technique with more complex designs beyond geometric patterns" },
      { "opportunity": "Material variations", "implementation": "Show effects on different colors and types of acrylic" },
      { "opportunity": "Combined techniques", "implementation": "Integrate with other laser techniques for more complex effects" },
      { "opportunity": "Application showcase", "implementation": "Show finished products in real-world applications" }
    ],
    "cta_strategy": "The video uses a multi-faceted CTA approach: encouraging questions in comments to boost engagement, directing to downloadable resources for immediate application, and promoting channel subscription for future techniques. This creates both immediate engagement and long-term connection, while providing tangible value through accessible resources."
  }
} as const

export default function TestPage() {
  const [isSaving, setIsSaving] = useState(false)
  const [debugInfo, setDebugInfo] = useState<any>(null)

  const handleTestSave = async () => {
    try {
      setIsSaving(true)
      console.log('Starting save operation...')
      console.log('Analysis data being sent:', sampleAnalysisData)

      // Add request details to debug info
      const requestBody = {
        videoId: 'ZLzusZLZMi4', // Real video ID from the database that matches this analysis
        userId: '00000000-0000-0000-0000-000000000000',
        modelId: 'claude-3-7-sonnet-20240620',
        analysisResults: sampleAnalysisData
      }
      console.log('Request body:', requestBody)

      const response = await fetch('/api/skyscraper/analyze-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      console.log('Response headers:', Object.fromEntries(response.headers.entries()))
      console.log('Response status:', response.status)

      const data = await response.json()
      console.log('Response data:', data)

      setDebugInfo({
        request: {
          url: '/api/skyscraper/analyze-single',
          method: 'POST',
          body: requestBody
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          data: data
        },
        timestamp: new Date().toISOString()
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status} - ${data.error || 'Unknown error'}`)
      }

      toast.success('Test analysis saved successfully!')
    } catch (error: any) {
      console.error('Error saving test analysis:', error)
      const errorMessage = error.message || 'Unknown error occurred'
      toast.error(`Failed to save: ${errorMessage}`)
      setDebugInfo((prev: any) => ({
        ...prev,
        error: {
          message: errorMessage,
          stack: error.stack,
          timestamp: new Date().toISOString()
        }
      }))
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Test Analysis Save</h1>
      
      <button
        onClick={handleTestSave}
        disabled={isSaving}
        className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded mb-6"
      >
        {isSaving ? 'Saving...' : 'Test Save to DB'}
      </button>

      {debugInfo && (
        <div className="mt-6 p-4 bg-gray-100 rounded">
          <h2 className="text-xl font-semibold mb-2">Debug Information</h2>
          <pre className="whitespace-pre-wrap bg-white p-4 rounded border">
            {JSON.stringify(debugInfo, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
} 