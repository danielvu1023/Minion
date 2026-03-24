import { Step } from '../blueprint.types.js';
import type { EnrichedShot } from '../../enrichment/enrichment.service.js';

const SONNET = 'claude-sonnet-4-20250514';
const HAIKU = 'claude-haiku-4-5-20251001';

export function createShotsBlueprint(
  shots: EnrichedShot[],
  videoId: string,
  videoUrl: string,
): Step[] {
  const shotNames = shots.map((s) => s.name).join(', ');
  const shotsJson = JSON.stringify(shots, null, 2);

  return [
    {
      type: 'agent',
      name: 'Adding shot data',
      prompt: `You are adding new pickleball shot data to the NeedOne v2 app.

Here are the EnrichedShot objects to add (already structured as valid TypeScript objects):

\`\`\`json
${shotsJson}
\`\`\`

Instructions:
1. Read \`components/Shots/shotData.ts\` to understand both schemas (ShotData and EnrichedShot)
2. Append the new EnrichedShot objects to the \`shots\` array at the end
3. Each shot needs an \`id\` field (kebab-case of the name) and \`videoId\` field ("${videoId}")
4. Make sure the objects match the EnrichedShot interface exactly
5. Do NOT modify any existing shots in the array
6. Do NOT modify the interfaces or type definitions

Format the new entries to match the style of the existing data (single quotes, trailing commas, etc).`,
      tools: ['read_file', 'write_file', 'search_codebase', 'run_shell_command'],
      maxRetries: 0,
      model: SONNET,
    },
    {
      type: 'deterministic',
      name: 'Type checking',
      command: 'cd /workspace && npx -p typescript tsc --noEmit 2>&1 && echo "TYPE_CHECK_PASSED"',
    },
    {
      type: 'deterministic',
      name: 'Committing changes',
      command: `cd /workspace && git checkout -b minion/shots-$(date +%s) && git add components/Shots/shotData.ts && git commit -m "feat(shots): add ${shotNames}" && git push --set-upstream origin HEAD 2>&1`,
    },
    {
      type: 'deterministic',
      name: 'Opening PR',
      command: `cd /workspace && gh pr create --head "$(git rev-parse --abbrev-ref HEAD)" --title "feat(shots): add ${shotNames}" --body "## New Shots\n\nAdded via Minion shots pipeline from YouTube video: ${videoUrl}\n\nShots added: ${shotNames}\n\n> Diagrams are placeholders — manual SVG refinement may be needed." 2>&1`,
    },
  ];
}
