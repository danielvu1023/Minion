import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { ToolsService } from '../tools/tools.service.js';
import { AgentRequest, AgentResult } from './agent.types.js';

const MAX_STEPS = 15;
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const FAST_MODEL = 'claude-haiku-4-5-20251001';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  private client: Anthropic;

  constructor(
    private configService: ConfigService,
    private toolsService: ToolsService,
  ) {
    this.client = new Anthropic({
      apiKey: this.configService.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async run(request: AgentRequest): Promise<AgentResult> {
    const { prompt, systemPrompt, toolDefinitions, model } = request;

    this.logger.log('--- Agent harness starting ---');
    this.logger.log(`[agent:prompt] ${prompt.substring(0, 500)}${prompt.length > 500 ? '...' : ''}`);
    this.logger.log(`[agent:system] ${systemPrompt.substring(0, 300)}${systemPrompt.length > 300 ? '...' : ''}`);
    this.logger.log(`[agent:tools] ${toolDefinitions.map((t) => t.name).join(', ')}`);

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt },
    ];

    let stepCount = 0;
    let finalOutput = '';

    while (stepCount < MAX_STEPS) {
      stepCount++;
      this.logger.log(`Agent step ${stepCount}/${MAX_STEPS}`);

      this.logger.log(`[agent:request] Calling Claude (messages=${messages.length})...`);
      const apiStartTime = Date.now();

      const response = await this.client.messages.create({
        model: model ?? DEFAULT_MODEL,
        max_tokens: 4096,
        system: systemPrompt,
        tools: toolDefinitions as Anthropic.Tool[],
        messages,
      });

      const apiElapsed = Date.now() - apiStartTime;
      this.logger.log(
        `[agent:response] stop_reason=${response.stop_reason} ` +
        `blocks=${response.content.length} ` +
        `usage={in:${response.usage.input_tokens}, out:${response.usage.output_tokens}} ` +
        `(${apiElapsed}ms)`,
      );

      // Extract tool_use and text blocks
      const toolUseBlocks: Array<{ type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
      const textParts: string[] = [];

      for (const block of response.content) {
        if (block.type === 'tool_use') {
          toolUseBlocks.push(block as unknown as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> });
        } else if (block.type === 'text') {
          textParts.push((block as unknown as { text: string }).text);
        }
      }

      if (textParts.length > 0) {
        finalOutput = textParts.join('\n');
        const textPreview = finalOutput.length > 300 ? finalOutput.substring(0, 300) + '...' : finalOutput;
        this.logger.log(`[agent:text] ${textPreview}`);
      }

      if (toolUseBlocks.length > 0) {
        this.logger.log(`[agent:tool_calls] ${toolUseBlocks.map((t) => `${t.name}(id=${t.id.substring(0, 12)})`).join(', ')}`);
      }

      // If no tool calls and stop reason is end_turn, we're done
      if (toolUseBlocks.length === 0 && response.stop_reason === 'end_turn') {
        this.logger.log(`--- Agent harness complete: ${stepCount} steps, success ---`);
        return { success: true, output: finalOutput, steps: stepCount };
      }

      if (toolUseBlocks.length === 0) {
        this.logger.log(`--- Agent harness complete: ${stepCount} steps, no tool calls, stop_reason=${response.stop_reason} ---`);
        return { success: true, output: finalOutput, steps: stepCount };
      }

      // Append assistant message with full content
      messages.push({
        role: 'assistant',
        content: response.content as Anthropic.ContentBlockParam[],
      });

      // Execute each tool call and build tool_result messages
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const toolUse of toolUseBlocks) {
        this.logger.log(`[agent:exec] tool=${toolUse.name} id=${toolUse.id.substring(0, 12)} args=${JSON.stringify(toolUse.input).substring(0, 200)}`);
        let toolOutput: string;
        try {
          toolOutput = await this.toolsService.execute(
            toolUse.name,
            toolUse.input,
          );
        } catch (err) {
          toolOutput = `Tool execution error: ${(err as Error).message}`;
          this.logger.error(`[agent:exec] tool=${toolUse.name} THREW: ${(err as Error).message}`);
        }
        const resultPreview = toolOutput.length > 200 ? toolOutput.substring(0, 200) + `... (${toolOutput.length} chars)` : toolOutput;
        this.logger.log(`[agent:exec] tool=${toolUse.name} returned: ${resultPreview}`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: toolOutput,
        });
      }

      // Append user message with all tool results
      messages.push({
        role: 'user',
        content: toolResults,
      });
    }

    this.logger.warn(`--- Agent harness ABORTED: hit max ${MAX_STEPS} steps ---`);
    return { success: false, output: finalOutput || 'Max steps reached', steps: stepCount };
  }
}
