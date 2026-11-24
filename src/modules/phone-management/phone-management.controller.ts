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
  commandAckSchema,
  commandListQuerySchema,
  createPhoneCommandSchema,
  createPhoneRuleSchema,
  deviceCommandParamSchema,
  deviceParamSchema,
  familyMemberDeviceParamSchema,
  familyMemberParamSchema,
  phoneRuleParamSchema,
  phoneUsageSchema,
  updatePhoneRuleSchema,
  usageListQuerySchema,
} from './dto/phone-management.dto';
import type {
  CommandAckDto,
  CommandListQueryDto,
  CreatePhoneCommandDto,
  CreatePhoneRuleDto,
  DeviceCommandParam,
  DeviceParam,
  FamilyMemberDeviceParam,
  FamilyMemberParam,
  PhoneRuleParam,
  PhoneUsageDto,
  UpdatePhoneRuleDto,
  UsageListQueryDto,
} from './dto/phone-management.dto';
import { PhoneManagementService } from './phone-management.service';
import {
  commandAckBodySchema,
  commandSuccessSchema,
  cursorListSchema,
  phoneCommandBodySchema,
  phoneCommandDataSchema,
  phoneDeviceListSchema,
  phoneRuleBodySchema,
  phoneRuleDataSchema,
  phoneRuleUpdateBodySchema,
  phoneUsageBodySchema,
  phoneUsageDataSchema,
  ruleSuccessSchema,
  usageSuccessSchema,
} from './phone-management.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('Phone Management')
@Controller()
export class PhoneManagementController {
  constructor(private readonly service: PhoneManagementService) {}

