import { Module } from '@nestjs/common';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';
import { GroupPermissionsService } from './group-permissions.service';

@Module({
  controllers: [GroupsController],
  providers: [GroupsService, GroupPermissionsService],
  exports: [GroupsService, GroupPermissionsService],
})
export class GroupsModule {}
