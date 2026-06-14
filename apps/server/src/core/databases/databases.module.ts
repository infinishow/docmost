import { Module } from '@nestjs/common';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { DatabasesController } from './databases.controller';
import { DatabasePermissionService } from './services/database-permission.service';
import { DataSourceService } from './services/data-source.service';
import { PropertyValueService } from './services/property-value.service';
import { PropertyService } from './services/property.service';
import { RecordService } from './services/record.service';
import { ViewService } from './services/view.service';

@Module({
  imports: [PageAccessModule],
  controllers: [DatabasesController],
  providers: [
    DatabasePermissionService,
    DataSourceService,
    PropertyService,
    RecordService,
    PropertyValueService,
    ViewService,
  ],
})
export class DatabasesModule {}
