export interface AgentRequest {
  prompt: string;
  systemPrompt: string;
  toolDefinitions: ToolDefinition[];
  model?: string;
}

export interface AgentResult {
  success: boolean;
  output: string;
  steps: number;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}
