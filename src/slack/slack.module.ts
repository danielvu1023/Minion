import { Module } from '@nestjs/common';
import { BlueprintModule } from '../blueprint/blueprint.module.js';
import { ShotsModule } from '../shots/shots.module.js';
import { SlackService } from './slack.service.js';

@Module({
  imports: [BlueprintModule, ShotsModule],
  providers: [SlackService],
})
export class SlackModule {}
