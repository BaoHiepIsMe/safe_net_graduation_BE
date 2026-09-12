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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiStandardErrors } from '../../common/swagger/api-docs';
import {
  createFamilySchema,
  createInvitationSchema,
  familyIdParamSchema,
  familyPaginationSchema,
  invitationIdParamSchema,
  updateFamilySchema,
} from './dto/family.dto';
import type {
  CreateFamilyDto,
  CreateInvitationDto,
  FamilyIdParam,
  FamilyPaginationDto,
  InvitationIdParam,
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
  paginatedSuccessSchema,
  pendingInvitationDataSchema,
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
