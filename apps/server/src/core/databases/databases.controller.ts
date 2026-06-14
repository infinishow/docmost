import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import {
  CreateDataSourceDto,
  DataSourceIdDto,
  DeleteDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.dto';
import {
  CreatePropertyDto,
  DeletePropertyDto,
  UpdatePropertyDto,
} from './dto/property.dto';
import { UpdatePropertyValueDto } from './dto/property-value.dto';
import { QueryRecordsDto } from './dto/query.dto';
import {
  CreateRecordDto,
  DeleteRecordDto,
  UpdateRecordDto,
} from './dto/record.dto';
import { CreateViewDto, DeleteViewDto, UpdateViewDto } from './dto/view.dto';
import { DataSourceService } from './services/data-source.service';
import { PropertyValueService } from './services/property-value.service';
import { PropertyService } from './services/property.service';
import { RecordService } from './services/record.service';
import { ViewService } from './services/view.service';

@UseGuards(JwtAuthGuard)
@Controller('databases')
export class DatabasesController {
  constructor(
    private readonly dataSourceService: DataSourceService,
    private readonly propertyService: PropertyService,
    private readonly recordService: RecordService,
    private readonly propertyValueService: PropertyValueService,
    private readonly viewService: ViewService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('create')
  create(
    @Body() dto: CreateDataSourceDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.dataSourceService.create(dto, user, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  info(@Body() dto: DataSourceIdDto, @AuthUser() user: User) {
    return this.dataSourceService.info(dto.databaseId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  update(@Body() dto: UpdateDataSourceDto, @AuthUser() user: User) {
    return this.dataSourceService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  delete(@Body() dto: DeleteDataSourceDto, @AuthUser() user: User) {
    return this.dataSourceService.delete(dto.databaseId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/create')
  createProperty(@Body() dto: CreatePropertyDto, @AuthUser() user: User) {
    return this.propertyService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/update')
  updateProperty(@Body() dto: UpdatePropertyDto, @AuthUser() user: User) {
    return this.propertyService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('properties/delete')
  deleteProperty(@Body() dto: DeletePropertyDto, @AuthUser() user: User) {
    return this.propertyService.delete(dto.propertyId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/create')
  createRecord(@Body() dto: CreateRecordDto, @AuthUser() user: User) {
    return this.recordService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/update')
  updateRecord(@Body() dto: UpdateRecordDto, @AuthUser() user: User) {
    return this.recordService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/delete')
  deleteRecord(@Body() dto: DeleteRecordDto, @AuthUser() user: User) {
    return this.recordService.delete(dto.recordId, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('records/query')
  queryRecords(@Body() dto: QueryRecordsDto, @AuthUser() user: User) {
    return this.recordService.query(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('values/update')
  updateValue(@Body() dto: UpdatePropertyValueDto, @AuthUser() user: User) {
    return this.propertyValueService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/create')
  createView(@Body() dto: CreateViewDto, @AuthUser() user: User) {
    return this.viewService.create(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/update')
  updateView(@Body() dto: UpdateViewDto, @AuthUser() user: User) {
    return this.viewService.update(dto, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('views/delete')
  deleteView(@Body() dto: DeleteViewDto, @AuthUser() user: User) {
    return this.viewService.delete(dto.viewId, user);
  }
}
