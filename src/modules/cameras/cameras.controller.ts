import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
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
  cameraListQuerySchema,
  cameraParamSchema,
  createCameraSchema,
  familyCameraParamSchema,
  updateCameraSchema,
} from './dto/camera.dto';
import type {
  CameraListQueryDto,
  CameraParam,
  CreateCameraDto,
  FamilyCameraParam,
  UpdateCameraDto,
} from './dto/camera.dto';
import { CamerasService } from './cameras.service';
import {
  cameraListSuccessSchema,
  cameraSuccessSchema,
  createCameraBodySchema,
  updateCameraBodySchema,
} from './cameras.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Cameras')
@Controller('families/:familyId/cameras')
export class CamerasController {
  constructor(private readonly service: CamerasService) {}

  @Post()
  @ApiOperation({ summary: 'Create a family camera configuration as manager' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: createCameraBodySchema })
  @ApiResponse({ status: 201, schema: cameraSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 409, 422, 429, 500)
  create(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyCameraParamSchema))
    params: FamilyCameraParam,
    @Body(new ZodValidationPipe(createCameraSchema)) dto: CreateCameraDto,
  ) {
    return this.service.create(user.id, params.familyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List safe authorized family camera metadata' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false', 'all'] })
  @ApiResponse({ status: 200, schema: cameraListSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  list(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyCameraParamSchema))
    params: FamilyCameraParam,
    @Query(new ZodValidationPipe(cameraListQuerySchema))
    query: CameraListQueryDto,
  ) {
    return this.service.list(user.id, params.familyId, query);
  }

  @Get(':cameraId')
  @ApiOperation({ summary: 'Read safe scoped camera metadata' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'cameraId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: cameraSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(cameraParamSchema)) params: CameraParam,
  ) {
    return this.service.detail(user.id, params.familyId, params.cameraId);
  }

  @Patch(':cameraId')
  @ApiOperation({
    summary: 'Update an explicitly allowed camera configuration',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'cameraId', format: 'uuid' })
  @ApiBody({ schema: updateCameraBodySchema })
  @ApiResponse({ status: 200, schema: cameraSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(cameraParamSchema)) params: CameraParam,
    @Body(new ZodValidationPipe(updateCameraSchema)) dto: UpdateCameraDto,
  ) {
    return this.service.update(user.id, params.familyId, params.cameraId, dto);
  }

  @Delete(':cameraId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Idempotently deactivate a family camera' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'cameraId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(cameraParamSchema)) params: CameraParam,
  ) {
    await this.service.deactivate(user.id, params.familyId, params.cameraId);
  }
}
