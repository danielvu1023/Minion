# Minion - Personal Agentic Coding Assistant

## Project Overview
A personal coding agent inspired by Stripe's Minions system. Triggered via a
Slack slash command, runs fully autonomously inside a Docker container, and
opens a GitHub PR when done. No human interaction during the run.

The system is intentionally architected to mirror Stripe's design at an
appropriate startup scale -- real architectural rigor without over-engineering.

---

## IMPORTANT -- Read Before Touching Anything

### Do NOT create or modify .env
A `.env` file already exists at the project root with real API keys and tokens.
Do not create it, overwrite it, or modify it under any circumstances. If you
need to reference environment variable names, refer to the list below. Assume
all values are already populated.

### Do NOT commit secrets
Never log, print, or expose the values of any environment variables in code.
Always use ConfigService to access them, never process.env directly.

---

## Environment Variables
These already exist in the .env file. Reference only -- do not recreate:

```
SLACK_BOT_TOKEN=xoxb-...        # Slack bot token for posting messages
SLACK_APP_TOKEN=xapp-...        # Slack app-level token for Socket Mode
ANTHROPIC_API_KEY=sk-ant-...    # Anthropic API key for Claude
GITHUB_TOKEN=github_pat_...     # GitHub personal access token for git auth
TARGET_REPO_PATH=C:\...         # Absolute path to the repo the agent works on
GIT_USER_NAME=...               # GitHub username for git commits in container
GIT_USER_EMAIL=...              # GitHub email for git commits in container
```

---

## .gitignore
Create this file at the project root immediately as the very first step:

```gitignore
# Environment variables -- never commit
.env
.env.local
.env.production
.env.*

# Node modules
node_modules/

# NestJS build output
dist/

# Logs
*.log
npm-debug.log*
yarn-debug.log*

# OS files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Test coverage
coverage/

# Temporary files
tmp/
temp/
```

---

## Tech Stack
- **Runtime:** Node.js 20+
- **Framework:** NestJS 10 with TypeScript
- **Slack:** @slack/bolt 3.x (Socket Mode -- no public URL required)
- **LLM:** @anthropic-ai/sdk 0.24.x (claude-sonnet-4-20250514)
- **Container:** dockerode 4.x (Docker SDK for Node)
- **Config:** @nestjs/config with dotenv
- **GitHub:** gh CLI inside Docker container authenticated via GITHUB_TOKEN

---

## Project Structure
```
src/
  slack/
    slack.module.ts
    slack.service.ts        -- Bolt app init, slash command handler
  agent/
    agent.module.ts
    agent.service.ts        -- Core agent harness loop
    agent.types.ts          -- AgentRequest, AgentResult, Tool interfaces
  blueprint/
    blueprint.module.ts
    blueprint.service.ts    -- Step orchestration engine
    blueprint.types.ts      -- Blueprint, Step, StepType interfaces
    blueprints/
      coding-task.ts        -- Default blueprint for coding tasks
  tools/
    tools.module.ts
    tools.service.ts        -- Tool registry and executor
    implementations/
      shell.tool.ts         -- run_shell_command implementation
      file.tool.ts          -- read_file and write_file implementations
      search.tool.ts        -- search_codebase implementation
      test-runner.tool.ts   -- run_tests implementation
      pr.tool.ts            -- create_pr implementation
  devbox/
    devbox.module.ts
    devbox.service.ts       -- Docker container lifecycle management
  context/
    context.module.ts
    context.service.ts      -- Rules file loading and context injection
  app.module.ts
  main.ts
.gitignore                  -- must be created first
```

---

## Architecture and Key Design Decisions

### How the system flows end to end
```
Slack /minion <prompt>
  → SlackService acknowledges within 3 seconds, posts "Starting minion run..."
  → BlueprintService.run(prompt) kicks off async (fire and forget)
  → Blueprint iterates through steps:
      deterministic step → shell command executes directly in devbox
      agent step → AgentService.run(prompt, tools, context)
        → while loop: call Claude → execute tool calls → feed results back
        → until Claude returns final answer or max 20 steps
  → Each step result posted back to Slack thread
  → Final step: gh pr create opens PR using GITHUB_TOKEN
  → PR link posted to Slack thread
```

