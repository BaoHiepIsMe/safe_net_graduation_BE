import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { SosController } from './sos.controller';
import { SosRepository } from './sos.repository';
import { SosService } from './sos.service';

@Module({
  imports: [NotificationsModule],
  controllers: [SosController],
  providers: [SosRepository, SosService],
  exports: [SosService, SosRepository],
})
export class SosModule {}
