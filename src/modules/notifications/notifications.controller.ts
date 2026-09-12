import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
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
  emptyNotificationMutationSchema,
  notificationListQuerySchema,
  notificationParamSchema,
} from './dto/notification.dto';
import type {
  NotificationListQueryDto,
  NotificationParam,
} from './dto/notification.dto';
import { NotificationsService } from './notifications.service';
import {
  emptyMutationBodySchema,
  notificationListSuccessSchema,
  notificationSuccessSchema,
  readAllSuccessSchema,
  unreadCountSuccessSchema,
} from './notifications.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List the authenticated user notifications' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'read', required: false, enum: ['all', 'read', 'unread'] })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: ['geofence_enter', 'geofence_exit', 'sos_alert'],
  })
  @ApiResponse({ status: 200, schema: notificationListSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(notificationListQuerySchema))
    query: NotificationListQueryDto,
  ) {
    return this.service.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Count unread notifications from durable state' })
  @ApiResponse({ status: 200, schema: unreadCountSuccessSchema })
  @ApiStandardErrors(401, 429, 500)
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.service.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Idempotently mark all owned notifications read' })
  @ApiBody({ schema: emptyMutationBodySchema })
  @ApiResponse({ status: 200, schema: readAllSuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  markAllRead(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(emptyNotificationMutationSchema)) _body: object,
  ) {
    return this.service.markAllRead(user.id);
  }

  @Get(':notificationId')
  @ApiOperation({ summary: 'Get one owned notification' })
  @ApiParam({ name: 'notificationId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: notificationSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  getOne(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(notificationParamSchema))
    params: NotificationParam,
  ) {
    return this.service.getOne(user.id, params.notificationId);
  }

  @Patch(':notificationId/read')
  @ApiOperation({ summary: 'Idempotently mark one owned notification read' })
  @ApiParam({ name: 'notificationId', format: 'uuid' })
  @ApiBody({ schema: emptyMutationBodySchema })
  @ApiResponse({ status: 200, schema: notificationSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  markRead(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(notificationParamSchema))
    params: NotificationParam,
    @Body(new ZodValidationPipe(emptyNotificationMutationSchema)) _body: object,
  ) {
    return this.service.markRead(user.id, params.notificationId);
  }
}
