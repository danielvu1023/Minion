import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Docker from 'dockerode';
import type { Container } from 'dockerode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Injectable()
export class DevboxService implements OnModuleDestroy {
  private readonly logger = new Logger(DevboxService.name);
  private docker: Docker;
  private container: Container | null = null;

  constructor(private configService: ConfigService) {
    this.docker = new Docker();
  }

  async start(): Promise<void> {
    if (this.container) {
      this.logger.warn('Container already running');
      return;
    }

    const targetRepoPath = this.configService.get<string>('TARGET_REPO_PATH', '');
    const bindPath = targetRepoPath.replace(/\\/g, '/');
    this.logger.log(`Target repo: ${targetRepoPath}`);
    this.logger.log(`Docker bind path: ${bindPath}:/workspace`);

    const githubToken = this.configService.get<string>('GITHUB_TOKEN', '');
    const gitUserName = this.configService.get<string>('GIT_USER_NAME', '');
    const gitUserEmail = this.configService.get<string>('GIT_USER_EMAIL', '');

    this.logger.log('Pulling node:20 image...');
    await new Promise<void>((resolve, reject) => {
      this.docker.pull('node:20', {}, (err: Error | null, stream: NodeJS.ReadableStream) => {
        if (err) return reject(err);
        this.docker.modem.followProgress(stream, (err2: Error | null) => {
          if (err2) return reject(err2);
          resolve();
        });
      });
    });

    this.logger.log('Creating container...');
    this.container = await this.docker.createContainer({
      Image: 'node:20',
      Tty: true,
      WorkingDir: '/workspace',
      Env: [
        `GITHUB_TOKEN=${githubToken}`,
        `GIT_AUTHOR_NAME=${gitUserName}`,
        `GIT_AUTHOR_EMAIL=${gitUserEmail}`,
        `GIT_COMMITTER_NAME=${gitUserName}`,
        `GIT_COMMITTER_EMAIL=${gitUserEmail}`,
      ],
      HostConfig: {
        Binds: [`${bindPath}:/workspace`],
        AutoRemove: false,
      },
    });

    await this.container.start();
    const containerInfo = await this.container.inspect();
    this.logger.log(`Container started: id=${containerInfo.Id.substring(0, 12)} name=${containerInfo.Name}`);

    // Configure git credentials
    await this.exec(`git config --global user.name "${gitUserName}"`);
    await this.exec(`git config --global user.email "${gitUserEmail}"`);
    await this.exec('git config --global credential.helper store');
    await this.exec(`echo "https://${gitUserName}:${githubToken}@github.com" > ~/.git-credentials`);

    // Install gh CLI
    this.logger.log('Installing gh CLI...');
    await this.exec(
      'curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg 2>/dev/null ' +
      '&& echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null ' +
      '&& apt update -qq && apt install gh -y -qq',
    );

    // Authenticate gh CLI
    await this.exec(`echo "${githubToken}" | gh auth login --with-token`);
    this.logger.log('Container fully configured');
  }

  async exec(command: string): Promise<string> {
    if (!this.container) {
      throw new Error('Container not started');
    }

    const cmdPreview = command.length > 200 ? command.substring(0, 200) + '...' : command;
    this.logger.debug(`[exec] >>> ${cmdPreview}`);
    const startTime = Date.now();

    const exec = await this.container.exec({
      Cmd: ['/bin/sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ hijack: true, stdin: false });
    return new Promise((resolve) => {
      let output = '';
      stream.on('data', (chunk: Buffer) => (output += chunk.toString()));
      stream.on('end', () => {
        const elapsed = Date.now() - startTime;
        const trimmed = output.trim();
        const preview = trimmed.length > 300 ? trimmed.substring(0, 300) + '...' : trimmed;
        this.logger.debug(`[exec] <<< (${elapsed}ms) ${preview}`);
        resolve(trimmed);
      });
    });
  }

  async writeFile(filePath: string, content: string): Promise<string> {
    this.logger.debug(`[writeFile] path=${filePath} contentLength=${content.length}`);
    // Write content to a temp file on host, then copy into container
    const tmpFile = path.join(os.tmpdir(), `minion-${Date.now()}.tmp`);
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const tmpFilePath = tmpFile.replace(/\\/g, '/');

    // Use docker cp equivalent: read file and pipe via exec
    const escaped = content.replace(/'/g, "'\\''");
    await this.exec(`cat > ${filePath} << 'MINION_EOF'\n${content}\nMINION_EOF`);

    fs.unlinkSync(tmpFile);
    return `File written: ${filePath}`;
  }

  async stop(): Promise<void> {
    if (!this.container) return;
    try {
      await this.container.stop();
      await this.container.remove();
      this.logger.log('Container stopped and removed');
    } catch (err) {
      this.logger.warn('Error stopping container', err);
    }
    this.container = null;
  }

  async onModuleDestroy() {
    await this.stop();
  }
}
