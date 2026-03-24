import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnrichmentService } from '../enrichment/enrichment.service.js';
import { BlueprintService, StepUpdateCallback } from '../blueprint/blueprint.service.js';
import { createShotsBlueprint } from '../blueprint/blueprints/shots-task.js';

@Injectable()
export class ShotsPipelineService {
  private readonly logger = new Logger(ShotsPipelineService.name);

  constructor(
    private enrichmentService: EnrichmentService,
    private blueprintService: BlueprintService,
    private configService: ConfigService,
  ) {}

  async run(
    shotName: string,
    channelId: string,
    threadTs: string,
    onStepUpdate: StepUpdateCallback,
  ): Promise<string> {
    this.logger.log(`[shots-pipeline] Starting pipeline for "${shotName}"`);

    // 1. Search YouTube
    await onStepUpdate('Searching YouTube', 'running');
    const { videoId, title } = await this.enrichmentService.searchVideo(shotName);
    await onStepUpdate('Searching YouTube', 'success', `Found: ${title}`);

    // 2. Fetch transcript
    await onStepUpdate('Fetching transcript', 'running');
    const transcript = await this.enrichmentService.getTranscript(videoId);
    await onStepUpdate('Fetching transcript', 'success', `${transcript.length} chars`);

    // 3. Structure with Claude
    await onStepUpdate('Structuring shots with Claude', 'running');
    const shots = await this.enrichmentService.structureShots(transcript, shotName);
    await onStepUpdate('Structuring shots with Claude', 'success', `${shots.length} shots found`);

    // 4. Enrich shots with id and videoId
    for (const shot of shots) {
      shot.id = shot.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      shot.videoId = videoId;
    }

    // 5. Create blueprint
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const blueprint = createShotsBlueprint(shots, videoId, videoUrl);

    // 6. Run blueprint against NeedOne v2 repo
    const repoPath = this.configService.get<string>('NEEDONEV2_REPO_PATH');
    const prompt = `Adding ${shots.length} new shot(s) from "${title}": ${shots.map((s) => s.name).join(', ')}`;

    return this.blueprintService.run(
      {
        prompt,
        channelId,
        threadTs,
        blueprint,
        repoPath,
      },
      onStepUpdate,
    );
  }
}
