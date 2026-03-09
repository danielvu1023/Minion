import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(private configService: ConfigService) {}

  async loadRules(): Promise<string> {
    const targetRepoPath = this.configService.get<string>('TARGET_REPO_PATH', '');
    const rulesPath = path.join(targetRepoPath, 'AGENT_RULES.md');
    this.logger.log(`[context] Loading rules from: ${rulesPath}`);
    try {
      const content = fs.readFileSync(rulesPath, 'utf-8');
      this.logger.log(`[context] Loaded ${content.length} chars from AGENT_RULES.md`);
      return content;
    } catch {
      this.logger.warn('No AGENT_RULES.md found, proceeding without rules');
      return '';
    }
  }

  buildSystemPrompt(rules: string, stepPrompt: string): string {
    return `${rules}

You are a coding agent working on a real codebase. You have access to tools
to read files, write files, run shell commands, and search the codebase.
All file paths should be relative to /workspace inside the container.
Complete the task thoroughly and carefully. When you are done, return a
summary of what you changed and why.

Current task: ${stepPrompt}`;
  }
}
