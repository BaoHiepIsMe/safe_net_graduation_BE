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
import { ChatService } from './chat.service';
import {
  addGroupMemberSchema,
  chatListQuerySchema,
  conversationMemberParamSchema,
  conversationParamSchema,
  createDirectSchema,
  createGroupSchema,
  familyParamSchema,
  markReadSchema,
  sendMessageSchema,
} from './dto/chat.dto';
import type {
  AddGroupMemberDto,
  ChatListQueryDto,
  ConversationMemberParam,
  ConversationParam,
  CreateDirectDto,
  CreateGroupDto,
  FamilyParam,
  MarkReadDto,
  SendMessageDto,
} from './dto/chat.dto';
import {
  addMemberBodySchema,
  conversationPageSuccessSchema,
  conversationSuccessSchema,
  directBodySchema,
  directConversationSuccessSchema,
  groupBodySchema,
  memberListSuccessSchema,
  messagePageSuccessSchema,
  messageBodySchema,
  messageSuccessSchema,
  readCursorSuccessSchema,
  readBodySchema,
  unreadCountSuccessSchema,
} from './chat.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Chat')
@Controller('families/:familyId/conversations')
export class FamilyConversationsController {
  constructor(private readonly service: ChatService) {}

  @Post('direct')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Get or create a unique direct family conversation',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: directBodySchema })
  @ApiResponse({
    status: 200,
    description: 'Existing or newly created conversation',
    schema: directConversationSuccessSchema,
  })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  direct(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyParamSchema)) params: FamilyParam,
    @Body(new ZodValidationPipe(createDirectSchema)) dto: CreateDirectDto,
  ) {
    return this.service.createDirect(
      user.id,
      params.familyId,
      dto.targetMemberId,
    );
  }

  @Post('group')
  @ApiOperation({ summary: 'Create a manager-owned family group conversation' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: groupBodySchema })
  @ApiResponse({
    status: 201,
    description: 'Group created',
    schema: conversationSuccessSchema,
  })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  group(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyParamSchema)) params: FamilyParam,
    @Body(new ZodValidationPipe(createGroupSchema)) dto: CreateGroupDto,
  ) {
    return this.service.createGroup(user.id, params.familyId, dto);
  }
}

@ApiBearerAuth('JWT-auth')
@ApiTags('Chat')
@Controller('conversations')
export class ConversationsController {
  constructor(private readonly service: ChatService) {}

  @Get()
  @ApiOperation({ summary: 'List currently authorized conversations' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiStandardErrors(400, 401, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Bounded conversation page',
    schema: conversationPageSuccessSchema,
  })
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(chatListQuerySchema)) query: ChatListQueryDto,
  ) {
    return this.service.list(user.id, query);
  }

  @Get(':conversationId')
  @ApiOperation({ summary: 'Get an authorized conversation' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Authorized conversation detail',
    schema: conversationSuccessSchema,
  })
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
  ) {
    return this.service.detail(user.id, p.conversationId);
  }

  @Get(':conversationId/members')
  @ApiOperation({ summary: 'List current authorized conversation members' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Current conversation members',
    schema: memberListSuccessSchema,
  })
  members(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
  ) {
    return this.service.members(user.id, p.conversationId);
  }

  @Post(':conversationId/members')
  @ApiOperation({
    summary: 'Add a current family member to a group (manager only)',
  })
  @ApiBody({ schema: addMemberBodySchema })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  @ApiResponse({
    status: 201,
    description: 'Member added',
    schema: memberListSuccessSchema,
  })
  addMember(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
    @Body(new ZodValidationPipe(addGroupMemberSchema)) dto: AddGroupMemberDto,
  ) {
    return this.service.addMember(user.id, p.conversationId, dto.memberId);
  }

  @Delete(':conversationId/members/:memberId')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Remove a group member (current family manager only)',
  })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 403, 404, 422, 429, 500)
  @ApiResponse({ status: 204, description: 'Member removed' })
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationMemberParamSchema))
    p: ConversationMemberParam,
  ) {
    await this.service.removeMember(user.id, p.conversationId, p.memberId);
  }

  @Post(':conversationId/messages')
  @ApiOperation({
    summary: 'Persist one idempotent text message, then deliver it',
  })
  @ApiBody({ schema: messageBodySchema })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  @ApiResponse({
    status: 201,
    description: 'Persisted text message',
    schema: messageSuccessSchema,
  })
  send(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
    @Body(new ZodValidationPipe(sendMessageSchema)) dto: SendMessageDto,
  ) {
    return this.service.send(user.id, p.conversationId, dto);
  }

  @Get(':conversationId/messages')
  @ApiOperation({ summary: 'List bounded authorized text message history' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Bounded authorized message page',
    schema: messagePageSuccessSchema,
  })
  history(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
    @Query(new ZodValidationPipe(chatListQuerySchema)) q: ChatListQueryDto,
  ) {
    return this.service.history(user.id, p.conversationId, q);
  }

  @Patch(':conversationId/read')
  @ApiOperation({
    summary: 'Advance the authenticated member read cursor monotonically',
  })
  @ApiBody({ schema: readBodySchema })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 404, 409, 422, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Current monotonic read cursor',
    schema: readCursorSuccessSchema,
  })
  read(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
    @Body(new ZodValidationPipe(markReadSchema)) dto: MarkReadDto,
  ) {
    return this.service.markRead(
      user.id,
      p.conversationId,
      dto.lastReadMessageId,
    );
  }

  @Get(':conversationId/unread-count')
  @ApiOperation({ summary: 'Get unread count without per-message receipts' })
  @ApiParam({ name: 'conversationId', format: 'uuid' })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  @ApiResponse({
    status: 200,
    description: 'Conversation unread count',
    schema: unreadCountSuccessSchema,
  })
  unread(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(conversationParamSchema)) p: ConversationParam,
  ) {
    return this.service.unreadCount(user.id, p.conversationId);
  }
}
