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
  createReminderSchema,
  reminderListQuerySchema,
  reminderLogQuerySchema,
  reminderParamSchema,
  upcomingReminderQuerySchema,
  updateReminderSchema,
} from './dto/reminder.dto';
import type {
  CreateReminderDto,
  ReminderListQueryDto,
  ReminderLogQueryDto,
  ReminderParam,
  UpcomingReminderQueryDto,
  UpdateReminderDto,
} from './dto/reminder.dto';
import { RemindersService } from './reminders.service';
import {
  createReminderBodySchema,
  reminderListSuccessSchema,
  reminderLogsSuccessSchema,
  reminderSuccessSchema,
  reminderUpcomingSuccessSchema,
  updateReminderBodySchema,
} from './reminders.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Reminders')
@Controller('reminders')
export class RemindersController {
  constructor(private readonly service: RemindersService) {}

  @Post()
  @ApiOperation({ summary: 'Create an atomic manager-owned family reminder' })
  @ApiBody({ schema: createReminderBodySchema })
  @ApiResponse({ status: 201, schema: reminderSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 409, 422, 429, 500)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createReminderSchema)) dto: CreateReminderDto,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List reminders visible to the authenticated user' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 200, schema: reminderListSuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(reminderListQuerySchema))
    query: ReminderListQueryDto,
  ) {
    return this.service.list(user.id, query);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'List bounded upcoming visible reminders' })
  @ApiQuery({ name: 'days', required: false, minimum: 1, maximum: 31 })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiResponse({ status: 200, schema: reminderUpcomingSuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  upcoming(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(upcomingReminderQuerySchema))
    query: UpcomingReminderQueryDto,
  ) {
    return this.service.upcoming(user.id, query);
  }

  @Get(':reminderId/logs')
  @ApiOperation({ summary: 'List authorized durable reminder occurrences' })
  @ApiParam({ name: 'reminderId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiResponse({ status: 200, schema: reminderLogsSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  logs(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(reminderParamSchema)) params: ReminderParam,
    @Query(new ZodValidationPipe(reminderLogQuerySchema))
    query: ReminderLogQueryDto,
  ) {
    return this.service.logs(user.id, params.reminderId, query);
  }

  @Get(':reminderId')
  @ApiOperation({ summary: 'Get an authorized reminder' })
  @ApiParam({ name: 'reminderId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: reminderSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(reminderParamSchema)) params: ReminderParam,
  ) {
    return this.service.detail(user.id, params.reminderId);
  }

  @Patch(':reminderId')
  @ApiOperation({ summary: 'Update an authorized family reminder atomically' })
  @ApiParam({ name: 'reminderId', format: 'uuid' })
  @ApiBody({ schema: updateReminderBodySchema })
  @ApiResponse({ status: 200, schema: reminderSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 409, 422, 429, 500)
  update(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(reminderParamSchema)) params: ReminderParam,
    @Body(new ZodValidationPipe(updateReminderSchema)) dto: UpdateReminderDto,
  ) {
    return this.service.update(user.id, params.reminderId, dto);
  }

  @Delete(':reminderId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-deactivate an authorized reminder' })
  @ApiParam({ name: 'reminderId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  async deactivate(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(reminderParamSchema)) params: ReminderParam,
  ) {
    await this.service.deactivate(user.id, params.reminderId);
  }
}