---

### Agent Harness (AgentService)
The harness is a stateless while loop. It receives a prompt, a list of tool
definitions, and context. It knows nothing about the blueprint. It just runs
Claude until done.

**Important distinction:**
- Tool DEFINITIONS are the schemas passed to Claude so it knows what tools exist
- Tool IMPLEMENTATIONS are the actual TypeScript functions that run when Claude
  calls a tool
- The harness maps tool names from Claude's response to their implementations
  via the ToolsService registry

Anthropic tool use pattern:
```typescript
// Request shape
{
  model: "claude-sonnet-4-20250514",
  max_tokens: 8096,
  system: systemPrompt,
  tools: toolDefinitions,  // array of tool schemas (the contract)
  messages: conversationHistory
}

// Response -- check content blocks for type
response.content.forEach(block => {
  if (block.type === "text") {
    // final answer or reasoning text from Claude
  }
  if (block.type === "tool_use") {
    // block.name = tool name (e.g. "read_file")
    // block.input = tool arguments (e.g. { path: "/workspace/src/user.service.ts" })
    // block.id = tool use id -- CRITICAL, needed for tool_result
  }
})

// After executing a tool, append TWO messages to history:
// 1. The assistant message containing the tool_use block
// 2. A user message containing the tool_result
messages.push({
  role: "assistant",
  content: response.content  // full content array including tool_use blocks
})
messages.push({
  role: "user",
  content: [{
    type: "tool_result",
    tool_use_id: block.id,  // must match the tool_use block id exactly
    content: toolOutput     // string result of tool execution
  }]
})

// Stop conditions:
// 1. response.stop_reason === "end_turn" with no tool_use blocks
// 2. step count exceeds MAX_STEPS (set to 20)
```

---

### Tool Definitions vs Tool Implementations

#### Tool Definitions (passed to Claude API)
These are the schemas Claude uses to know what tools are available. They live
in `src/tools/tools.service.ts` as a static array:

```typescript
export const TOOL_DEFINITIONS = [
  {
    name: "read_file",
    description: "Read the contents of a file at the given path",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file inside /workspace" }
      },
      required: ["path"]
    }
  },
  {
    name: "write_file",
    description: "Write or overwrite content to a file at the given path",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file inside /workspace" },
        content: { type: "string", description: "Full file content to write" }
      },
      required: ["path", "content"]
    }
  },
  {
    name: "run_shell_command",
    description: "Execute a shell command inside the workspace and return stdout and stderr combined",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to run" }
      },
      required: ["command"]
    }
  },
  {
    name: "search_codebase",
    description: "Search for a text pattern across all files in the workspace using grep",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for" },
        directory: { type: "string", description: "Optional subdirectory to scope the search" }
      },
      required: ["pattern"]
    }
  },
  {
    name: "run_tests",
    description: "Run the test suite and return full output including failures",
    input_schema: {
      type: "object",
      properties: {
        testPattern: {
          type: "string",
          description: "Optional jest pattern to run a subset of tests"
        }
      }
    }
  }
]
```

#### Tool Implementations (actual execution logic)
Each tool implementation runs the real operation inside the Docker container
via DevboxService. Implement each in `src/tools/implementations/`:

**shell.tool.ts** -- runs any shell command via dockerode exec:
```typescript
async runShellCommand(command: string): Promise<string> {
  return await this.devboxService.exec(command)
}
```

**file.tool.ts** -- reads and writes files via shell commands:
```typescript
async readFile(path: string): Promise<string> {
  return await this.devboxService.exec(`cat ${path}`)
}

async writeFile(path: string, content: string): Promise<string> {
  // write content to a temp file on host, then copy into container
  // or use echo with heredoc -- handle newlines carefully
  return await this.devboxService.writeFile(path, content)
}
```

