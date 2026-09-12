import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeRoomAuthorizationService } from './realtime-room-authorization.service';

@Global()
@Module({
  providers: [RealtimeGateway, RealtimeRoomAuthorizationService],
  exports: [RealtimeGateway, RealtimeRoomAuthorizationService],
})
export class RealtimeModule {}
