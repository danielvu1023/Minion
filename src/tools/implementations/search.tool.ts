import { DevboxService } from '../../devbox/devbox.service.js';

export class SearchTool {
  constructor(private devboxService: DevboxService) {}

  async searchCodebase(pattern: string, directory?: string): Promise<string> {
    const dir = directory || '/workspace';
    return await this.devboxService.exec(
      `grep -r "${pattern}" ${dir} --include="*.ts" -l 2>/dev/null || echo "No matches found"`,
    );
  }
}
