import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DevboxModule } from './devbox/devbox.module.js';
import { ToolsModule } from './tools/tools.module.js';
import { ContextModule } from './context/context.module.js';
import { AgentModule } from './agent/agent.module.js';
import { BlueprintModule } from './blueprint/blueprint.module.js';
import { SlackModule } from './slack/slack.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DevboxModule,
    ToolsModule,
    ContextModule,
    AgentModule,
    BlueprintModule,
    SlackModule,
  ],
})
export class AppModule {}
