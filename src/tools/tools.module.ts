import { Module } from '@nestjs/common';
import { DevboxModule } from '../devbox/devbox.module.js';
import { ToolsService } from './tools.service.js';

@Module({
  imports: [DevboxModule],
  providers: [ToolsService],
  exports: [ToolsService],
})
export class ToolsModule {}
