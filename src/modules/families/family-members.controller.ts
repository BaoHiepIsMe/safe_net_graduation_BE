import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  familyIdParamSchema,
  familyMemberParamSchema,
  familyPaginationSchema,
  updateFamilyMemberSchema,
} from './dto/family.dto';
import type {
  FamilyIdParam,
  FamilyMemberParam,
  FamilyPaginationDto,
  UpdateFamilyMemberDto,
} from './dto/family.dto';
import { FamiliesService } from './families.service';
import {
  familyMemberDataSchema,
  familyMemberSuccessSchema,
  paginatedSuccessSchema,
  updateFamilyMemberBodySchema,
} from './families.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Family Members')
@Controller('families/:familyId/members')
export class FamilyMembersController {
  constructor(private readonly familiesService: FamiliesService) {}

  @Get()
  @ApiOperation({ summary: 'Liệt kê thành viên đã chấp nhận trong gia đình' })
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
    schema: paginatedSuccessSchema(familyMemberDataSchema),
  })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  listMembers(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyIdParamSchema)) params: FamilyIdParam,
    @Query(new ZodValidationPipe(familyPaginationSchema))
    pagination: FamilyPaginationDto,
  ) {
    return this.familiesService.listMembers(
      user.id,
      params.familyId,
      pagination,
    );
  }

  @Get(':memberId')
  @ApiOperation({ summary: 'Lấy chi tiết thành viên cùng gia đình' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: familyMemberSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  getMember(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
  ) {
    return this.familiesService.getMember(
      user.id,
      params.familyId,
      params.memberId,
    );
  }

  @Patch(':memberId')
  @ApiOperation({ summary: 'Quản lý cập nhật thành viên được phép' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiBody({ schema: updateFamilyMemberBodySchema })
  @ApiResponse({ status: 200, schema: familyMemberSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  updateMember(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
    @Body(new ZodValidationPipe(updateFamilyMemberSchema))
    dto: UpdateFamilyMemberDto,
  ) {
    return this.familiesService.updateMember(
      user.id,
      params.familyId,
      params.memberId,
      dto,
    );
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Quản lý loại thành viên khỏi gia đình' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Đã loại; không có body' })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  async removeMember(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
  ): Promise<void> {
    await this.familiesService.removeMember(
      user.id,
      params.familyId,
      params.memberId,
    );
  }
}
