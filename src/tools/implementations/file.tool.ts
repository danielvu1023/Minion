import { DevboxService } from '../../devbox/devbox.service.js';

export class FileTool {
  constructor(private devboxService: DevboxService) {}

  async readFile(path: string): Promise<string> {
    return await this.devboxService.exec(`cat ${path}`);
  }

  async writeFile(path: string, content: string): Promise<string> {
    return await this.devboxService.writeFile(path, content);
  }
}
