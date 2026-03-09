import { Injectable, Logger } from '@nestjs/common';
import { DevboxService } from '../devbox/devbox.service.js';
import { ShellTool } from './implementations/shell.tool.js';
import { FileTool } from './implementations/file.tool.js';
import { SearchTool } from './implementations/search.tool.js';
import { TestRunnerTool } from './implementations/test-runner.tool.js';
import { PrTool } from './implementations/pr.tool.js';

export const TOOL_DEFINITIONS = [
  {
    name: 'read_file',
    description: 'Read the contents of a file at the given path',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file inside /workspace' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Write or overwrite content to a file at the given path',
    input_schema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path to the file inside /workspace' },
        content: { type: 'string', description: 'Full file content to write' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'run_shell_command',
    description: 'Execute a shell command inside the workspace and return stdout and stderr combined',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: 'Shell command to run' },
      },
      required: ['command'],
    },
  },
  {
    name: 'search_codebase',
    description: 'Search for a text pattern across all files in the workspace using grep',
    input_schema: {
      type: 'object' as const,
      properties: {
        pattern: { type: 'string', description: 'Text or regex pattern to search for' },
        directory: { type: 'string', description: 'Optional subdirectory to scope the search' },
      },
      required: ['pattern'],
    },
  },
  {
    name: 'run_tests',
    description: 'Run the test suite and return full output including failures',
    input_schema: {
      type: 'object' as const,
      properties: {
        testPattern: {
          type: 'string',
          description: 'Optional jest pattern to run a subset of tests',
        },
      },
    },
  },
];

@Injectable()
export class ToolsService {
  private readonly logger = new Logger(ToolsService.name);
  private shellTool: ShellTool;
  private fileTool: FileTool;
  private searchTool: SearchTool;
  private testRunnerTool: TestRunnerTool;
  private prTool: PrTool;

  constructor(private devboxService: DevboxService) {
    this.shellTool = new ShellTool(devboxService);
    this.fileTool = new FileTool(devboxService);
    this.searchTool = new SearchTool(devboxService);
    this.testRunnerTool = new TestRunnerTool(devboxService);
    this.prTool = new PrTool(devboxService);
  }

  getDefinitions(toolNames?: string[]) {
    if (!toolNames) return TOOL_DEFINITIONS;
    return TOOL_DEFINITIONS.filter((t) => toolNames.includes(t.name));
  }

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    const inputPreview = this.previewInput(toolName, toolInput);
    this.logger.log(`[tool:call] ${toolName}(${inputPreview})`);
    const startTime = Date.now();

    let result: string;
    switch (toolName) {
      case 'read_file':
        result = await this.fileTool.readFile(toolInput.path as string);
        break;
      case 'write_file':
        result = await this.fileTool.writeFile(toolInput.path as string, toolInput.content as string);
        break;
      case 'run_shell_command':
        result = await this.shellTool.runShellCommand(toolInput.command as string);
        break;
      case 'search_codebase':
        result = await this.searchTool.searchCodebase(
          toolInput.pattern as string,
          toolInput.directory as string | undefined,
        );
        break;
      case 'run_tests':
        result = await this.testRunnerTool.runTests(toolInput.testPattern as string | undefined);
        break;
      default:
        result = `Unknown tool: ${toolName}`;
    }

    const elapsed = Date.now() - startTime;
    const resultPreview = result.length > 300 ? result.substring(0, 300) + `... (${result.length} chars total)` : result;
    this.logger.log(`[tool:result] ${toolName} (${elapsed}ms) → ${resultPreview}`);
    return result;
  }

  private previewInput(toolName: string, input: Record<string, unknown>): string {
    switch (toolName) {
      case 'read_file':
        return `path="${input.path}"`;
      case 'write_file':
        return `path="${input.path}", content=${(input.content as string)?.length ?? 0} chars`;
      case 'run_shell_command':
        return `"${input.command}"`;
      case 'search_codebase':
        return `pattern="${input.pattern}"${input.directory ? `, dir="${input.directory}"` : ''}`;
      case 'run_tests':
        return input.testPattern ? `pattern="${input.testPattern}"` : 'all';
      default:
        return JSON.stringify(input).substring(0, 100);
    }
  }
}
