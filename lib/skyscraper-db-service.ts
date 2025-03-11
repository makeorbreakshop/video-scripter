/**
 * Skyscraper Analysis Database Service
 * Functions for interacting with the Skyscraper Analysis tables in Supabase
 */

import { supabase } from './supabase';
import {
  ContentAnalysis,
  AudienceAnalysis,
  ContentGaps,
  StructureElements,
  EngagementTechniques,
  ValueDelivery,
  ImplementationBlueprint,
  SkyscraperAnalysisProgress,
  CompleteSkyscraperAnalysis,
  SkyscraperVideo
} from '@/types/skyscraper';

/**
 * Initialize a new skyscraper analysis for a video
 * This creates the progress record and returns a complete (but empty) analysis object
 */
export async function initializeSkyscraperAnalysis(
  videoId: string,
  userId: string
): Promise<CompleteSkyscraperAnalysis | null> {
  try {
    // First get the video data
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (videoError || !videoData) {
      console.error('Error fetching video data:', videoError);
      return null;
    }

    // Create the progress record
    const { data: progressData, error: progressError } = await supabase
      .from('skyscraper_analysis_progress')
      .insert({
        video_id: videoId,
        user_id: userId,
        content_analysis_complete: false,
        audience_analysis_complete: false,
        content_gaps_complete: false,
        structure_elements_complete: false,
        engagement_techniques_complete: false,
        value_delivery_complete: false,
        implementation_blueprint_complete: false
      })
      .select()
      .single();

    if (progressError) {
      console.error('Error creating analysis progress:', progressError);
      return null;
    }

    // Return the initialized analysis object
    return {
      video: videoData as SkyscraperVideo,
      progress: progressData as SkyscraperAnalysisProgress
    };
  } catch (error) {
    console.error('Error initializing skyscraper analysis:', error);
    return null;
  }
}

/**
 * Get a complete skyscraper analysis for a video
 * This retrieves all components of the analysis
 */
export async function getCompleteSkyscraperAnalysis(
  videoId: string,
  userId: string
): Promise<CompleteSkyscraperAnalysis | null> {
  try {
    // Fetch the video data
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('*')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (videoError || !videoData) {
      console.error('Error fetching video data:', videoError);
      return null;
    }

    // Fetch the progress data
    const { data: progressData, error: progressError } = await supabase
      .from('skyscraper_analysis_progress')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    if (progressError) {
      console.error('Error fetching analysis progress:', progressError);
      // We don't return null here since the progress might not exist yet
    }

    // Fetch all the analysis components
    const { data: contentAnalysisData } = await supabase
      .from('content_analysis')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: audienceAnalysisData } = await supabase
      .from('audience_analysis')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: contentGapsData } = await supabase
      .from('content_gaps')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: structureElementsData } = await supabase
      .from('structure_elements')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: engagementTechniquesData } = await supabase
      .from('engagement_techniques')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: valueDeliveryData } = await supabase
      .from('value_delivery')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    const { data: implementationBlueprintData } = await supabase
      .from('implementation_blueprint')
      .select('*')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    // Return the complete analysis
    return {
      video: videoData as SkyscraperVideo,
      content_analysis: contentAnalysisData as ContentAnalysis,
      audience_analysis: audienceAnalysisData as AudienceAnalysis,
      content_gaps: contentGapsData as ContentGaps,
      structure_elements: structureElementsData as StructureElements,
      engagement_techniques: engagementTechniquesData as EngagementTechniques,
      value_delivery: valueDeliveryData as ValueDelivery,
      implementation_blueprint: implementationBlueprintData as ImplementationBlueprint,
      progress: progressData as SkyscraperAnalysisProgress || {
        video_id: videoId,
        user_id: userId,
        content_analysis_complete: !!contentAnalysisData,
        audience_analysis_complete: !!audienceAnalysisData,
        content_gaps_complete: !!contentGapsData,
        structure_elements_complete: !!structureElementsData,
        engagement_techniques_complete: !!engagementTechniquesData,
        value_delivery_complete: !!valueDeliveryData,
        implementation_blueprint_complete: !!implementationBlueprintData
      }
    };
  } catch (error) {
    console.error('Error fetching complete skyscraper analysis:', error);
    return null;
  }
}

/**
 * Save content analysis data
 */
