/**
 * Formats Skyscraper analysis data as readable markdown
 */
export function formatAnalysisMarkdown(videoData: { 
  title: string; 
  channelTitle: string; 
}, analysisData: any): string {
  // Create a title
  let markdown = `# Skyscraper Analysis: ${videoData.title}\n\n`;
  markdown += `**Channel:** ${videoData.channelTitle}\n`;
  markdown += `**Analysis Date:** ${new Date(analysisData.created_at).toLocaleDateString()}\n`;
  markdown += `**Model Used:** ${analysisData.model_used}\n\n`;

  // Add a table of contents
  markdown += `## Table of Contents\n\n`;
  markdown += `1. [Content Analysis](#content-analysis)\n`;
  markdown += `2. [Audience Analysis](#audience-analysis)\n`;
  markdown += `3. [Content Gaps](#content-gaps)\n`;
  markdown += `4. [Structure Elements](#structure-elements)\n`;
  markdown += `5. [Engagement Techniques](#engagement-techniques)\n`;
  markdown += `6. [Value Delivery](#value-delivery)\n`;
  markdown += `7. [Implementation Blueprint](#implementation-blueprint)\n\n`;

  // 1. Content Analysis
  markdown += `## Content Analysis\n\n`;
  
  if (analysisData.content_analysis) {
    // Structural Organization
    if (analysisData.content_analysis.structural_organization) {
      markdown += `### Structural Organization\n\n`;
      
      // Create a table for structural organization
      markdown += `| Section | Time Range | Description |\n`;
      markdown += `|---------|------------|-------------|\n`;
      
      analysisData.content_analysis.structural_organization.forEach((section: any) => {
        markdown += `| ${section.title} | ${section.start_time} - ${section.end_time} | ${section.description} |\n`;
      });
      
      markdown += `\n`;
    }
    
    // Key Points
    if (analysisData.content_analysis.key_points) {
      markdown += `### Key Points\n\n`;
      
      analysisData.content_analysis.key_points.forEach((point: any, index: number) => {
        markdown += `${index + 1}. **${point.point}** (${point.timestamp})\n   ${point.elaboration}\n\n`;
      });
    }
    
    // Technical Information
    if (analysisData.content_analysis.technical_information) {
      markdown += `### Technical Information\n\n`;
      
      analysisData.content_analysis.technical_information.forEach((item: any) => {
        markdown += `- **${item.topic}**: ${item.details}\n`;
      });
      
      markdown += `\n`;
    }
    
    // Expertise Elements
    if (analysisData.content_analysis.expertise_elements) {
      markdown += `### Expertise Elements\n\n`;
      markdown += `${analysisData.content_analysis.expertise_elements}\n\n`;
    }
    
    // Visual Elements
    if (analysisData.content_analysis.visual_elements) {
      markdown += `### Visual Elements\n\n`;
      
      analysisData.content_analysis.visual_elements.forEach((element: any) => {
        markdown += `- **${element.element}**: ${element.purpose}\n`;
      });
      
      markdown += `\n`;
    }
  }

  // 2. Audience Analysis
  markdown += `## Audience Analysis\n\n`;
  
  if (analysisData.audience_analysis) {
    // Sentiment Overview
    if (analysisData.audience_analysis.sentiment_overview) {
      markdown += `### Sentiment Overview\n\n`;
      
      const sentiment = analysisData.audience_analysis.sentiment_overview;
      
      markdown += `- **Positive**: ${sentiment.positive * 100}%\n`;
      markdown += `- **Neutral**: ${sentiment.neutral * 100}%\n`;
      markdown += `- **Negative**: ${sentiment.negative * 100}%\n\n`;
      
      if (sentiment.key_themes) {
        markdown += `**Key Themes:**\n\n`;
        sentiment.key_themes.forEach((theme: string) => {
          markdown += `- ${theme}\n`;
        });
        markdown += `\n`;
      }
    }
    
    // Praise Points
    if (analysisData.audience_analysis.praise_points) {
      markdown += `### Praise Points\n\n`;
      
      analysisData.audience_analysis.praise_points.forEach((point: any) => {
        markdown += `- **${point.topic}** (${point.frequency})\n  Examples: ${point.examples.join(', ')}\n\n`;
      });
    }
    
    // Questions and Gaps
    if (analysisData.audience_analysis.questions_gaps) {
      markdown += `### Questions & Gaps\n\n`;
      
      analysisData.audience_analysis.questions_gaps.forEach((item: any) => {
        markdown += `- **${item.question}** (${item.frequency})\n  Context: ${item.context}\n\n`;
      });
    }
    
    // Use Cases
    if (analysisData.audience_analysis.use_cases) {
      markdown += `### Use Cases\n\n`;
      
      analysisData.audience_analysis.use_cases.forEach((useCase: any) => {
        markdown += `- **${useCase.case}**: ${useCase.context}\n`;
      });
      
      markdown += `\n`;
    }
    
    // Demographic Signals
    if (analysisData.audience_analysis.demographic_signals) {
      markdown += `### Demographic Signals\n\n`;
      
      const demographics = analysisData.audience_analysis.demographic_signals;
      
      markdown += `- **Expertise Level**: ${demographics.expertise_level}\n`;
      markdown += `- **Industry Focus**: ${demographics.industry_focus.join(', ')}\n`;
      markdown += `- **Notable Segments**: ${demographics.notable_segments.join(', ')}\n\n`;
    }
    
    // Engagement Patterns
    if (analysisData.audience_analysis.engagement_patterns) {
      markdown += `### Engagement Patterns\n\n`;
      
      analysisData.audience_analysis.engagement_patterns.forEach((pattern: any) => {
        markdown += `- **${pattern.pattern}**\n  Indicators: ${pattern.indicators.join(', ')}\n\n`;
      });
    }
  }

  // 3. Content Gaps
  markdown += `## Content Gaps\n\n`;
  
  if (analysisData.content_gaps) {
    // Missing Information
    if (analysisData.content_gaps.missing_information) {
      markdown += `### Missing Information\n\n`;
      
      analysisData.content_gaps.missing_information.forEach((item: any) => {
        markdown += `- **${item.topic}** (${item.importance})\n  Context: ${item.context}\n\n`;
      });
    }
    
    // Follow-up Opportunities
    if (analysisData.content_gaps.follow_up_opportunities) {
      markdown += `### Follow-up Opportunities\n\n`;
      markdown += `${analysisData.content_gaps.follow_up_opportunities}\n\n`;
    }
    
    // Clarity Issues
    if (analysisData.content_gaps.clarity_issues) {
      markdown += `### Clarity Issues\n\n`;
      markdown += `${analysisData.content_gaps.clarity_issues}\n\n`;
    }
    
    // Depth/Breadth Balance
    if (analysisData.content_gaps.depth_breadth_balance) {
      markdown += `### Depth/Breadth Balance\n\n`;
      markdown += `${analysisData.content_gaps.depth_breadth_balance}\n\n`;
    }
  }

  // 4. Structure Elements (formerly Framework Elements)
  markdown += `## Structure Elements\n\n`;

  if (analysisData.structure_elements) {
    // Overall Structure
    if (analysisData.structure_elements.overall_structure) {
      markdown += `### Overall Structure\n\n`;
      markdown += `${analysisData.structure_elements.overall_structure}\n\n`;
    }
    
    // Section Ratios
    if (analysisData.structure_elements.section_ratios) {
      markdown += `### Section Ratios\n\n`;
      
      const ratios = analysisData.structure_elements.section_ratios;
      
      // Use Object.entries to handle any keys that might be present
      Object.entries(ratios).forEach(([key, value]) => {
        markdown += `- **${key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ')}**: ${(value as number) * 100}%\n`;
      });
      
      markdown += `\n`;
    }
    
    // Information Hierarchy
    if (analysisData.structure_elements.information_hierarchy) {
      markdown += `### Information Hierarchy\n\n`;
      markdown += `${analysisData.structure_elements.information_hierarchy}\n\n`;
    }
    
    // Pacing & Flow
    if (analysisData.structure_elements.pacing_flow) {
      markdown += `### Pacing & Flow\n\n`;
      markdown += `${analysisData.structure_elements.pacing_flow}\n\n`;
    }
  }

  // 5. Engagement Techniques
  markdown += `## Engagement Techniques\n\n`;
  
  if (analysisData.engagement_techniques) {
    // Hook Strategy
    if (analysisData.engagement_techniques.hook_strategy) {
      markdown += `### Hook Strategy\n\n`;
      
      // Handle both string and object formats
      if (typeof analysisData.engagement_techniques.hook_strategy === 'string') {
        markdown += `${analysisData.engagement_techniques.hook_strategy}\n\n`;
      } else {
        const hook = analysisData.engagement_techniques.hook_strategy;
        if (hook.type) markdown += `- **Type**: ${hook.type}\n`;
        if (hook.description) markdown += `- **Description**: ${hook.description}\n`;
        if (hook.effectiveness) markdown += `- **Effectiveness**: ${hook.effectiveness}\n`;
        markdown += `\n`;
      }
    }
    
    // Retention Mechanisms
    if (analysisData.engagement_techniques.retention_mechanisms) {
      markdown += `### Retention Mechanisms\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.engagement_techniques.retention_mechanisms)) {
        analysisData.engagement_techniques.retention_mechanisms.forEach((mechanism: any) => {
          markdown += `- **${mechanism.technique}**`;
          if (mechanism.effectiveness) markdown += ` (${mechanism.effectiveness})`;
          if (mechanism.implementation) markdown += `: ${mechanism.implementation}`;
          else if (mechanism.description) markdown += `: ${mechanism.description}`;
          markdown += `\n`;
        });
      } else {
        markdown += `${analysisData.engagement_techniques.retention_mechanisms}\n`;
      }
      
      markdown += `\n`;
    }
    
    // Pattern Interrupts
    if (analysisData.engagement_techniques.pattern_interrupts) {
      markdown += `### Pattern Interrupts\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.engagement_techniques.pattern_interrupts)) {
        analysisData.engagement_techniques.pattern_interrupts.forEach((interrupt: any) => {
          markdown += `- **${interrupt.type}**`;
          if (interrupt.timestamp) markdown += ` (${interrupt.timestamp})`;
          if (interrupt.purpose) markdown += `: ${interrupt.purpose}`;
          markdown += `\n`;
        });
      } else {
        markdown += `${analysisData.engagement_techniques.pattern_interrupts}\n`;
      }
      
      markdown += `\n`;
    }
    
    // Interaction Prompts
    if (analysisData.engagement_techniques.interaction_prompts) {
      markdown += `### Interaction Prompts\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.engagement_techniques.interaction_prompts)) {
        analysisData.engagement_techniques.interaction_prompts.forEach((prompt: any) => {
          markdown += `- **${prompt.prompt_type}**`;
          if (prompt.implementation) markdown += `: ${prompt.implementation}`;
          markdown += `\n`;
        });
      } else {
        markdown += `${analysisData.engagement_techniques.interaction_prompts}\n`;
      }
      
      markdown += `\n`;
    }
  }

  // 6. Value Delivery
  markdown += `## Value Delivery\n\n`;
  
  if (analysisData.value_delivery) {
    // Information Packaging
    if (analysisData.value_delivery.information_packaging) {
      markdown += `### Information Packaging\n\n`;
      markdown += `${analysisData.value_delivery.information_packaging}\n\n`;
    }
    
    // Problem-Solution Framing
    if (analysisData.value_delivery.problem_solution_framing) {
      markdown += `### Problem-Solution Framing\n\n`;
      markdown += `${analysisData.value_delivery.problem_solution_framing}\n\n`;
    }
    
    // Practical Application
    if (analysisData.value_delivery.practical_application) {
      markdown += `### Practical Application\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.value_delivery.practical_application)) {
        analysisData.value_delivery.practical_application.forEach((item: any) => {
          if (item.application && item.context) {
            markdown += `- **${item.application}**: ${item.context}\n`;
          } else {
            markdown += `- ${JSON.stringify(item)}\n`;
          }
        });
      } else {
        markdown += `${analysisData.value_delivery.practical_application}\n`;
      }
      
      markdown += `\n`;
    }
    
    // Trust Building
    if (analysisData.value_delivery.trust_building) {
      markdown += `### Trust Building\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.value_delivery.trust_building)) {
        analysisData.value_delivery.trust_building.forEach((item: any) => {
          if (item.element && item.implementation) {
            markdown += `- **${item.element}**: ${item.implementation}\n`;
          } else {
            markdown += `- ${JSON.stringify(item)}\n`;
          }
        });
      } else {
        markdown += `${analysisData.value_delivery.trust_building}\n`;
      }
      
      markdown += `\n`;
    }
  }

  // 7. Implementation Blueprint
  markdown += `## Implementation Blueprint\n\n`;
  
  if (analysisData.implementation_blueprint) {
    // Content Template
    if (analysisData.implementation_blueprint.content_template) {
      markdown += `### Content Template\n\n`;
      markdown += `${analysisData.implementation_blueprint.content_template}\n\n`;
    }
    
    // Key Sections
    if (analysisData.implementation_blueprint.key_sections) {
      markdown += `### Key Sections\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.implementation_blueprint.key_sections)) {
        analysisData.implementation_blueprint.key_sections.forEach((section: any) => {
          if (section.section && section.purpose) {
            markdown += `- **${section.section}** (${section.purpose})`;
            if (section.content_guidance) markdown += `: ${section.content_guidance}`;
            markdown += `\n`;
          } else if (section.name && section.description) {
            markdown += `- **${section.name}**: ${section.description}\n`;
          } else {
            markdown += `- ${JSON.stringify(section)}\n`;
          }
        });
      } else {
        markdown += `${analysisData.implementation_blueprint.key_sections}\n`;
      }
      
      markdown += `\n`;
    }
    
    // Engagement Points
    if (analysisData.implementation_blueprint.engagement_points) {
      markdown += `### Engagement Points\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.implementation_blueprint.engagement_points)) {
        analysisData.implementation_blueprint.engagement_points.forEach((point: any) => {
          if (point.point && point.implementation) {
            markdown += `- **${point.point}**: ${point.implementation}\n`;
          } else {
            markdown += `- ${JSON.stringify(point)}\n`;
          }
        });
      } else {
        markdown += `${analysisData.implementation_blueprint.engagement_points}\n`;
      }
      
      markdown += `\n`;
    }
    
    // Differentiation Opportunities
    if (analysisData.implementation_blueprint.differentiation_opportunities) {
      markdown += `### Differentiation Opportunities\n\n`;
      
      // Handle both array and string formats
      if (Array.isArray(analysisData.implementation_blueprint.differentiation_opportunities)) {
        analysisData.implementation_blueprint.differentiation_opportunities.forEach((opportunity: any) => {
          if (opportunity.opportunity && opportunity.implementation) {
            markdown += `- **${opportunity.opportunity}**: ${opportunity.implementation}\n`;
          } else {
            markdown += `- ${JSON.stringify(opportunity)}\n`;
          }
        });
      } else {
        markdown += `${analysisData.implementation_blueprint.differentiation_opportunities}\n`;
      }
      
      markdown += `\n`;
    }
    
    // CTA Strategy
    if (analysisData.implementation_blueprint.cta_strategy) {
      markdown += `### CTA Strategy\n\n`;
      markdown += `${analysisData.implementation_blueprint.cta_strategy}\n\n`;
    }
  }

  return markdown;
} 