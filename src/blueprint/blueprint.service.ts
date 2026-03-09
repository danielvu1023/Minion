import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from '../agent/agent.service.js';
import { DevboxService } from '../devbox/devbox.service.js';
import { ContextService } from '../context/context.service.js';
import { ToolsService } from '../tools/tools.service.js';
import { BlueprintRunRequest, Step } from './blueprint.types.js';
import { codingTaskBlueprint } from './blueprints/coding-task.js';

export interface StepUpdateCallback {
  (stepName: string, status: 'running' | 'success' | 'failed', detail?: string): Promise<void>;
}

@Injectable()
export class BlueprintService {
  private readonly logger = new Logger(BlueprintService.name);

  constructor(
    private agentService: AgentService,
    private devboxService: DevboxService,
    private contextService: ContextService,
    private toolsService: ToolsService,
  ) {}

  async run(
    request: BlueprintRunRequest,
    onStepUpdate: StepUpdateCallback,
  ): Promise<string> {
    const steps = codingTaskBlueprint;
    const runStartTime = Date.now();

    this.logger.log('=== Blueprint run starting ===');
    this.logger.log(`[blueprint] prompt: "${request.prompt}"`);
    this.logger.log(`[blueprint] steps: ${steps.length} total (${steps.map((s) => s.name).join(' → ')})`);

    const rules = await this.contextService.loadRules();
    this.logger.log(`[blueprint] rules loaded: ${rules.length} chars`);

    // Start the devbox container
    await onStepUpdate('Setting up devbox', 'running');
    await this.devboxService.start();
    await onStepUpdate('Setting up devbox', 'success');

    // Install dependencies
    await onStepUpdate('Installing dependencies', 'running');
    await this.devboxService.exec('cd /workspace && npm install 2>&1');
    await onStepUpdate('Installing dependencies', 'success');

    let previousOutput = '';
    let finalOutput = '';

    try {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepStartTime = Date.now();
        this.logger.log(`\n[blueprint:step ${i + 1}/${steps.length}] "${step.name}" (type=${step.type})`);

        await onStepUpdate(step.name, 'running');

        try {
          if (step.type === 'deterministic') {
            this.logger.log(`[blueprint:deterministic] command: ${step.command}`);
            const output = await this.devboxService.exec(step.command!);
            previousOutput = output;
            finalOutput = output;
            const elapsed = Date.now() - stepStartTime;
            const preview = output.length > 300 ? output.substring(0, 300) + '...' : output;
            this.logger.log(`[blueprint:deterministic] completed (${elapsed}ms): ${preview}`);
            await onStepUpdate(step.name, 'success', output.substring(0, 500));
          } else if (step.type === 'agent') {
            let prompt = `${request.prompt}\n\n${step.prompt}`;
            if (step.feedPreviousOutput && previousOutput) {
              this.logger.log(`[blueprint:agent] injecting previous output (${previousOutput.length} chars)`);
              prompt += `\n\nOutput from previous step:\n${previousOutput}`;
            }

            const systemPrompt = this.contextService.buildSystemPrompt(rules, prompt);
            const toolDefs = this.toolsService.getDefinitions(step.tools);
            this.logger.log(`[blueprint:agent] tools: ${step.tools?.join(', ') || 'all'}, maxRetries=${step.maxRetries || 0}`);

            let result = await this.agentService.run({
              prompt,
              systemPrompt,
              toolDefinitions: toolDefs,
              model: step.model,
            });

            // Retry logic
            let retries = 0;
            while (!result.success && retries < (step.maxRetries || 0)) {
              retries++;
              this.logger.warn(`[blueprint:retry] "${step.name}" attempt ${retries}/${step.maxRetries}`);
              result = await this.agentService.run({
                prompt: `${prompt}\n\nPrevious attempt failed. Please try again.`,
                systemPrompt,
                toolDefinitions: toolDefs,
                model: step.model,
              });
            }

            const elapsed = Date.now() - stepStartTime;
            this.logger.log(
              `[blueprint:agent] "${step.name}" ${result.success ? 'succeeded' : 'FAILED'} ` +
              `(${elapsed}ms, ${result.steps} agent steps, ${retries} retries)`,
            );

            previousOutput = result.output;
            finalOutput = result.output;
            await onStepUpdate(step.name, result.success ? 'success' : 'failed', result.output.substring(0, 500));

            if (!result.success) {
              throw new Error(`Step "${step.name}" failed after ${result.steps} agent steps`);
            }
          }
        } catch (err) {
          const errMsg = (err as Error).message;
          const elapsed = Date.now() - stepStartTime;
          this.logger.error(`[blueprint:step] "${step.name}" THREW after ${elapsed}ms: ${errMsg}`);
          this.logger.error((err as Error).stack);
          await onStepUpdate(step.name, 'failed', errMsg);
          throw err;
        }
      }
    } finally {
      this.logger.log('[blueprint] Tearing down devbox...');
      await this.devboxService.stop();
    }

    const totalElapsed = Date.now() - runStartTime;
    this.logger.log(`=== Blueprint run complete (${totalElapsed}ms) ===`);

    return finalOutput;
  }
}
