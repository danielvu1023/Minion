import { DevboxService } from '../../devbox/devbox.service.js';

export class TestRunnerTool {
  constructor(private devboxService: DevboxService) {}

  async runTests(testPattern?: string): Promise<string> {
    const cmd = testPattern
      ? `cd /workspace && npm test -- --testPathPattern="${testPattern}" 2>&1`
      : 'cd /workspace && npm test 2>&1';
    return await this.devboxService.exec(cmd);
  }
}
