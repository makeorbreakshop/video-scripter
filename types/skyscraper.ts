/**
 * TypeScript interfaces for the Skyscraper Analysis Framework
 * These interfaces match the database schema defined in sql/skyscraper-schema.sql
 */

export interface StructuralOrganizationSection {
  title: string;
  start_time: number;
  end_time: number;
  description: string;
}

export interface KeyPoint {
  point: string;
  timestamp: number;
  elaboration: string;
}

export interface TechnicalInformation {
  type: string;
  value: string;
  timestamp?: number;
}

export interface VisualElement {
  type: string;
  timestamp: number;
  description: string;
}

export interface ContentAnalysis {
  analysis_id?: string;
  video_id: string;
  title_positioning?: string;
  structural_organization: StructuralOrganizationSection[];
  key_points: KeyPoint[];
  technical_information: TechnicalInformation[];
  expertise_elements?: string;
  visual_elements: VisualElement[];
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface PraisePoint {
  element: string;
  frequency: number;
  quotes: string[];
}

export interface QuestionGap {
  question: string;
  frequency: number;
  similar_questions: string[];
}

export interface UseCase {
  scenario: string;
  frequency: number;
  context: string;
}

export interface DemographicSignals {
  beginner_percentage?: number;
  expert_percentage?: number;
  professional_percentage?: number;
  hobbyist_percentage?: number;
  age_signals?: string[];
  industry_signals?: string[];
}

export interface EngagementPattern {
  timestamp: number;
  reaction: string;
  trigger: string;
}

export interface AudienceAnalysis {
  audience_id?: string;
  video_id: string;
  sentiment_overview: {
    positive: number;
    neutral: number;
    negative: number;
    overall_score: number;
  };
  comment_count: number;
  praise_points: PraisePoint[];
  questions_gaps: QuestionGap[];
  use_cases: UseCase[];
  demographic_signals: DemographicSignals;
  engagement_patterns: EngagementPattern[];
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface MissingInformation {
  topic: string;
  evidence: string;
  opportunity_score: number;
}

export interface ContentGaps {
  gap_id?: string;
  video_id: string;
  missing_information: MissingInformation[];
  follow_up_opportunities?: string;
  clarity_issues?: string;
  depth_breadth_balance?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SectionRatio {
  intro_percentage: number;
  main_content_percentage: number;
  conclusion_percentage: number;
  call_to_action_percentage: number;
}

export interface StructureElements {
  structure_id?: string;
  video_id: string;
  overall_structure?: string;
  section_ratio: SectionRatio;
  information_hierarchy?: string;
  pacing_flow?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface HookStrategy {
  type: string;
  description: string;
  timestamp: number;
  duration: number;
}

export interface RetentionMechanism {
  type: string;
  timestamp: number;
  description: string;
}

export interface EngagementTechniques {
  engagement_id?: string;
  video_id: string;
  hook_strategy: HookStrategy;
  retention_mechanisms: RetentionMechanism[];
  pattern_interrupts?: string;
  interaction_prompts?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface ValueDelivery {
  value_id?: string;
  video_id: string;
  information_packaging?: string;
  problem_solution_framing?: string;
  practical_application?: string;
  trust_building?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface KeySection {
  section: string;
  importance: number;
  rationale: string;
}

export interface ImplementationBlueprint {
  blueprint_id?: string;
  video_id: string;
  content_template?: string;
  key_sections: KeySection[];
  engagement_points?: string;
  differentiation_opportunities?: string;
  cta_strategy?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

export interface SkyscraperAnalysisProgress {
  id?: string;
  video_id: string;
  content_analysis_complete: boolean;
  audience_analysis_complete: boolean;
  content_gaps_complete: boolean;
  structure_elements_complete: boolean;
  engagement_techniques_complete: boolean;
  value_delivery_complete: boolean;
  implementation_blueprint_complete: boolean;
  started_at?: string;
  completed_at?: string;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

// Extended Video interface with skyscraper-specific fields
export interface SkyscraperVideo {
  id: string;
  channel_id: string;
  title: string;
  description?: string;
  published_at: string;
  view_count: number;
  like_count?: number;
  comment_count?: number;
  duration?: string;
  channel_avg_views?: number;
  performance_ratio?: number;
  outlier_factor?: number;
  niche?: string;
  metadata?: Record<string, any>;
  user_id: string;
  created_at?: string;
  updated_at?: string;
}

// Aggregate type for a complete Skyscraper Analysis
export interface CompleteSkyscraperAnalysis {
  video: SkyscraperVideo;
  content_analysis?: ContentAnalysis;
  audience_analysis?: AudienceAnalysis;
  content_gaps?: ContentGaps;
  structure_elements?: StructureElements;
  engagement_techniques?: EngagementTechniques;
  value_delivery?: ValueDelivery;
  implementation_blueprint?: ImplementationBlueprint;
  progress: SkyscraperAnalysisProgress;
} 