import { DevboxService } from '../../devbox/devbox.service.js';

export class ShellTool {
  constructor(private devboxService: DevboxService) {}

  async runShellCommand(command: string): Promise<string> {
    return await this.devboxService.exec(command);
  }
}
