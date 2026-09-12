import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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
  familyLocationParamSchema,
  familyMemberLocationParamSchema,
  ingestLocationSchema,
  locationDeviceParamSchema,
  locationHistoryQuerySchema,
} from './dto/location.dto';
import type {
  FamilyLocationParam,
  FamilyMemberLocationParam,
  IngestLocationDto,
  LocationDeviceParam,
  LocationHistoryQueryDto,
} from './dto/location.dto';
import { LocationsService } from './locations.service';
import {
  currentLocationSuccessSchema,
  familyCurrentLocationSuccessSchema,
  familyCurrentLocationsSuccessSchema,
  ingestLocationBodySchema,
  ingestLocationSuccessSchema,
  locationHistorySuccessSchema,
} from './locations.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Locations')
@Controller()
export class LocationsController {
  constructor(private readonly locationsService: LocationsService) {}

  @Post('devices/:deviceId/locations')
  @ApiOperation({ summary: 'Ghi một điểm vị trí từ thiết bị đang hoạt động' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiBody({ schema: ingestLocationBodySchema })
  @ApiResponse({ status: 201, schema: ingestLocationSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  ingest(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(locationDeviceParamSchema))
    params: LocationDeviceParam,
    @Body(new ZodValidationPipe(ingestLocationSchema))
    dto: IngestLocationDto,
  ) {
    return this.locationsService.ingest(user.id, params.deviceId, dto);
  }

  @Get('locations/me/current')
  @ApiOperation({ summary: 'Lấy vị trí hiện tại của tài khoản hiện tại' })
  @ApiResponse({ status: 200, schema: currentLocationSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  getOwnCurrent(@CurrentUser() user: AuthUser) {
    return this.locationsService.getOwnCurrent(user.id);
  }

  @Get('locations/me/history')
  @ApiOperation({ summary: 'Lấy lịch sử vị trí của tài khoản bằng cursor' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, schema: locationHistorySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  getOwnHistory(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(locationHistoryQuerySchema))
    query: LocationHistoryQueryDto,
  ) {
    return this.locationsService.getOwnHistory(user.id, query);
  }

  @Get('families/:familyId/locations/current')
  @ApiOperation({ summary: 'Lấy Family Map hiện tại cho thành viên được phép' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familyCurrentLocationsSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  getFamilyCurrent(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyLocationParamSchema))
    params: FamilyLocationParam,
  ) {
    return this.locationsService.getFamilyCurrent(user.id, params.familyId);
  }

  @Get('families/:familyId/members/:memberId/location')
  @ApiOperation({
    summary: 'Lấy vị trí hiện tại của đúng thành viên trong gia đình',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familyCurrentLocationSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  getFamilyMemberCurrent(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberLocationParamSchema))
    params: FamilyMemberLocationParam,
  ) {
    return this.locationsService.getFamilyMemberCurrent(
      user.id,
      params.familyId,
      params.memberId,
    );
  }
}
