import { Module } from '@nestjs/common';
import { DevboxService } from './devbox.service.js';

@Module({
  providers: [DevboxService],
  exports: [DevboxService],
})
export class DevboxModule {}
