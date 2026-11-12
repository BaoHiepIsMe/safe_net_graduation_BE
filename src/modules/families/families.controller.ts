import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiStandardErrors } from '../../common/swagger/api-docs';
import {
  createFamilySchema,
  createInvitationSchema,
  familyIdParamSchema,
  familyInvitationParamSchema,
  familyPaginationSchema,
  invitationIdParamSchema,
  joinFamilySchema,
  transferOwnershipSchema,
  updateFamilySchema,
} from './dto/family.dto';
import type {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyIdParam,
  FamilyInvitationParam,
  FamilyPaginationDto,
  InvitationIdParam,
  JoinFamilyDto,
  TransferOwnershipDto,
  UpdateFamilyDto,
} from './dto/family.dto';
import { FamiliesService } from './families.service';
import {
  createFamilyBodySchema,
  createFamilySuccessSchema,
  createInvitationBodySchema,
  familyDataSchema,
  familyMemberSuccessSchema,
  familySuccessSchema,
  inviteCodeSuccessSchema,
  joinFamilyBodySchema,
  paginatedSuccessSchema,
  pendingInvitationDataSchema,
  sentInvitationDataSchema,
  sentInvitationSuccessSchema,
  transferOwnershipBodySchema,
  updateFamilyBodySchema,
} from './families.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Families')
@Controller('families')
export class FamiliesController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Post()
  @ApiOperation({ summary: 'Tạo gia đình và membership quản lý ban đầu' })
  @ApiBody({ schema: createFamilyBodySchema })
  @ApiResponse({ status: 201, schema: createFamilySuccessSchema })
  @ApiStandardErrors(400, 401, 409, 422, 429, 500)
  createFamily(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createFamilySchema)) dto: CreateFamilyDto,
  ) {
    return this.familiesService.createFamily(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Liệt kê các gia đình user đang là thành viên' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({
    status: 200,
    schema: paginatedSuccessSchema(familyDataSchema),
  })
  @ApiStandardErrors(400, 401, 429, 500)
  listFamilies(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(familyPaginationSchema))
    pagination: FamilyPaginationDto,
  ) {
    return this.familiesService.listFamilies(user.id, pagination);
  }

  @Get('invitations/pending')
  @ApiOperation({ summary: 'Liệt kê lời mời đang chờ của user hiện tại' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({
    status: 200,
    schema: paginatedSuccessSchema(pendingInvitationDataSchema),
  })
  @ApiStandardErrors(400, 401, 429, 500)
  listPendingInvitations(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(familyPaginationSchema))
    pagination: FamilyPaginationDto,
  ) {
    return this.familiesService.listPendingInvitations(user.id, pagination);
  }

  @Post('invitations/:invitationId/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Chấp nhận lời mời của user hiện tại' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familyMemberSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  acceptInvitation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(invitationIdParamSchema))
    params: InvitationIdParam,
  ) {
    return this.familiesService.acceptInvitation(user.id, params.invitationId);
  }

  @Post('invitations/:invitationId/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Từ chối lời mời của user hiện tại' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familyMemberSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  rejectInvitation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(invitationIdParamSchema))
    params: InvitationIdParam,
  ) {
    return this.familiesService.rejectInvitation(user.id, params.invitationId);
  }

  @Post('join')
  // Tighter than the global limit: slows down guessing of invite codes.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Vào gia đình ngay bằng mã mời còn hạn (không cần duyệt)',
  })
  @ApiBody({ schema: joinFamilyBodySchema })
  @ApiResponse({ status: 201, schema: createFamilySuccessSchema })
  @ApiStandardErrors(400, 401, 404, 409, 429, 500)
  joinFamily(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(joinFamilySchema)) dto: JoinFamilyDto,
  ) {
    return this.familiesService.joinByCode(user.id, dto);
  }

  @Get(':familyId/invitations')
  @ApiOperation({
    summary: 'Quản lý xem lời mời đang chờ đã gửi (kể cả đã hết hạn)',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiQuery({ name: 'page', required: false, type: Number, minimum: 1 })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    minimum: 1,
    maximum: 100,
  })
  @ApiResponse({
    status: 200,
    schema: paginatedSuccessSchema(sentInvitationDataSchema),
  })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listSentInvitations(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
    @Query(new ZodValidationPipe(familyPaginationSchema))
    pagination: FamilyPaginationDto,
  ) {
    return this.familiesService.listSentInvitations(
      user.id,
      params.familyId,
      pagination,
    );
  }

  @Delete(':familyId/invitations/:invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quản lý huỷ một lời mời đang chờ' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã huỷ; không có body' })
  @ApiStandardErrors(400, 401, 403, 404, 422, 429, 500)
  async cancelInvitation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyInvitationParamSchema))
    params: FamilyInvitationParam,
  ): Promise<void> {
    await this.familiesService.cancelInvitation(
      user.id,
      params.familyId,
      params.invitationId,
    );
  }

  @Post(':familyId/invitations/:invitationId/resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quản lý gửi lại lời mời, tính lại hạn 7 ngày' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'invitationId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: sentInvitationSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 422, 429, 500)
  resendInvitation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyInvitationParamSchema))
    params: FamilyInvitationParam,
  ) {
    return this.familiesService.resendInvitation(
      user.id,
      params.familyId,
      params.invitationId,
    );
  }

  @Get(':familyId/invite-code')
  @ApiOperation({
    summary: 'Quản lý xem mã mời; tạo mã mới nếu chưa có hoặc đã hết hạn',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: inviteCodeSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  getInviteCode(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
  ) {
    return this.familiesService.getInviteCode(user.id, params.familyId);
  }

  @Post(':familyId/invite-code/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quản lý tạo mã mời mới; mã cũ hết hiệu lực ngay' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: inviteCodeSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  regenerateInviteCode(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
  ) {
    return this.familiesService.regenerateInviteCode(user.id, params.familyId);
  }

  @Post(':familyId/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Tự rời gia đình (không áp dụng cho trẻ em và chủ sở hữu)',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã rời; không có body' })
  @ApiStandardErrors(400, 401, 403, 404, 422, 429, 500)
  async leaveFamily(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
  ): Promise<void> {
    await this.familiesService.leaveFamily(user.id, params.familyId);
  }

  @Post(':familyId/transfer-ownership')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Chủ sở hữu chuyển quyền cho người lớn hoặc quản lý khác',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: transferOwnershipBodySchema })
  @ApiResponse({ status: 200, schema: familySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 422, 429, 500)
  transferOwnership(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ) {
    return this.familiesService.transferOwnership(
      user.id,
      params.familyId,
      dto,
    );
  }

  @Post(':familyId/invitations')
  @ApiOperation({
    summary: 'Quản lý gửi lời mời bằng email hoặc số điện thoại',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: createInvitationBodySchema })
  @ApiResponse({ status: 201, schema: familyMemberSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  createInvitation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
    @Body(new ZodValidationPipe(createInvitationSchema))
    dto: CreateInvitationDto,
  ) {
    return this.familiesService.createInvitation(user.id, params.familyId, dto);
  }

  @Get(':familyId')
  @ApiOperation({ summary: 'Lấy chi tiết gia đình được phép truy cập' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  getFamily(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
  ) {
    return this.familiesService.getFamily(user.id, params.familyId);
  }

  @Patch(':familyId')
  @ApiOperation({ summary: 'Quản lý cập nhật thông tin gia đình' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiBody({ schema: updateFamilyBodySchema })
  @ApiResponse({ status: 200, schema: familySuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  updateFamily(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
    @Body(new ZodValidationPipe(updateFamilySchema)) dto: UpdateFamilyDto,
  ) {
    return this.familiesService.updateFamily(user.id, params.familyId, dto);
  }

  @Delete(':familyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Lưu trữ gia đình (không xóa vật lý)' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã lưu trữ; không có body' })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  async archiveFamily(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
  ): Promise<void> {
    await this.familiesService.archiveFamily(user.id, params.familyId);
  }
}
