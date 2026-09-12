import { Module } from '@nestjs/common';
import { CamerasController } from './cameras.controller';
import { CamerasRepository } from './cameras.repository';
import { CamerasService } from './cameras.service';

@Module({
  controllers: [CamerasController],
  providers: [CamerasRepository, CamerasService],
  exports: [CamerasRepository, CamerasService],
})
export class CamerasModule {}
