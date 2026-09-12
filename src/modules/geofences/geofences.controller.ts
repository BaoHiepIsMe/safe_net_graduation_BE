import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiStandardErrors } from '../../common/swagger/api-docs';
import {
  createGeofenceSchema,
  geofenceEventQuerySchema,
  geofenceFamilyParamSchema,
  geofenceListQuerySchema,
  geofenceParamSchema,
  replaceGeofenceMembersSchema,
  updateGeofenceSchema,
} from './dto/geofence.dto';
import type {
  CreateGeofenceDto,
  GeofenceEventQueryDto,
  GeofenceFamilyParam,
  GeofenceListQueryDto,
  GeofenceParam,
  ReplaceGeofenceMembersDto,
  UpdateGeofenceDto,
} from './dto/geofence.dto';
import { GeofencesService } from './geofences.service';
import {
  createGeofenceBodySchema,
  geofenceEventHistorySuccessSchema,
  geofenceListSuccessSchema,
  geofenceSuccessSchema,
  replaceMembersBodySchema,
  updateGeofenceBodySchema,
} from './geofences.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Geofences')
@Controller('families/:familyId/geofences')
export class GeofencesController {
  constructor(private readonly service: GeofencesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a circular family safe zone atomically' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: createGeofenceBodySchema })
  @ApiResponse({ status: 201, schema: geofenceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  create(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceFamilyParamSchema))
    params: GeofenceFamilyParam,
    @Body(new ZodValidationPipe(createGeofenceSchema)) dto: CreateGeofenceDto,
  ) {
    return this.service.create(user.id, params.familyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List family safe zones' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, minimum: 1 })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 200, schema: geofenceListSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  list(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceFamilyParamSchema))
    params: GeofenceFamilyParam,
    @Query(new ZodValidationPipe(geofenceListQuerySchema))
    query: GeofenceListQueryDto,
  ) {
    return this.service.list(user.id, params.familyId, query);
  }

  @Get('events')
  @ApiOperation({ summary: 'List durable family safe-zone transitions' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'geofenceId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'memberId', required: false, format: 'uuid' })
  @ApiQuery({ name: 'eventType', required: false, enum: ['enter', 'exit'] })
  @ApiResponse({ status: 200, schema: geofenceEventHistorySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  listEvents(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceFamilyParamSchema))
    params: GeofenceFamilyParam,
    @Query(new ZodValidationPipe(geofenceEventQuerySchema))
    query: GeofenceEventQueryDto,
  ) {
    return this.service.listEvents(user.id, params.familyId, query);
  }

  @Get(':geofenceId')
  @ApiOperation({ summary: 'Get one family-scoped safe zone' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'geofenceId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: geofenceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  getOne(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceParamSchema)) params: GeofenceParam,
  ) {
    return this.service.getOne(user.id, params.familyId, params.geofenceId);
  }

  @Patch(':geofenceId')
  @ApiOperation({ summary: 'Update allowlisted safe-zone fields' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'geofenceId', format: 'uuid' })
  @ApiBody({ schema: updateGeofenceBodySchema })
  @ApiResponse({ status: 200, schema: geofenceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceParamSchema)) params: GeofenceParam,
    @Body(new ZodValidationPipe(updateGeofenceSchema)) dto: UpdateGeofenceDto,
  ) {
    return this.service.update(
      user.id,
      params.familyId,
      params.geofenceId,
      dto,
    );
  }

  @Put(':geofenceId/members')
  @ApiOperation({ summary: 'Atomically replace accepted member assignments' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'geofenceId', format: 'uuid' })
  @ApiBody({ schema: replaceMembersBodySchema })
  @ApiResponse({ status: 200, schema: geofenceSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  replaceMembers(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceParamSchema)) params: GeofenceParam,
    @Body(new ZodValidationPipe(replaceGeofenceMembersSchema))
    dto: ReplaceGeofenceMembersDto,
  ) {
    return this.service.replaceMembers(
      user.id,
      params.familyId,
      params.geofenceId,
      dto,
    );
  }

  @Delete(':geofenceId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Deactivate a safe zone while preserving history' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'geofenceId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(geofenceParamSchema)) params: GeofenceParam,
  ) {
    await this.service.deactivate(user.id, params.familyId, params.geofenceId);
  }
}
