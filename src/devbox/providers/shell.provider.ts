import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { IDevboxProvider } from '../devbox.interface.js';

export class ShellProvider implements IDevboxProvider {
  private readonly logger = new Logger(ShellProvider.name);
  private workDir = '';
  private isUrl = false;

  constructor(private configService: ConfigService) {}

  async start(repoPath?: string): Promise<void> {
    const targetPath = repoPath ?? this.configService.get<string>('TARGET_REPO_PATH', '');
    this.isUrl = targetPath.startsWith('https://') || targetPath.startsWith('git@');

    if (this.isUrl) {
      // Clone from remote
      this.workDir = `/tmp/workspace-${Date.now()}`;
      this.logger.log(`Cloning ${targetPath} to ${this.workDir}`);

      const githubToken = this.configService.get<string>('GITHUB_TOKEN', '');
      const gitUserName = this.configService.get<string>('GIT_USER_NAME', '');

      // Inject token into clone URL for auth
      const authedUrl = targetPath.replace(
        'https://github.com/',
        `https://${gitUserName}:${githubToken}@github.com/`,
      );

      execSync(`git clone --depth 1 ${authedUrl} ${this.workDir}`, {
        stdio: 'pipe',
        timeout: 120000,
      });
      this.logger.log('Clone complete');
    } else {
      // Local path — use directly
      this.workDir = targetPath.replace(/\\/g, '/');
      this.logger.log(`Using local repo: ${this.workDir}`);
    }

    // Create /workspace symlink so blueprint commands work unchanged
    try {
      if (fs.existsSync('/workspace')) {
        fs.unlinkSync('/workspace');
      }
      fs.symlinkSync(this.workDir, '/workspace');
      this.logger.log(`Symlinked /workspace -> ${this.workDir}`);
    } catch {
      // On Windows or if /workspace can't be created, commands will use cwd instead
      this.logger.warn('Could not create /workspace symlink (expected on Windows)');
    }

    // Configure git credentials
    const githubToken = this.configService.get<string>('GITHUB_TOKEN', '');
    const gitUserName = this.configService.get<string>('GIT_USER_NAME', '');
    const gitUserEmail = this.configService.get<string>('GIT_USER_EMAIL', '');

    this.execSync(`git config --global user.name "${gitUserName}"`);
    this.execSync(`git config --global user.email "${gitUserEmail}"`);
    this.execSync('git config --global credential.helper store');

    // Write credentials via fs instead of shell echo to avoid tokens in command strings
    const homedir = process.env.HOME || process.env.USERPROFILE || '/root';
    fs.writeFileSync(
      path.join(homedir, '.git-credentials'),
      `https://${gitUserName}:${githubToken}@github.com\n`,
      { mode: 0o600 },
    );

    // gh CLI automatically uses GITHUB_TOKEN env var — no login needed
    this.logger.log('Shell provider configured');
  }

  async exec(command: string): Promise<string> {
    const cmdPreview = command.length > 200 ? command.substring(0, 200) + '...' : command;
    this.logger.debug(`[exec] >>> ${cmdPreview}`);
    const startTime = Date.now();

    try {
      const output = execSync(command, {
        cwd: this.workDir,
        shell: '/bin/sh',
        encoding: 'utf-8',
        timeout: 120000,
        stdio: 'pipe',
        env: {
          ...process.env,
          GITHUB_TOKEN: this.configService.get<string>('GITHUB_TOKEN', ''),
          GIT_AUTHOR_NAME: this.configService.get<string>('GIT_USER_NAME', ''),
          GIT_AUTHOR_EMAIL: this.configService.get<string>('GIT_USER_EMAIL', ''),
          GIT_COMMITTER_NAME: this.configService.get<string>('GIT_USER_NAME', ''),
          GIT_COMMITTER_EMAIL: this.configService.get<string>('GIT_USER_EMAIL', ''),
        },
      });

      const trimmed = (output || '').trim();
      const elapsed = Date.now() - startTime;
      const preview = trimmed.length > 300 ? trimmed.substring(0, 300) + '...' : trimmed;
      this.logger.debug(`[exec] <<< (${elapsed}ms) ${preview}`);
      return trimmed;
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime;
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output = [execErr.stdout, execErr.stderr].filter(Boolean).join('\n').trim();
      this.logger.debug(`[exec] <<< ERROR (${elapsed}ms) ${output || execErr.message}`);
      return output || execErr.message || 'Command failed';
    }
  }

  async writeFile(filePath: string, content: string): Promise<string> {
    if (!content && content !== '') {
      return 'Error: no content provided to write_file';
    }
    const fullPath = filePath.startsWith('/')
      ? filePath
      : path.join(this.workDir, filePath);
    this.logger.debug(`[writeFile] path=${fullPath} contentLength=${content.length}`);
    fs.writeFileSync(fullPath, content, 'utf-8');
    return `File written: ${fullPath}`;
  }

  getWorkDir(): string {
    return this.workDir;
  }

  async stop(): Promise<void> {
    // Only clean up cloned repos, not local paths
    if (this.isUrl && this.workDir) {
      try {
        fs.rmSync(this.workDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up ${this.workDir}`);
      } catch (err) {
        this.logger.warn('Error cleaning up workspace', err);
      }
    }

    // Remove /workspace symlink
    try {
      if (fs.lstatSync('/workspace').isSymbolicLink()) {
        fs.unlinkSync('/workspace');
      }
    } catch {
      // Ignore — may not exist
    }

    this.workDir = '';
  }

  private execSync(command: string): void {
    try {
      execSync(command, { stdio: 'pipe', timeout: 30000 });
    } catch {
      // Redact command to avoid leaking tokens in logs
      const safe = command.replace(/ghp_\w+|github_pat_\w+|xoxb-\S+|sk-ant-\S+/g, '***');
      this.logger.warn(`Setup command failed: ${safe}`);
    }
  }
}
