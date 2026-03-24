import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class ContextService {
  private readonly logger = new Logger(ContextService.name);

  constructor(private configService: ConfigService) {}

  async loadRules(repoPath?: string): Promise<string> {
    const targetRepoPath = repoPath ?? this.configService.get<string>('TARGET_REPO_PATH', '');

    // Try AGENT_RULES.md first, then fall back to CLAUDE.md
    for (const filename of ['AGENT_RULES.md', 'CLAUDE.md']) {
      const rulesPath = path.join(targetRepoPath, filename);
      this.logger.log(`[context] Trying rules from: ${rulesPath}`);
      try {
        const content = fs.readFileSync(rulesPath, 'utf-8');
        this.logger.log(`[context] Loaded ${content.length} chars from ${filename}`);
        return content;
      } catch {
        // Continue to next fallback
      }
    }

    this.logger.warn('No AGENT_RULES.md or CLAUDE.md found, proceeding without rules');
    return '';
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
