import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IDevboxProvider } from './devbox.interface.js';
import { DockerProvider } from './providers/docker.provider.js';
import { ShellProvider } from './providers/shell.provider.js';

@Injectable()
export class DevboxService implements OnModuleDestroy {
  private readonly logger = new Logger(DevboxService.name);
  private provider: IDevboxProvider;

  constructor(private configService: ConfigService) {
    const mode = configService.get<string>('EXECUTION_MODE', 'docker');
    this.logger.log(`Execution mode: ${mode}`);

    if (mode === 'shell') {
      this.provider = new ShellProvider(configService);
    } else {
      this.provider = new DockerProvider(configService);
    }
  }

  async start(repoPath?: string): Promise<void> {
    return this.provider.start(repoPath);
  }

  async exec(command: string): Promise<string> {
    return this.provider.exec(command);
  }

  async writeFile(filePath: string, content: string): Promise<string> {
    return this.provider.writeFile(filePath, content);
  }

  getWorkDir(): string {
    return this.provider.getWorkDir();
  }

  async stop(): Promise<void> {
    return this.provider.stop();
  }

  async onModuleDestroy() {
    await this.stop();
  }
}
