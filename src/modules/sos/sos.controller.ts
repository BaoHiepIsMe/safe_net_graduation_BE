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
  createSosContactSchema,
  emptySosTransitionSchema,
  sosContactListQuerySchema,
  sosContactParamSchema,
  sosEventParamSchema,
  sosHistoryQuerySchema,
  triggerSosSchema,
  updateSosContactSchema,
} from './dto/sos.dto';
import type {
  CreateSosContactDto,
  SosContactListQueryDto,
  SosContactParam,
  SosEventParam,
  SosHistoryQueryDto,
  TriggerSosDto,
  UpdateSosContactDto,
} from './dto/sos.dto';
import { SosService } from './sos.service';
import {
  createSosContactBodySchema,
  emptySosBodySchema,
  sosContactListSuccessSchema,
  sosContactSuccessSchema,
  sosEventSuccessSchema,
  sosHistorySuccessSchema,
  triggerSosBodySchema,
  updateSosContactBodySchema,
} from './sos.swagger';

@ApiBearerAuth('JWT-auth')
@ApiTags('SOS / Emergency')
@Controller('sos')
export class SosController {
  constructor(private readonly service: SosService) {}

  @Get('contacts')
  @ApiOperation({ summary: 'List the authenticated user emergency contacts' })
  @ApiQuery({ name: 'page', required: false, minimum: 1 })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'active', required: false, enum: ['true', 'false'] })
  @ApiResponse({ status: 200, schema: sosContactListSuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  listContacts(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(sosContactListQuerySchema))
    query: SosContactListQueryDto,
  ) {
    return this.service.listContacts(user.id, query);
  }

  @Post('contacts')
  @ApiOperation({ summary: 'Create an owned emergency contact' })
  @ApiBody({ schema: createSosContactBodySchema })
  @ApiResponse({ status: 201, schema: sosContactSuccessSchema })
  @ApiStandardErrors(400, 401, 409, 422, 429, 500)
  createContact(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(createSosContactSchema))
    dto: CreateSosContactDto,
  ) {
    return this.service.createContact(user.id, dto);
  }

  @Patch('contacts/:contactId')
  @ApiOperation({ summary: 'Update an owned emergency contact' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiBody({ schema: updateSosContactBodySchema })
  @ApiResponse({ status: 200, schema: sosContactSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 409, 422, 429, 500)
  updateContact(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(sosContactParamSchema))
    params: SosContactParam,
    @Body(new ZodValidationPipe(updateSosContactSchema))
    dto: UpdateSosContactDto,
  ) {
    return this.service.updateContact(user.id, params.contactId, dto);
  }

  @Delete('contacts/:contactId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an owned emergency contact' })
  @ApiParam({ name: 'contactId', format: 'uuid' })
  @ApiResponse({ status: 204 })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  async deleteContact(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(sosContactParamSchema))
    params: SosContactParam,
  ) {
    await this.service.deleteContact(user.id, params.contactId);
  }

  @Get()
  @ApiOperation({ summary: 'List the authenticated user SOS history' })
  @ApiQuery({ name: 'limit', required: false, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({
    name: 'status',
    required: false,
    enum: ['active', 'resolved', 'cancelled'],
  })
  @ApiResponse({ status: 200, schema: sosHistorySuccessSchema })
  @ApiStandardErrors(400, 401, 429, 500)
  history(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(sosHistoryQuerySchema))
    query: SosHistoryQueryDto,
  ) {
    return this.service.history(user.id, query);
  }

  @Post()
  @ApiOperation({ summary: 'Trigger an idempotent manual SOS incident' })
  @ApiBody({ schema: triggerSosBodySchema })
  @ApiResponse({ status: 201, schema: sosEventSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 409, 422, 429, 500)
  trigger(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(triggerSosSchema)) dto: TriggerSosDto,
  ) {
    return this.service.trigger(user.id, dto);
  }

  @Get(':sosEventId')
  @ApiOperation({
    summary: 'Get an actor- or recipient-authorized SOS incident',
  })
  @ApiParam({ name: 'sosEventId', format: 'uuid' })
  @ApiResponse({ status: 200, schema: sosEventSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 429, 500)
  detail(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(sosEventParamSchema)) params: SosEventParam,
  ) {
    return this.service.detail(user.id, params.sosEventId);
  }

  @Patch(':sosEventId/resolve')
  @ApiOperation({ summary: 'Idempotently resolve an owned active SOS' })
  @ApiParam({ name: 'sosEventId', format: 'uuid' })
  @ApiBody({ schema: emptySosBodySchema })
  @ApiResponse({ status: 200, schema: sosEventSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 422, 429, 500)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(sosEventParamSchema)) params: SosEventParam,
    @Body(new ZodValidationPipe(emptySosTransitionSchema)) _body: object,
  ) {
    return this.service.resolve(user.id, params.sosEventId);
  }

  @Patch(':sosEventId/cancel')
  @ApiOperation({ summary: 'Idempotently cancel an owned active SOS' })
  @ApiParam({ name: 'sosEventId', format: 'uuid' })
  @ApiBody({ schema: emptySosBodySchema })
  @ApiResponse({ status: 200, schema: sosEventSuccessSchema })
  @ApiStandardErrors(400, 401, 404, 422, 429, 500)
  cancel(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(sosEventParamSchema)) params: SosEventParam,
    @Body(new ZodValidationPipe(emptySosTransitionSchema)) _body: object,
  ) {
    return this.service.cancel(user.id, params.sosEventId);
  }
}