**search.tool.ts** -- grep across the workspace:
```typescript
async searchCodebase(pattern: string, directory?: string): Promise<string> {
  const dir = directory || '/workspace'
  return await this.devboxService.exec(
    `grep -r "${pattern}" ${dir} --include="*.ts" -l 2>/dev/null || echo "No matches found"`
  )
}
```

**test-runner.tool.ts** -- runs npm test and returns output:
```typescript
async runTests(testPattern?: string): Promise<string> {
  const cmd = testPattern
    ? `cd /workspace && npm test -- --testPathPattern="${testPattern}" 2>&1`
    : `cd /workspace && npm test 2>&1`
  return await this.devboxService.exec(cmd)
}
```

**pr.tool.ts** -- creates PR using gh CLI inside container:
```typescript
async createPR(title: string, body: string): Promise<string> {
  return await this.devboxService.exec(
    `cd /workspace && gh pr create --title "${title}" --body "${body}"`
  )
}
```

#### ToolsService Registry
`tools.service.ts` maps tool names to their implementations so the agent
harness can look up and execute any tool by name:

```typescript
@Injectable()
export class ToolsService {
  constructor(private devboxService: DevboxService) {}

  async execute(toolName: string, toolInput: Record<string, any>): Promise<string> {
    switch (toolName) {
      case 'read_file':
        return this.readFile(toolInput.path)
      case 'write_file':
        return this.writeFile(toolInput.path, toolInput.content)
      case 'run_shell_command':
        return this.runShellCommand(toolInput.command)
      case 'search_codebase':
        return this.searchCodebase(toolInput.pattern, toolInput.directory)
      case 'run_tests':
        return this.runTests(toolInput.testPattern)
      default:
        return `Unknown tool: ${toolName}`
    }
  }
}
```

---

### Blueprint Engine (BlueprintService)
Orchestrates a sequence of steps. Each step is typed as deterministic or agent.
Deterministic steps run shell commands directly via DevboxService. Agent steps
call AgentService with a crafted prompt and the relevant tool subset.

Blueprint step interface:
```typescript
type StepType = 'agent' | 'deterministic'

interface Step {
  type: StepType
  name: string                  -- human readable name for Slack progress updates
  command?: string              -- for deterministic steps
  prompt?: string               -- for agent steps
  tools?: string[]              -- tool names available to agent for this step
  feedPreviousOutput?: boolean  -- inject previous step output as context
  maxRetries?: number           -- retry limit for agent steps
}
```

### Default Coding Task Blueprint
```typescript
const codingTaskBlueprint: Step[] = [
  {
    type: 'agent',
    name: 'Implementing task',
    prompt: 'Understand the codebase context and implement the requested task.',
    tools: ['read_file', 'write_file', 'search_codebase', 'run_shell_command'],
    maxRetries: 1
  },
  {
    type: 'deterministic',
    name: 'Formatting code',
    command: 'cd /workspace && npx prettier --write . 2>&1 || true'
  },
  {
    type: 'agent',
    name: 'Fixing lint errors',
    prompt: 'Run eslint and fix any errors found.',
    tools: ['run_shell_command', 'read_file', 'write_file'],
    feedPreviousOutput: true,
    maxRetries: 2
  },
  {
    type: 'deterministic',
    name: 'Type checking',
    command: 'cd /workspace && npx tsc --noEmit 2>&1'
  },
  {
    type: 'agent',
    name: 'Fixing type errors',
    prompt: 'Fix any TypeScript type errors shown above.',
    tools: ['read_file', 'write_file', 'run_shell_command'],
    feedPreviousOutput: true,
    maxRetries: 2
  },
  {
    type: 'deterministic',
    name: 'Running tests',
    command: 'cd /workspace && npm test -- --passWithNoTests 2>&1'
  },
  {
    type: 'agent',
    name: 'Fixing test failures',
    prompt: 'Fix any failing tests shown above. Do not modify existing tests.',
    tools: ['read_file', 'write_file', 'run_shell_command'],
    feedPreviousOutput: true,
    maxRetries: 3
  },
  {
    type: 'deterministic',
    name: 'Committing changes',
    command: 'cd /workspace && git add . && git commit -m "feat: minion run"'
  },
  {
    type: 'deterministic',
    name: 'Opening PR',
    command: 'cd /workspace && gh pr create --fill'
  }
]
```

