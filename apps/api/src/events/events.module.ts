import { Module } from '@nestjs/common';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';
import { EventsSchedulerService } from './events-scheduler.service';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [GroupsModule],
  controllers: [EventsController],
  providers: [EventsService, EventsSchedulerService],
  exports: [EventsService],
})
export class EventsModule {}
