import { Module } from '@nestjs/common';
import { BlueprintModule } from '../blueprint/blueprint.module.js';
import { SlackService } from './slack.service.js';

@Module({
  imports: [BlueprintModule],
  providers: [SlackService],
})
export class SlackModule {}
