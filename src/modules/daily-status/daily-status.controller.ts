import { Controller, Get, Param, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
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
  dailyStatusHistoryQuerySchema,
  dailyStatusMemberParamSchema,
  dailyStatusParamSchema,
} from './dto/daily-status.dto';
import type {
  DailyStatusHistoryQueryDto,
  DailyStatusMemberParam,
  DailyStatusParam,
} from './dto/daily-status.dto';
import { DailyStatusService } from './daily-status.service';
import {
  dailyStatusDetailSuccessSchema,
  dailyStatusHistorySuccessSchema,
} from './daily-status.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Daily Status')
@Controller()
export class DailyStatusController {
  constructor(private readonly service: DailyStatusService) {}

  @Get('daily-status')
  @ApiOperation({
    summary: 'List the authenticated subject’s persisted Daily Status reports',
    description:
      'Factual deterministic snapshots only. This is not medical advice, diagnosis, health prediction, or AI inference.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, schema: dailyStatusHistorySuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  ownHistory(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(dailyStatusHistoryQuerySchema))
    query: DailyStatusHistoryQueryDto,
  ) {
    return this.service.ownHistory(user.id, query);
  }

  @Get('daily-status/:reportId')
  @ApiOperation({
    summary: 'Read one authorized persisted Daily Status report',
    description:
      'Sensitive source summaries are redacted when current source-domain privacy does not authorize the viewer.',
  })
  @ApiParam({ name: 'reportId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: dailyStatusDetailSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(dailyStatusParamSchema))
    params: DailyStatusParam,
  ) {
    return this.service.detail(user.id, params.reportId);
  }

  @Get('families/:familyId/members/:memberId/daily-status')
  @ApiOperation({
    summary: 'List an eligible member’s reports as self or current manager',
    description:
      'Current accepted manager authorization is required for another subject. Former managers retain no historical access.',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiResponse({ status: 200, schema: dailyStatusHistorySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  memberHistory(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(dailyStatusMemberParamSchema))
    params: DailyStatusMemberParam,
    @Query(new ZodValidationPipe(dailyStatusHistoryQuerySchema))
    query: DailyStatusHistoryQueryDto,
  ) {
    return this.service.memberHistory(
      user.id,
      params.familyId,
      params.memberId,
      query,
    );
  }
}
