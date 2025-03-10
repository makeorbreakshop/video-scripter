export enum WorkflowPhase {
  Research = "research",
  Packaging = "packaging",
  Scripting = "scripting",
  Refinement = "refinement",
  Export = "export",
}

export type DocumentType = "notes" | "analysis" | "script" | "research" | "template"

export interface Document {
  id: string
  title: string
  type: DocumentType
  content: string
  createdAt: Date
  updatedAt: Date
  save?: () => Promise<Document>
}

export interface VideoMetadata {
  id: string
  title: string
  channelName: string
  viewCount: number
  likeCount: number
  publishDate: string
  transcript?: string
  topComments?: string[]
  hasProcessedData: boolean
}

export interface ResearchAnalysis {
  contentCoverage: string[]
  audienceReactions: string[]
  commonQuestions: string[]
  contentSuggestions: string[]
  isProcessed: boolean
  lastProcessed?: string
}

export interface ResearchData {
  videoUrls: string[]
  analyzedVideos?: VideoMetadata[]
  notes: string
  summary: string
  analysis?: ResearchAnalysis
}

export interface TitleOption {
  text: string
  score?: {
    curiosity: number
    alignment: number
    clarity: number
  }
}

export interface ThumbnailConcept {
  strategy: string
  variations: string[]
}

export interface VideoAnalysis {
  titleSuggestions: string[]
  thumbnailSuggestions: string[]
  contentGaps: string[]
  audienceInsights: string[]
  lastAnalyzed?: string
}

export interface PackagingData {
  titles: TitleOption[]
  thumbnailConcepts: ThumbnailConcept[]
  videoUrls?: string[]
  ideas?: string[]
  videoAnalysis?: VideoAnalysis
}

export interface IntroBrick {
  hook: string
  problem: string
  setup: string
  credibility: string
  transition: string
}

export interface MiddleBrick {
  id: string
  transition: string
  example: string
  application: string
  nextTransition: string
}

export interface EndBrick {
  transition: string
  callToAction: string
}

export interface ScriptingData {
  introBrick: IntroBrick
  middleBricks: MiddleBrick[]
  endBrick: EndBrick
}

export interface FeedbackItem {
  section: string
  feedback: string
  suggestion: string
}

export interface ChecklistItem {
  name: string
  checked: boolean
}

export interface RefinementData {
  feedback: FeedbackItem[]
  checklist: Record<string, boolean>
}

export interface ExportData {
  format: "plain" | "formatted" | "teleprompter"
}

