import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAlertService } from './admin-alert.service';
import { EventImportService } from './event-import.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAlertService, EventImportService],
  exports: [AdminAlertService],
})
export class AdminModule {}
