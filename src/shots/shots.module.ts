import { Module } from '@nestjs/common';
import { EnrichmentModule } from '../enrichment/enrichment.module.js';
import { BlueprintModule } from '../blueprint/blueprint.module.js';
import { ShotsPipelineService } from './shots-pipeline.service.js';

@Module({
  imports: [EnrichmentModule, BlueprintModule],
  providers: [ShotsPipelineService],
  exports: [ShotsPipelineService],
})
export class ShotsModule {}
