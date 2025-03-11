"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, MessageSquare, ScrollText } from "lucide-react";

export default function AnalysisDetailPage() {
  const params = useParams();
  const videoId = params.videoId as string;
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [video, setVideo] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [comments, setComments] = useState<any[]>([]);
  const [currentTab, setCurrentTab] = useState("analysis");
  
  // States for expandable sections
  const [contentExpanded, setContentExpanded] = useState(true);
  const [audienceExpanded, setAudienceExpanded] = useState(false);
  const [gapsExpanded, setGapsExpanded] = useState(false);
  const [structureExpanded, setStructureExpanded] = useState(false);
  const [engagementExpanded, setEngagementExpanded] = useState(false);
  const [valueExpanded, setValueExpanded] = useState(false);
  const [blueprintExpanded, setBlueprintExpanded] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        
        // Fetch analysis data
        const analysisResponse = await fetch(`/api/skyscraper/get-analysis?videoId=${videoId}`);
        
        if (!analysisResponse.ok) {
          throw new Error(`Failed to fetch analysis data: ${analysisResponse.status} ${analysisResponse.statusText}`);
        }
        
        const analysisData = await analysisResponse.json();
        setVideo(analysisData.video);
        setAnalysis(analysisData.analysis);
        
        // Fetch transcript
        try {
          const transcriptResponse = await fetch(`/api/vector/transcript?videoId=${videoId}`);
          if (transcriptResponse.ok) {
            const transcriptData = await transcriptResponse.json();
            setTranscript(transcriptData.transcript || []);
          } else {
            console.error("Transcript API error:", transcriptResponse.status, transcriptResponse.statusText);
          }
        } catch (transcriptError) {
          console.error("Failed to fetch transcript:", transcriptError);
        }
        
        // Fetch comments
        try {
          const commentsResponse = await fetch(`/api/vector/comments?videoId=${videoId}`);
          if (commentsResponse.ok) {
            const commentsData = await commentsResponse.json();
            setComments(commentsData.comments || []);
          } else {
            console.error("Comments API error:", commentsResponse.status, commentsResponse.statusText);
          }
        } catch (commentsError) {
          console.error("Failed to fetch comments:", commentsError);
        }
      } catch (error) {
        console.error("Error fetching data:", error);
        setError(error instanceof Error ? error.message : "An unknown error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (videoId) {
      fetchData();
    }
  }, [videoId]);

  // Function to render skyscraper analysis content
  const renderAnalysis = () => {
    if (!analysis) return <p>No analysis data available.</p>;
    
    // Check if we're dealing with a skyscraper analysis with structured data
    const isStructuredAnalysis = analysis.content_analysis || 
                                analysis.audience_analysis || 
                                analysis.content_gaps || 
                                analysis.structure_elements || 
                                analysis.engagement_techniques || 
                                analysis.value_delivery || 
                                analysis.implementation_blueprint;
    
    if (isStructuredAnalysis) {
      return (
        <div className="space-y-4 max-w-4xl mx-auto">
          {/* Display analysis metadata */}
          <section className="mb-8 border-b border-gray-700 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {analysis.model_used && (
                <div>
                  <h3 className="text-sm text-gray-400">Model</h3>
                  <p className="text-white">{analysis.model_used}</p>
                </div>
              )}
              {analysis.tokens_used && (
                <div>
                  <h3 className="text-sm text-gray-400">Tokens</h3>
                  <p className="text-white">{analysis.tokens_used.toLocaleString()}</p>
                </div>
              )}
              {analysis.cost && (
                <div>
                  <h3 className="text-sm text-gray-400">Cost</h3>
                  <p className="text-white">${analysis.cost.toFixed(4)}</p>
                </div>
              )}
              {analysis.created_at && (
                <div>
                  <h3 className="text-sm text-gray-400">Created</h3>
                  <p className="text-white">{new Date(analysis.created_at).toLocaleString()}</p>
                </div>
              )}
            </div>
          </section>
          
          {/* Content Analysis */}
          {analysis.content_analysis && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setContentExpanded(!contentExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Content Analysis</h2>
                <span>{contentExpanded ? '−' : '+'}</span>
              </button>
              
              {contentExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.content_analysis.expertise_elements && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Expertise Elements</h3>
                      <p className="text-gray-300">{analysis.content_analysis.expertise_elements}</p>
                    </div>
                  )}
                  
                  {analysis.content_analysis.structural_organization && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Structural Organization</h3>
                      <div className="space-y-3">
                        {analysis.content_analysis.structural_organization.map((section: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            <h4 className="font-medium text-white">{section.title}</h4>
                            {section.start_time && section.end_time && (
                              <p className="text-sm text-gray-400">
                                {section.start_time} - {section.end_time}
                              </p>
                            )}
                            {section.description && (
                              <p className="text-gray-300 mt-1">{section.description}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.content_analysis.key_points && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Key Points</h3>
                      <div className="space-y-3">
                        {analysis.content_analysis.key_points.map((point: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            <h4 className="font-medium text-white">{point.point}</h4>
                            {point.timestamp && (
                              <p className="text-sm text-gray-400">{point.timestamp}</p>
                            )}
                            {point.elaboration && (
                              <p className="text-gray-300 mt-1">{point.elaboration}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.content_analysis.technical_information && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Technical Information</h3>
                      <div className="space-y-3">
                        {analysis.content_analysis.technical_information.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            <h4 className="font-medium text-white">{item.topic}</h4>
                            {item.details && (
                              <p className="text-gray-300 mt-1">{item.details}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.content_analysis.visual_elements && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Visual Elements</h3>
                      <div className="space-y-3">
                        {analysis.content_analysis.visual_elements.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.element && <h4 className="font-medium text-white">{item.element}</h4>}
                            {item.description && <p className="text-gray-300 mt-1">{item.description}</p>}
                            {item.timestamp && <p className="text-sm text-gray-400">{item.timestamp}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Audience Analysis */}
          {analysis.audience_analysis && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setAudienceExpanded(!audienceExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Audience Analysis</h2>
                <span>{audienceExpanded ? '−' : '+'}</span>
              </button>
              
              {audienceExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.audience_analysis.sentiment_overview && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Sentiment Overview</h3>
                      <div className="flex flex-wrap gap-3 mb-4">
                        {analysis.audience_analysis.sentiment_overview.positive && (
                          <div className="inline-flex items-center">
                            <span className="text-green-400 font-medium">Positive: </span>
                            <span className="ml-1 text-white">{analysis.audience_analysis.sentiment_overview.positive}%</span>
                          </div>
                        )}
                        {analysis.audience_analysis.sentiment_overview.neutral && (
                          <div className="inline-flex items-center">
                            <span className="text-gray-400 font-medium">Neutral: </span>
                            <span className="ml-1 text-white">{analysis.audience_analysis.sentiment_overview.neutral}%</span>
                          </div>
                        )}
                        {analysis.audience_analysis.sentiment_overview.negative && (
                          <div className="inline-flex items-center">
                            <span className="text-red-400 font-medium">Negative: </span>
                            <span className="ml-1 text-white">{analysis.audience_analysis.sentiment_overview.negative}%</span>
                          </div>
                        )}
                      </div>
                      
                      {analysis.audience_analysis.sentiment_overview.key_themes && (
                        <div>
                          <h4 className="text-md font-medium text-gray-300 mb-2">Key Themes</h4>
                          <div className="flex flex-wrap gap-2">
                            {analysis.audience_analysis.sentiment_overview.key_themes.map((theme: string, i: number) => (
                              <span key={i} className="px-2 py-1 bg-gray-800 text-gray-300 rounded text-sm">
                                {theme}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {analysis.audience_analysis.demographic_signals && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Demographic Signals</h3>
                      {analysis.audience_analysis.demographic_signals.expertise_level && (
                        <div className="mb-3">
                          <h4 className="text-md font-medium text-gray-300 mb-1">Expertise Level</h4>
                          <p className="text-gray-300">{analysis.audience_analysis.demographic_signals.expertise_level}</p>
                        </div>
                      )}
                      
                      {analysis.audience_analysis.demographic_signals.industry_focus && (
                        <div className="mb-3">
                          <h4 className="text-md font-medium text-gray-300 mb-1">Industry Focus</h4>
                          <div className="flex flex-wrap gap-2">
                            {analysis.audience_analysis.demographic_signals.industry_focus.map((industry: string, i: number) => (
                              <span key={i} className="px-2 py-1 bg-gray-800 text-gray-300 rounded text-sm">
                                {industry}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {analysis.audience_analysis.demographic_signals.notable_segments && (
                        <div>
                          <h4 className="text-md font-medium text-gray-300 mb-1">Notable Segments</h4>
                          <ul className="list-disc ml-5 space-y-1 text-gray-300">
                            {analysis.audience_analysis.demographic_signals.notable_segments.map((segment: string, i: number) => (
                              <li key={i}>{segment}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {analysis.audience_analysis.use_cases && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Use Cases</h3>
                      <div className="space-y-3">
                        {analysis.audience_analysis.use_cases.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.case && <h4 className="font-medium text-white">{item.case}</h4>}
                            {item.audience && <p className="text-sm text-gray-400">Audience: {item.audience}</p>}
                            {item.context && <p className="text-gray-300 mt-1">{item.context}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.audience_analysis.praise_points && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Praise Points</h3>
                      <div className="space-y-3">
                        {analysis.audience_analysis.praise_points.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.point && <p className="text-gray-300">{item.point}</p>}
                            {item.frequency && <p className="text-sm text-gray-400 mt-1">Frequency: {item.frequency}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.audience_analysis.questions_gaps && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Questions & Gaps</h3>
                      <div className="space-y-3">
                        {analysis.audience_analysis.questions_gaps.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.question && <p className="text-gray-300">{item.question}</p>}
                            {item.frequency && <p className="text-sm text-gray-400 mt-1">Frequency: {item.frequency}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {analysis.audience_analysis.engagement_patterns && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Engagement Patterns</h3>
                      <div className="space-y-3">
                        {analysis.audience_analysis.engagement_patterns.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.pattern && <p className="font-medium text-white">{item.pattern}</p>}
                            {item.description && <p className="text-gray-300 mt-1">{item.description}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Content Gaps */}
          {analysis.content_gaps && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setGapsExpanded(!gapsExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Content Gaps</h2>
                <span>{gapsExpanded ? '−' : '+'}</span>
              </button>
              
              {gapsExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.content_gaps.clarity_issues && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Clarity Issues</h3>
                      <p className="text-gray-300">{analysis.content_gaps.clarity_issues}</p>
                    </div>
                  )}
                  
                  {analysis.content_gaps.missing_information && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Missing Information</h3>
                      <ul className="list-disc ml-5 space-y-1 text-gray-300">
                        {analysis.content_gaps.missing_information.map((item: any, i: number) => (
                          <li key={i}>
                            {typeof item === 'string' ? item : (item.topic || item.item || JSON.stringify(item))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {analysis.content_gaps.depth_breadth_balance && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Depth/Breadth Balance</h3>
                      <p className="text-gray-300">{analysis.content_gaps.depth_breadth_balance}</p>
                    </div>
                  )}
                  
                  {analysis.content_gaps.follow_up_opportunities && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Follow-up Opportunities</h3>
                      <p className="text-gray-300">{analysis.content_gaps.follow_up_opportunities}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Structure Elements */}
          {analysis.structure_elements && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setStructureExpanded(!structureExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Structure Elements</h2>
                <span>{structureExpanded ? '−' : '+'}</span>
              </button>
              
              {structureExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.structure_elements.overall_structure && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Overall Structure</h3>
                      <p className="text-gray-300">{analysis.structure_elements.overall_structure}</p>
                    </div>
                  )}
                  
                  {analysis.structure_elements.section_ratios && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Section Ratios</h3>
                      {Object.entries(analysis.structure_elements.section_ratios).map(([section, percentage]: [string, any]) => (
                        <div key={section} className="mb-2">
                          <div className="flex justify-between mb-1">
                            <span className="capitalize text-gray-300">{section}</span>
                            <span className="text-gray-400">{percentage}%</span>
                          </div>
                          <div className="w-full bg-gray-700 rounded-full h-1.5">
                            <div 
                              className="bg-blue-600 h-1.5 rounded-full" 
                              style={{ width: `${percentage}%` }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {analysis.structure_elements.information_hierarchy && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Information Hierarchy</h3>
                      <p className="text-gray-300">{analysis.structure_elements.information_hierarchy}</p>
                    </div>
                  )}
                  
                  {analysis.structure_elements.pacing_flow && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Pacing & Flow</h3>
                      <p className="text-gray-300">{analysis.structure_elements.pacing_flow}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Engagement Techniques */}
          {analysis.engagement_techniques && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setEngagementExpanded(!engagementExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Engagement Techniques</h2>
                <span>{engagementExpanded ? '−' : '+'}</span>
              </button>
              
              {engagementExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.engagement_techniques.hook_strategy && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Hook Strategy</h3>
                      <p className="text-gray-300">{analysis.engagement_techniques.hook_strategy}</p>
                    </div>
                  )}
                  
                  {analysis.engagement_techniques.retention_mechanisms && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Retention Mechanisms</h3>
                      <div className="space-y-3">
                        {analysis.engagement_techniques.retention_mechanisms.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.technique && <h4 className="font-medium text-white">{item.technique}</h4>}
                            {item.effectiveness && <p className="text-sm text-gray-400">Effectiveness: {item.effectiveness}</p>}
                            {item.implementation && <p className="text-gray-300 mt-1">{item.implementation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.engagement_techniques.pattern_interrupts && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Pattern Interrupts</h3>
                      <div className="space-y-3">
                        {analysis.engagement_techniques.pattern_interrupts.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.type && <h4 className="font-medium text-white">{item.type}</h4>}
                            {item.purpose && <p className="text-gray-300 mt-1">{item.purpose}</p>}
                            {item.timestamp && <p className="text-sm text-gray-400">Timestamp: {item.timestamp}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.engagement_techniques.interaction_prompts && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Interaction Prompts</h3>
                      <div className="space-y-3">
                        {analysis.engagement_techniques.interaction_prompts.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.prompt_type && <h4 className="font-medium text-white">{item.prompt_type}</h4>}
                            {item.implementation && <p className="text-gray-300 mt-1">{item.implementation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Value Delivery */}
          {analysis.value_delivery && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setValueExpanded(!valueExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Value Delivery</h2>
                <span>{valueExpanded ? '−' : '+'}</span>
              </button>
              
              {valueExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.value_delivery.information_packaging && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Information Packaging</h3>
                      <p className="text-gray-300">{analysis.value_delivery.information_packaging}</p>
                    </div>
                  )}
                  
                  {analysis.value_delivery.problem_solution_framing && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Problem-Solution Framing</h3>
                      <p className="text-gray-300">{analysis.value_delivery.problem_solution_framing}</p>
                    </div>
                  )}
                  
                  {analysis.value_delivery.practical_application && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Practical Application</h3>
                      <div className="space-y-3">
                        {analysis.value_delivery.practical_application.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.application && <h4 className="font-medium text-white">{item.application}</h4>}
                            {item.context && <p className="text-gray-300 mt-1">{item.context}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.value_delivery.trust_building && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Trust Building</h3>
                      <div className="space-y-3">
                        {analysis.value_delivery.trust_building.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.element && <h4 className="font-medium text-white">{item.element}</h4>}
                            {item.implementation && <p className="text-gray-300 mt-1">{item.implementation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
          
          {/* Implementation Blueprint */}
          {analysis.implementation_blueprint && (
            <section className="border border-gray-800 rounded-lg overflow-hidden mb-6">
              <button 
                onClick={() => setBlueprintExpanded(!blueprintExpanded)}
                className="w-full flex justify-between items-center p-4 bg-gray-900 hover:bg-gray-800 transition-colors text-left"
              >
                <h2 className="text-xl font-semibold text-white">Implementation Blueprint</h2>
                <span>{blueprintExpanded ? '−' : '+'}</span>
              </button>
              
              {blueprintExpanded && (
                <div className="p-4 space-y-6">
                  {analysis.implementation_blueprint.content_template && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Content Template</h3>
                      <pre className="whitespace-pre-line text-gray-300">{analysis.implementation_blueprint.content_template}</pre>
                    </div>
                  )}
                  
                  {analysis.implementation_blueprint.key_sections && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Key Sections</h3>
                      <div className="space-y-3">
                        {analysis.implementation_blueprint.key_sections.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.section && <h4 className="font-medium text-white">{item.section}</h4>}
                            {item.purpose && <p className="text-sm text-gray-400">{item.purpose}</p>}
                            {item.content_guidance && <p className="text-gray-300 mt-1">{item.content_guidance}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.implementation_blueprint.engagement_points && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Engagement Points</h3>
                      <div className="space-y-3">
                        {analysis.implementation_blueprint.engagement_points.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.point && <h4 className="font-medium text-white">{item.point}</h4>}
                            {item.implementation && <p className="text-gray-300 mt-1">{item.implementation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.implementation_blueprint.differentiation_opportunities && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">Differentiation Opportunities</h3>
                      <div className="space-y-3">
                        {analysis.implementation_blueprint.differentiation_opportunities.map((item: any, index: number) => (
                          <div key={index} className="pl-4 border-l-2 border-gray-700">
                            {item.opportunity && <h4 className="font-medium text-white">{item.opportunity}</h4>}
                            {item.implementation && <p className="text-gray-300 mt-1">{item.implementation}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {analysis.implementation_blueprint.cta_strategy && (
                    <div className="mb-6">
                      <h3 className="text-lg font-medium text-blue-400 mb-2">CTA Strategy</h3>
                      <p className="text-gray-300">{analysis.implementation_blueprint.cta_strategy}</p>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      );
    }
    
    // If we're dealing with an unstructured analysis, use the old rendering approach
    return (
      <div className="space-y-8">
        {analysis.findingsAndInsights && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Key Findings & Insights</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.findingsAndInsights.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
        
        {analysis.audiences && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Target Audiences</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.audiences.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
        
        {analysis.narrativeStructure && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Narrative Structure</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.narrativeStructure.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
        
        {analysis.contentStrategy && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Content Strategy</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.contentStrategy.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
        
        {analysis.engagement && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Engagement Analysis</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.engagement.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
        
        {analysis.recommendations && (
          <section className="space-y-4">
            <h2 className="text-2xl font-bold">Recommendations</h2>
            <div className="prose prose-invert max-w-none">
              <div dangerouslySetInnerHTML={{ __html: analysis.recommendations.replace(/\n/g, '<br/>') }} />
            </div>
          </section>
        )}
      </div>
    );
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950 text-white p-6">
        <Card className="w-full max-w-5xl bg-gray-900 border-gray-800">
          <CardContent className="p-6">
            <div className="text-center py-12">
              <div className="bg-red-900/20 rounded-full p-3 w-16 h-16 mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <h2 className="text-xl font-semibold text-red-400 mb-2">Error Loading Analysis</h2>
              <p className="text-gray-400">{error}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <Card className="w-full max-w-6xl mx-auto bg-gray-900 border-gray-800">
        <CardContent className="p-6">
          {loading ? (
            <div className="space-y-6">
              <Skeleton className="h-8 w-3/4 bg-gray-800" />
              <Skeleton className="h-6 w-1/2 bg-gray-800" />
              <Skeleton className="h-96 w-full bg-gray-800" />
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h1 className="text-2xl font-bold text-white">{video?.title}</h1>
                <p className="text-gray-400">Channel: {video?.channel_id}</p>
              </div>
              
              <Tabs value={currentTab} onValueChange={setCurrentTab} className="w-full">
                <TabsList className="w-full bg-gray-800 mb-6">
                  <TabsTrigger value="analysis" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
                    <ScrollText className="h-4 w-4" />
                    <span>Skyscraper Analysis</span>
                  </TabsTrigger>
                  <TabsTrigger value="transcript" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
                    <FileText className="h-4 w-4" />
                    <span>Transcript</span>
                  </TabsTrigger>
                  <TabsTrigger value="comments" className="flex items-center gap-2 data-[state=active]:bg-gray-700">
                    <MessageSquare className="h-4 w-4" />
                    <span>Comments</span>
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="analysis" className="mt-0">
                  <div className="bg-gray-800/50 rounded-lg p-6">
                    {renderAnalysis()}
                  </div>
                </TabsContent>
                
                <TabsContent value="transcript" className="mt-0">
                  <div className="bg-gray-800/50 rounded-lg p-6 max-h-[70vh] overflow-y-auto">
                    {transcript ? (
                      <pre className="whitespace-pre-wrap text-gray-300 font-mono text-sm">{transcript}</pre>
                    ) : (
                      <p className="text-gray-400 italic">No transcript available for this video.</p>
                    )}
                  </div>
                </TabsContent>
                
                <TabsContent value="comments" className="mt-0">
                  <div className="bg-gray-800/50 rounded-lg p-6 max-h-[70vh] overflow-y-auto">
                    {comments && comments.length > 0 ? (
                      <div className="space-y-4">
                        {/* Group comments by cluster */}
                        {(() => {
                          // Create map of comments by cluster keywords 
                          const commentsByCluster: Record<string, any[]> = {};
                          
                          // Group comments by their cluster keywords for better organization
                          comments.forEach(comment => {
                            const clusterKey = comment.cluster && comment.cluster.keywords ? 
                              comment.cluster.keywords.sort().join(',') : 'uncategorized';
                            
                            if (!commentsByCluster[clusterKey]) {
                              commentsByCluster[clusterKey] = [];
                            }
                            commentsByCluster[clusterKey].push(comment);
                          });
                          
                          // Render each cluster group
                          return Object.entries(commentsByCluster).map(([clusterKey, clusterComments], groupIndex) => {
                            const firstComment = clusterComments[0];
                            const keywords = firstComment.cluster?.keywords || [];
                            const commentCount = firstComment.cluster?.commentCount || clusterComments.length;
                            const authorCount = firstComment.cluster?.authorCount || 1;
                            
                            return (
                              <div key={groupIndex} className="mb-6">
                                {/* Cluster heading with statistics */}
                                {clusterKey !== 'uncategorized' && keywords.length > 0 && (
                                  <div className="mb-3 flex items-center justify-between">
                                    <div className="flex flex-wrap gap-2">
                                      {keywords.map((keyword: string, kidx: number) => (
                                        <span key={kidx} className="text-sm bg-gray-700 text-gray-300 rounded-full px-3 py-1">
                                          {keyword}
                                        </span>
                                      ))}
                                    </div>
                                    <span className="text-xs text-gray-400">
                                      {commentCount} comments from {authorCount} users
                                    </span>
                                  </div>
                                )}
                                
                                {/* Individual comments */}
                                <div className="space-y-3">
                                  {clusterComments.map((comment, index) => (
                                    <div key={index} className="bg-gray-900 rounded-lg p-4">
                                      <div className="flex justify-between items-center mb-2">
                                        <span className="font-medium text-gray-300">
                                          {comment.author || 'Anonymous'}
                                        </span>
                                      </div>
                                      <p className="text-gray-200 whitespace-pre-line">{comment.text}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">No comments available for this video.</p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
} 