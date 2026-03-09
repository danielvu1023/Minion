import { Module } from '@nestjs/common';
import { ToolsModule } from '../tools/tools.module.js';
import { AgentService } from './agent.service.js';

@Module({
  imports: [ToolsModule],
  providers: [AgentService],
  exports: [AgentService],
})
export class AgentModule {}