  @Post('families/:familyId/members/:memberId/devices/:deviceId/phone-usage')
  @ApiOperation({
    summary: 'Submit device-reported usage for the authenticated child Device',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiBody({ schema: phoneUsageBodySchema })
  @ApiResponse({ status: 201, schema: usageSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 409, 422, 429, 500)
  submitUsage(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberDeviceParamSchema))
    params: FamilyMemberDeviceParam,
    @Body(new ZodValidationPipe(phoneUsageSchema)) dto: PhoneUsageDto,
  ) {
    return this.service.submitUsage(
      user.id,
      params.familyId,
      params.memberId,
      params.deviceId,
      dto,
    );
  }

  @Get('phone-management/me/usage')
  @ApiOperation({ summary: 'List authenticated managed-child usage' })
  @ApiQuery({ name: 'from', required: false, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, format: 'date-time' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiResponse({ status: 200, schema: cursorListSchema(phoneUsageDataSchema) })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listOwnUsage(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(usageListQuerySchema))
    query: UsageListQueryDto,
  ) {
    return this.service.listOwnUsage(user.id, query);
  }

  @Get('families/:familyId/members/:memberId/phone-usage')
  @ApiOperation({
    summary: 'List usage of a currently managed child as manager',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiQuery({ name: 'from', required: false, format: 'date-time' })
  @ApiQuery({ name: 'to', required: false, format: 'date-time' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiResponse({ status: 200, schema: cursorListSchema(phoneUsageDataSchema) })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listManagedUsage(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
    @Query(new ZodValidationPipe(usageListQuerySchema))
    query: UsageListQueryDto,
  ) {
    return this.service.listManagedUsage(
      user.id,
      params.familyId,
      params.memberId,
      query,
    );
  }

  @Post('families/:familyId/members/:memberId/phone-rules')
  @ApiOperation({
    summary: 'Create persisted policy intent for a managed child',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiBody({ schema: phoneRuleBodySchema })
  @ApiResponse({ status: 201, schema: ruleSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 409, 422, 429, 500)
  createRule(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
    @Body(new ZodValidationPipe(createPhoneRuleSchema)) dto: CreatePhoneRuleDto,
  ) {
    return this.service.createRule(
      user.id,
      params.familyId,
      params.memberId,
      dto,
    );
  }

  @Get('families/:familyId/members/:memberId/phone-rules')
  @ApiOperation({ summary: 'List phone rules as the current family manager' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: cursorListSchema(phoneRuleDataSchema) })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listRules(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
  ) {
    return this.service.listRules(user.id, params.familyId, params.memberId);
  }

  @Get('families/:familyId/members/:memberId/phone-devices')
  @ApiOperation({
    summary: "List a managed child's active Devices and their lock state",
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: phoneDeviceListSchema })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listMemberDevices(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
  ) {
    return this.service.listMemberDevices(
      user.id,
      params.familyId,
      params.memberId,
    );
  }

  @Get('phone-management/me/rules')
  @ApiOperation({
    summary: 'List safe effective policy intent for the current child',
  })
  @ApiResponse({ status: 200, schema: cursorListSchema(phoneRuleDataSchema) })
  @ApiStandardErrors(401, 429, 500)
  listOwnRules(@CurrentUser() user: AuthUser) {
    return this.service.listOwnRules(user.id);
  }

  @Patch('families/:familyId/members/:memberId/phone-rules/:ruleId')
  @ApiOperation({
    summary: 'Update allowlisted phone-rule fields as current manager',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiBody({ schema: phoneRuleUpdateBodySchema })
  @ApiResponse({ status: 200, schema: ruleSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  updateRule(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(phoneRuleParamSchema)) params: PhoneRuleParam,
    @Body(new ZodValidationPipe(updatePhoneRuleSchema)) dto: UpdatePhoneRuleDto,
  ) {
    return this.service.updateRule(
      user.id,
      params.familyId,
      params.memberId,
      params.ruleId,
      dto,
    );
  }

  @Delete('families/:familyId/members/:memberId/phone-rules/:ruleId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Soft-deactivate a phone rule as current manager' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiParam({ name: 'ruleId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiStandardErrors(400, 401, 403, 404, 429, 500)
  async deactivateRule(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(phoneRuleParamSchema)) params: PhoneRuleParam,
  ) {
    await this.service.deactivateRule(
      user.id,
      params.familyId,
      params.memberId,
      params.ruleId,
    );
  }

  @Post('families/:familyId/members/:memberId/devices/:deviceId/phone-commands')
  @ApiOperation({
    summary: 'Persist a managed-device command before transport',
    description:
      'Creation or FCM delivery never means execution. Only target Device ACK may complete it.',
  })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiBody({ schema: phoneCommandBodySchema })
  @ApiResponse({ status: 201, schema: commandSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 409, 422, 429, 500)
  createCommand(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberDeviceParamSchema))
    params: FamilyMemberDeviceParam,
    @Body(new ZodValidationPipe(createPhoneCommandSchema))
    dto: CreatePhoneCommandDto,
  ) {
    return this.service.createCommand(
      user.id,
      params.familyId,
      params.memberId,
      params.deviceId,
      dto,
    );
  }

  @Get('families/:familyId/members/:memberId/phone-commands')
  @ApiOperation({ summary: 'List truthful command history as current manager' })
  @ApiParam({ name: 'familyId', format: 'uuid' })
  @ApiParam({ name: 'memberId', format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'sent', 'completed', 'failed', 'all'],
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiResponse({
    status: 200,
    schema: cursorListSchema(phoneCommandDataSchema),
  })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listManagedCommands(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(familyMemberParamSchema))
    params: FamilyMemberParam,
    @Query(new ZodValidationPipe(commandListQuerySchema))
    query: CommandListQueryDto,
  ) {
    return this.service.listManagedCommands(
      user.id,
      params.familyId,
      params.memberId,
      query,
    );
  }

  @Get('devices/:deviceId/phone-commands')
  @ApiOperation({ summary: 'Poll commands targeting an owned active Device' })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['pending', 'sent', 'completed', 'failed', 'all'],
  })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiResponse({
    status: 200,
    schema: cursorListSchema(phoneCommandDataSchema),
  })
  @ApiStandardErrors(400, 401, 403, 429, 500)
  listDeviceCommands(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceParamSchema)) params: DeviceParam,
    @Query(new ZodValidationPipe(commandListQuerySchema))
    query: CommandListQueryDto,
  ) {
    return this.service.listDeviceCommands(user.id, params.deviceId, query);
  }

  @Post('devices/:deviceId/phone-commands/:commandId/ack')
  @HttpCode(200)
  @ApiOperation({
    summary: 'ACK actual command execution from the owned target Device',
  })
  @ApiParam({ name: 'deviceId', format: 'uuid' })
  @ApiParam({ name: 'commandId', format: 'uuid' })
  @ApiBody({ schema: commandAckBodySchema })
  @ApiResponse({ status: 200, schema: commandSuccessSchema })
  @ApiStandardErrors(400, 401, 403, 404, 409, 422, 429, 500)
  acknowledgeCommand(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(deviceCommandParamSchema))
    params: DeviceCommandParam,
    @Body(new ZodValidationPipe(commandAckSchema)) dto: CommandAckDto,
  ) {
    return this.service.acknowledgeCommand(
      user.id,
      params.deviceId,
      params.commandId,
      dto,
    );
  }
}
