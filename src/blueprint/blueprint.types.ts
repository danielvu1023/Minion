export type StepType = 'agent' | 'deterministic';

export interface Step {
  type: StepType;
  name: string;
  command?: string;
  prompt?: string;
  tools?: string[];
  feedPreviousOutput?: boolean;
  maxRetries?: number;
  model?: string;
}

export interface BlueprintRunRequest {
  prompt: string;
  channelId: string;
  threadTs: string;
}