---

### Devbox (DevboxService)
Manages a Docker container that runs the agent's shell commands. The container
mounts the target repo at `/workspace`. All tool executions happen inside this
container for isolation.

The container must be configured with GitHub credentials so git push and
gh pr create work correctly:

```typescript
// Container config
{
  Image: 'node:20',
  Tty: true,
  WorkingDir: '/workspace',
  Env: [
    `GITHUB_TOKEN=${configService.get('GITHUB_TOKEN')}`,
    `GIT_AUTHOR_NAME=${configService.get('GIT_USER_NAME')}`,
    `GIT_AUTHOR_EMAIL=${configService.get('GIT_USER_EMAIL')}`,
    `GIT_COMMITTER_NAME=${configService.get('GIT_USER_NAME')}`,
    `GIT_COMMITTER_EMAIL=${configService.get('GIT_USER_EMAIL')}`,
  ],
  HostConfig: {
    Binds: [`${targetRepoPath}:/workspace`],  // convert Windows backslashes to forward slashes
    AutoRemove: false  // keep container alive for multiple exec calls
  }
}
```

Container startup sequence:
1. Convert TARGET_REPO_PATH backslashes to forward slashes for Docker on Windows
2. Pull node:20 image if not present
3. Create and start the container
4. Configure git credentials inside container:
   ```
   git config --global user.name "${GIT_USER_NAME}"
   git config --global user.email "${GIT_USER_EMAIL}"
   git config --global credential.helper store
   echo "https://${GIT_USER_NAME}:${GITHUB_TOKEN}@github.com" > ~/.git-credentials
   ```
5. Install gh CLI inside container:
   ```
   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null
   apt update && apt install gh -y
   ```
6. Authenticate gh CLI: `echo "${GITHUB_TOKEN}" | gh auth login --with-token`
7. Container is now ready for tool executions
8. On blueprint completion, stop and remove the container

The exec method should capture both stdout and stderr:
```typescript
async exec(command: string): Promise<string> {
  const exec = await this.container.exec({
    Cmd: ['/bin/sh', '-c', command],
    AttachStdout: true,
    AttachStderr: true
  })
  const stream = await exec.start({ hijack: true, stdin: false })
  return new Promise((resolve) => {
    let output = ''
    stream.on('data', (chunk) => output += chunk.toString())
    stream.on('end', () => resolve(output.trim()))
  })
}
```

---

### Slack Integration (SlackService)
Uses Bolt for JavaScript in Socket Mode. Socket Mode requires SLACK_APP_TOKEN
(xapp- prefix). Bot token (xoxb- prefix) is used for posting messages.

Critical async pattern -- Slack requires acknowledgment within 3 seconds:
```typescript
app.command('/minion', async ({ command, ack, client }) => {
  await ack()  // must be called first, always under 3 seconds

  // post initial message to get thread_ts for threading
  const msg = await client.chat.postMessage({
    channel: command.channel_id,
    text: ':robot_face: Minion starting run...'
  })

  const threadTs = msg.ts  // all follow-up messages use this as thread_ts

  // fire and forget -- do NOT await
  this.blueprintService.run({
    prompt: command.text,
    channelId: command.channel_id,
    threadTs
  }).catch(err => {
    client.chat.postMessage({
      channel: command.channel_id,
      thread_ts: threadTs,
      text: `:x: Minion run failed: ${err.message}`
    })
  })
})
```

Posting progress updates to thread:
```typescript
await client.chat.postMessage({
  channel: channelId,
  thread_ts: threadTs,
  text: `:white_check_mark: ${stepName} complete`
})
```

---

### Context / Rules Loading (ContextService)
Before any agent step runs, load AGENT_RULES.md from the target repo root and
prepend it to the system prompt. This gives the agent codebase-specific context
without bloating the prompt with the entire codebase.

