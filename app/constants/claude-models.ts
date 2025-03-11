// Claude model definitions
export const CLAUDE_MODELS = [
  {
    id: "claude-3-7-sonnet-20250219",
    name: "Claude 3.7 Sonnet",
    inputCostPer1kTokens: 0.015,
    outputCostPer1kTokens: 0.075,
    maxTokens: 200000
  },
  {
    id: "claude-3-5-sonnet-20240620",
    name: "Claude 3.5 Sonnet",
    inputCostPer1kTokens: 0.008,
    outputCostPer1kTokens: 0.024,
    maxTokens: 200000
  },
  {
    id: "claude-3-haiku-20240307",
    name: "Claude 3 Haiku",
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    maxTokens: 180000
  },
]; 