export async function saveContentAnalysis(
  analysis: ContentAnalysis
): Promise<ContentAnalysis | null> {
  try {
    const { data, error } = await supabase
      .from('content_analysis')
      .upsert({
        video_id: analysis.video_id,
        user_id: analysis.user_id,
        title_positioning: analysis.title_positioning,
        structural_organization: analysis.structural_organization,
        key_points: analysis.key_points,
        technical_information: analysis.technical_information,
        expertise_elements: analysis.expertise_elements,
        visual_elements: analysis.visual_elements
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving content analysis:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(analysis.video_id, analysis.user_id, {
      content_analysis_complete: true
    });

    return data as ContentAnalysis;
  } catch (error) {
    console.error('Error in saveContentAnalysis:', error);
    return null;
  }
}

/**
 * Save audience analysis data
 */
export async function saveAudienceAnalysis(
  analysis: AudienceAnalysis
): Promise<AudienceAnalysis | null> {
  try {
    const { data, error } = await supabase
      .from('audience_analysis')
      .upsert({
        video_id: analysis.video_id,
        user_id: analysis.user_id,
        sentiment_overview: analysis.sentiment_overview,
        comment_count: analysis.comment_count,
        praise_points: analysis.praise_points,
        questions_gaps: analysis.questions_gaps,
        use_cases: analysis.use_cases,
        demographic_signals: analysis.demographic_signals,
        engagement_patterns: analysis.engagement_patterns
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving audience analysis:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(analysis.video_id, analysis.user_id, {
      audience_analysis_complete: true
    });

    return data as AudienceAnalysis;
  } catch (error) {
    console.error('Error in saveAudienceAnalysis:', error);
    return null;
  }
}

/**
 * Save content gaps data
 */
export async function saveContentGaps(
  gaps: ContentGaps
): Promise<ContentGaps | null> {
  try {
    const { data, error } = await supabase
      .from('content_gaps')
      .upsert({
        video_id: gaps.video_id,
        user_id: gaps.user_id,
        missing_information: gaps.missing_information,
        follow_up_opportunities: gaps.follow_up_opportunities,
        clarity_issues: gaps.clarity_issues,
        depth_breadth_balance: gaps.depth_breadth_balance
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving content gaps:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(gaps.video_id, gaps.user_id, {
      content_gaps_complete: true
    });

    return data as ContentGaps;
  } catch (error) {
    console.error('Error in saveContentGaps:', error);
    return null;
  }
}

/**
 * Save structure elements data
 */
export async function saveStructureElements(
  elements: StructureElements
): Promise<StructureElements | null> {
  try {
    const { data, error } = await supabase
      .from('structure_elements')
      .upsert({
        video_id: elements.video_id,
        user_id: elements.user_id,
        overall_structure: elements.overall_structure,
        section_ratio: elements.section_ratio,
        information_hierarchy: elements.information_hierarchy,
        pacing_flow: elements.pacing_flow
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving structure elements:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(elements.video_id, elements.user_id, {
      structure_elements_complete: true
    });

    return data as StructureElements;
  } catch (error) {
    console.error('Error in saveStructureElements:', error);
    return null;
  }
}

/**
 * Save engagement techniques data
 */
export async function saveEngagementTechniques(
  techniques: EngagementTechniques
): Promise<EngagementTechniques | null> {
  try {
    const { data, error } = await supabase
      .from('engagement_techniques')
      .upsert({
        video_id: techniques.video_id,
        user_id: techniques.user_id,
        hook_strategy: techniques.hook_strategy,
        retention_mechanisms: techniques.retention_mechanisms,
        pattern_interrupts: techniques.pattern_interrupts,
        interaction_prompts: techniques.interaction_prompts
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving engagement techniques:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(techniques.video_id, techniques.user_id, {
      engagement_techniques_complete: true
    });

    return data as EngagementTechniques;
  } catch (error) {
    console.error('Error in saveEngagementTechniques:', error);
    return null;
  }
}

/**
 * Save value delivery data
 */
export async function saveValueDelivery(
  delivery: ValueDelivery
): Promise<ValueDelivery | null> {
  try {
    const { data, error } = await supabase
      .from('value_delivery')
      .upsert({
        video_id: delivery.video_id,
        user_id: delivery.user_id,
        information_packaging: delivery.information_packaging,
        problem_solution_framing: delivery.problem_solution_framing,
        practical_application: delivery.practical_application,
        trust_building: delivery.trust_building
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving value delivery:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(delivery.video_id, delivery.user_id, {
      value_delivery_complete: true
    });

    return data as ValueDelivery;
  } catch (error) {
    console.error('Error in saveValueDelivery:', error);
    return null;
  }
}

/**
 * Save implementation blueprint data
 */
export async function saveImplementationBlueprint(
  blueprint: ImplementationBlueprint
): Promise<ImplementationBlueprint | null> {
  try {
    const { data, error } = await supabase
      .from('implementation_blueprint')
      .upsert({
        video_id: blueprint.video_id,
        user_id: blueprint.user_id,
        content_template: blueprint.content_template,
        key_sections: blueprint.key_sections,
        engagement_points: blueprint.engagement_points,
        differentiation_opportunities: blueprint.differentiation_opportunities,
        cta_strategy: blueprint.cta_strategy
      })
      .select()
      .single();

    if (error) {
      console.error('Error saving implementation blueprint:', error);
      return null;
    }

    // Update the progress
    await updateAnalysisProgress(blueprint.video_id, blueprint.user_id, {
      implementation_blueprint_complete: true
    });

    return data as ImplementationBlueprint;
  } catch (error) {
    console.error('Error in saveImplementationBlueprint:', error);
    return null;
  }
}

/**
 * Update analysis progress
 */
export async function updateAnalysisProgress(
  videoId: string,
  userId: string,
  progress: Partial<SkyscraperAnalysisProgress>
): Promise<SkyscraperAnalysisProgress | null> {
  try {
    // Check if the progress record exists
    const { data: existingData, error: checkError } = await supabase
      .from('skyscraper_analysis_progress')
      .select('id')
      .eq('video_id', videoId)
      .eq('user_id', userId)
      .single();

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking analysis progress:', checkError);
      return null;
    }

    let data;
    let error;

    if (existingData) {
      // Update existing record
      ({ data, error } = await supabase
        .from('skyscraper_analysis_progress')
        .update({
          ...progress,
          updated_at: new Date().toISOString()
        })
        .eq('video_id', videoId)
        .eq('user_id', userId)
        .select()
        .single());
    } else {
      // Insert new record
      ({ data, error } = await supabase
        .from('skyscraper_analysis_progress')
        .insert({
          video_id: videoId,
          user_id: userId,
          ...progress
        })
        .select()
        .single());
    }

    if (error) {
      console.error('Error updating analysis progress:', error);
      return null;
    }

    // If all components are complete, update the completed_at timestamp
    if (
      data.content_analysis_complete &&
      data.audience_analysis_complete &&
      data.content_gaps_complete &&
      data.structure_elements_complete &&
      data.engagement_techniques_complete &&
      data.value_delivery_complete &&
      data.implementation_blueprint_complete
    ) {
      const { data: updatedData, error: updateError } = await supabase
        .from('skyscraper_analysis_progress')
        .update({
          completed_at: new Date().toISOString()
        })
        .eq('id', data.id)
        .select()
        .single();

      if (updateError) {
        console.error('Error updating completion timestamp:', updateError);
      } else {
        return updatedData as SkyscraperAnalysisProgress;
      }
    }

    return data as SkyscraperAnalysisProgress;
  } catch (error) {
    console.error('Error in updateAnalysisProgress:', error);
    return null;
  }
}

/**
 * Get all videos that have skyscraper analysis data
 */
export async function getVideosWithSkyscraperAnalysis(
  userId: string
): Promise<SkyscraperVideo[]> {
  try {
    // First get all videos with progress data
    const { data: progressData, error: progressError } = await supabase
      .from('skyscraper_analysis_progress')
      .select('video_id')
      .eq('user_id', userId);

    if (progressError) {
      console.error('Error fetching analysis progress:', progressError);
      return [];
    }

    if (!progressData || progressData.length === 0) {
      return [];
    }

    // Get the video IDs
    const videoIds = progressData.map(item => item.video_id);

    // Fetch the videos
    const { data: videosData, error: videosError } = await supabase
      .from('videos')
      .select('*')
      .in('id', videoIds)
      .eq('user_id', userId);

    if (videosError) {
      console.error('Error fetching videos:', videosError);
      return [];
    }

    return videosData as SkyscraperVideo[];
  } catch (error) {
    console.error('Error in getVideosWithSkyscraperAnalysis:', error);
    return [];
  }
}

/**
 * Calculate video outlier factor based on channel average views
 */
export async function calculateOutlierFactor(
  videoId: string, 
  userId: string
): Promise<number | null> {
  try {
    // Get the video data
    const { data: videoData, error: videoError } = await supabase
      .from('videos')
      .select('view_count, channel_id')
      .eq('id', videoId)
      .eq('user_id', userId)
      .single();

    if (videoError || !videoData) {
      console.error('Error fetching video data:', videoError);
      return null;
    }

    // Get the channel's videos
    const { data: channelVideos, error: channelError } = await supabase
      .from('videos')
      .select('view_count')
      .eq('channel_id', videoData.channel_id)
      .eq('user_id', userId);

    if (channelError || !channelVideos || channelVideos.length === 0) {
      console.error('Error fetching channel videos:', channelError);
      return null;
    }

    // Calculate the channel average
    const totalViews = channelVideos.reduce((sum, video) => sum + video.view_count, 0);
    const averageViews = totalViews / channelVideos.length;

    // Calculate the outlier factor
    const outlierFactor = videoData.view_count / averageViews;

    // Update the video record
    const { error: updateError } = await supabase
      .from('videos')
      .update({
        channel_avg_views: averageViews,
        outlier_factor: outlierFactor
      })
      .eq('id', videoId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('Error updating video outlier factor:', updateError);
    }

    return outlierFactor;
  } catch (error) {
    console.error('Error in calculateOutlierFactor:', error);
    return null;
  }
} 