```typescript
async loadRules(): Promise<string> {
  const rulesPath = path.join(
    this.configService.get('TARGET_REPO_PATH'),
    'AGENT_RULES.md'
  )
  try {
    return fs.readFileSync(rulesPath, 'utf-8')
  } catch {
    return ''  // rules file is optional, fail silently
  }
}

// System prompt structure for all agent steps
const systemPrompt = `
${agentRulesContent}

You are a coding agent working on a real codebase. You have access to tools
to read files, write files, run shell commands, and search the codebase.
All file paths should be relative to /workspace inside the container.
Complete the task thoroughly and carefully. When you are done, return a
summary of what you changed and why.

Current task: ${stepPrompt}
`
```

---

## NestJS Module Registration Pattern
Every module follows this pattern. Do not use global modules except ConfigModule.
Wire everything explicitly in AppModule.

```typescript
// app.module.ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),  // only global module
    DevboxModule,
    ToolsModule,
    ContextModule,
    AgentModule,
    BlueprintModule,
    SlackModule,
  ]
})
export class AppModule {}
```

Each module exports its service so dependent modules can inject it:
```typescript
@Module({
  providers: [AgentService],
  exports: [AgentService]
})
export class AgentModule {}
```

Dependency order (each depends on the ones above it):
1. DevboxModule -- no dependencies
2. ToolsModule -- depends on DevboxModule
3. ContextModule -- no dependencies
4. AgentModule -- depends on ToolsModule
5. BlueprintModule -- depends on AgentModule, DevboxModule, ContextModule
6. SlackModule -- depends on BlueprintModule

---

## Dependencies to Install
```bash
nest new minion
cd minion
npm install @slack/bolt @anthropic-ai/sdk dockerode @nestjs/config dotenv
npm install -D @types/dockerode
```

---

## Key Constraints and Rules for Implementation
- NEVER create or overwrite .env -- it already exists with real secrets
- Create .gitignore as the very first file before anything else
- Never await the blueprint run inside the Slack command handler -- fire and forget
- All shell commands must execute inside the Docker container via dockerode
- Agent harness must append BOTH the assistant message and the tool_result user
  message to conversation history after each tool call or Claude will 400 error
- tool_use_id in tool_result must exactly match the id from the tool_use block
- Max steps for agent harness is 20 -- hard stop to prevent runaway loops
- threadTs must be passed through the entire call chain for correct Slack threading
- Use ConfigService for all env vars, never process.env directly
- Every service should be injectable and testable in isolation
- On Windows, TARGET_REPO_PATH uses backslashes -- convert to forward slashes
  when passing to dockerode Binds (replace all \\ with /)

---

## Build Order
Implement in this exact order. Verify each step works before moving on:

1. **Create .gitignore** -- first thing, no exceptions
2. **Project scaffold** -- nest new, install all dependencies
3. **Slack verification** -- SlackModule with Socket Mode, /minion command posts
   "Minion received your request" back to thread. Must work end to end.
4. **DevboxModule** -- spin up Docker container, exec a test echo command,
   confirm output returns correctly, tear down container
5. **ToolsModule** -- implement all 5 tool implementations executing inside
   the devbox. Test read_file and run_shell_command manually.
6. **ContextModule** -- load AGENT_RULES.md from TARGET_REPO_PATH
7. **AgentModule** -- full harness loop. Test with a simple prompt and one
   tool call to confirm the loop and tool_result pattern works correctly.
8. **BlueprintModule** -- step orchestration with the default coding blueprint
9. **Wire Slack to Blueprint** -- replace test message with real blueprint run,
   post step updates to thread, post final PR link

---

## Success Criteria for Full System
When `/minion Fix the failing tests in the user service` is sent in Slack:

1. Slack thread shows ":robot_face: Minion starting run..." within 3 seconds
2. Progress updates appear in thread as each blueprint step completes
3. Agent reads the codebase, finds the missing getUserById function,
   implements it correctly following existing patterns
4. All tests pass inside the container
5. A PR is opened on GitHub with the fix
6. PR link is posted to the Slack thread
7. No human interaction occurred between the slash command and the PR link