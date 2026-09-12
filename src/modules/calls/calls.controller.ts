import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
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
import { CallsService } from './calls.service';
import { callSchema, createCallBodySchema } from './calls.swagger';
import {
  callHistoryQuerySchema,
  callParamSchema,
  conversationCallParamSchema,
  createCallSchema,
  emptyCallActionSchema,
} from './dto/call.dto';
import type {
  CallHistoryQueryDto,
  CallParam,
  ConversationCallParam,
  CreateCallDto,
} from './dto/call.dto';

@ApiBearerAuth('JWT-auth')
@ApiTags('Calls')
@Controller('conversations/:conversationId/calls')
export class ConversationCallsController {
  constructor(private readonly service: CallsService) {}

  @Post()
  @ApiOperation({
    summary: 'Create an idempotent 1:1 voice/video Call invitation',
    description:
      'Requires a current direct Conversation. NestJS persists signaling state but does not transport audio or video.',
  })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiBody({ schema: createCallBodySchema })
  @ApiResponse({ status: 201, schema: callSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  create(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationCallParamSchema))
    params: ConversationCallParam,
    @Body(new ZodValidationPipe(createCallSchema)) dto: CreateCallDto,
  ) {
    return this.service.create(user.id, params.conversationId, dto);
  }
}

@ApiBearerAuth('JWT-auth')
@ApiTags('Calls')
@Controller('calls')
export class CallsController {
  constructor(private readonly service: CallsService) {}

  @Get()
  @ApiOperation({ summary: 'List personal Call session history' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiResponse({
    status: 200,
    description: 'Bounded participant-owned Call page',
  })
  @ApiStandardErrors(400, 401, 429, 500)
  history(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(callHistoryQuerySchema))
    query: CallHistoryQueryDto,
  ) {
    return this.service.history(user.id, query);
  }

  @Get(':callId')
  @ApiOperation({ summary: 'Get participant-owned Call detail' })
  @ApiParam({ name: 'callId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: callSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(callParamSchema)) params: CallParam,
  ) {
    return this.service.detail(user.id, params.callId);
  }

  @Post(':callId/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Callee accepts a ringing Call invitation' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiResponse({ status: 200, schema: callSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  accept(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(callParamSchema)) params: CallParam,
    @Body(new ZodValidationPipe(emptyCallActionSchema)) _body: object,
  ) {
    return this.service.transition(user.id, params.callId, 'accept');
  }

  @Post(':callId/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Callee rejects a ringing Call invitation' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiResponse({ status: 200, schema: callSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  reject(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(callParamSchema)) params: CallParam,
    @Body(new ZodValidationPipe(emptyCallActionSchema)) _body: object,
  ) {
    return this.service.transition(user.id, params.callId, 'reject');
  }

  @Post(':callId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Caller cancels a ringing Call invitation' })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiResponse({ status: 200, schema: callSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(callParamSchema)) params: CallParam,
    @Body(new ZodValidationPipe(emptyCallActionSchema)) _body: object,
  ) {
    return this.service.transition(user.id, params.callId, 'cancel');
  }

  @Post(':callId/end')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Either participant ends an accepted signaling session',
    description:
      'The derived duration is signaling-session time, not verified media talk-time.',
  })
  @ApiBody({ schema: { type: 'object', additionalProperties: false } })
  @ApiResponse({ status: 200, schema: callSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  end(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(callParamSchema)) params: CallParam,
    @Body(new ZodValidationPipe(emptyCallActionSchema)) _body: object,
  ) {
    return this.service.transition(user.id, params.callId, 'end');
  }
}
