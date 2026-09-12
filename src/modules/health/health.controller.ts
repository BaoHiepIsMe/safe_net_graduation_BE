import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service';
import { Public } from '../../common/decorators/public.decorator';
import {
  ApiStandardErrors,
  livenessDataSchema,
  readinessDataSchema,
  successSchema,
} from '../../common/swagger/api-docs';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness tương thích ngược' })
  @ApiResponse({ status: 200, schema: successSchema(livenessDataSchema) })
  @ApiStandardErrors(429, 500)
  getHealth() {
    return this.healthService.checkLiveness();
  }

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Kiểm tra tiến trình đang hoạt động' })
  @ApiResponse({ status: 200, schema: successSchema(livenessDataSchema) })
  @ApiStandardErrors(429, 500)
  getLiveness() {
    return this.healthService.checkLiveness();
  }

  @Public()
  @Get('ready')
  @ApiOperation({ summary: 'Kiểm tra khả năng phục vụ traffic' })
  @ApiResponse({ status: 200, schema: successSchema(readinessDataSchema) })
  @ApiStandardErrors(429, 500, 503)
  getReadiness() {
    return this.healthService.checkReadiness();
  }
}
