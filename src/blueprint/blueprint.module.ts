import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { DevboxModule } from '../devbox/devbox.module.js';
import { ContextModule } from '../context/context.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { BlueprintService } from './blueprint.service.js';

@Module({
  imports: [AgentModule, DevboxModule, ContextModule, ToolsModule],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}
