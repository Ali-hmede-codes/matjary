import { Module } from '@nestjs/common';
import { ConfigurationModule } from '@app/config';
import { QueueService } from './queue.service';

@Module({
  imports: [ConfigurationModule],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
