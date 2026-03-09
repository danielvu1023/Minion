import { Step } from '../blueprint.types.js';

const SONNET = 'claude-sonnet-4-20250514';
const HAIKU = 'claude-haiku-4-5-20251001';

export const codingTaskBlueprint: Step[] = [
  {
    type: 'agent',
    name: 'Implementing task',
    prompt: 'Run the failing tests first to see exactly what is broken. Then read only the files you need. Implement the fix as quickly as possible — do not explore the codebase extensively before writing code.',
    tools: ['read_file', 'write_file', 'search_codebase', 'run_shell_command'],
    maxRetries: 0,
    model: SONNET,
  },
  {
    type: 'deterministic',
    name: 'Formatting code',
    command: 'cd /workspace && npx prettier --write . 2>&1 || true',
  },
  {
    type: 'deterministic',
    name: 'Auto-fixing lint',
    command: 'cd /workspace && npx eslint --fix . 2>&1 || true',
  },
  {
    type: 'agent',
    name: 'Fixing lint errors',
    prompt: 'Run `npx eslint . 2>&1` to check for remaining lint errors. If there are no errors, say "No lint errors" and stop immediately. Otherwise fix only the errors shown — do not re-run eslint in a loop.',
    tools: ['run_shell_command', 'read_file', 'write_file'],
    feedPreviousOutput: false,
    maxRetries: 0,
    model: HAIKU,
  },
  {
    type: 'deterministic',
    name: 'Type checking',
    command: 'cd /workspace && npx tsc --noEmit 2>&1',
  },
  {
    type: 'agent',
    name: 'Fixing type errors',
    prompt: 'Fix any TypeScript type errors shown above.',
    tools: ['read_file', 'write_file', 'run_shell_command'],
    feedPreviousOutput: true,
    maxRetries: 0,
    model: HAIKU,
  },
  {
    type: 'deterministic',
    name: 'Running tests',
    command: 'cd /workspace && npm test -- --passWithNoTests 2>&1',
  },
  {
    type: 'agent',
    name: 'Fixing test failures',
    prompt: 'Fix any failing tests shown above. Do not modify existing tests.',
    tools: ['read_file', 'write_file', 'run_shell_command'],
    feedPreviousOutput: true,
    maxRetries: 0,
    model: HAIKU,
  },
  {
    type: 'deterministic',
    name: 'Committing changes',
    command: 'cd /workspace && git checkout -b minion/run-$(date +%s) && git add . && git commit -m "feat: minion run" && git push --set-upstream origin HEAD 2>&1',
  },
  {
    type: 'deterministic',
    name: 'Opening PR',
    command: 'cd /workspace && gh pr create --fill',
  },
];
