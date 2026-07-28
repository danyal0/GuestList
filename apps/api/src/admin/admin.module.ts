import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminAlertService } from './admin-alert.service';
import { AnalyticsModule } from '../analytics/analytics.module';

@Module({
  imports: [AnalyticsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminAlertService],
  exports: [AdminAlertService],
})
export class AdminModule {}
