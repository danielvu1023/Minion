import { DevboxService } from '../../devbox/devbox.service.js';

export class PrTool {
  constructor(private devboxService: DevboxService) {}

  async createPR(title: string, body: string): Promise<string> {
    return await this.devboxService.exec(
      `cd /workspace && gh pr create --title "${title}" --body "${body}"`,
    );
  }
}
