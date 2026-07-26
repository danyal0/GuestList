import { Module } from '@nestjs/common';
import { RsvpController } from './rsvp.controller';
import { RsvpService } from './rsvp.service';
import { GroupsModule } from '../groups/groups.module';

@Module({
  imports: [GroupsModule],
  controllers: [RsvpController],
  providers: [RsvpService],
  exports: [RsvpService],
})
export class RsvpModule {}
