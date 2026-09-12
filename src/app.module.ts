import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import configuration from './config/configuration';
import { validateEnv } from './config/env.validation';

import { SupabaseModule } from './infrastructure/supabase/supabase.module';
import { FirebaseModule } from './infrastructure/firebase/firebase.module';
import { RealtimeModule } from './infrastructure/realtime/realtime.module';
import { DatabaseModule } from './infrastructure/database/database.module';

import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { SupabaseAuthGuard } from './common/guards/supabase-auth.guard';

import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProfilesModule } from './modules/profiles/profiles.module';
import { FamiliesModule } from './modules/families/families.module';
import { DevicesModule } from './modules/devices/devices.module';
import { LocationsModule } from './modules/locations/locations.module';
import { GeofencesModule } from './modules/geofences/geofences.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SosModule } from './modules/sos/sos.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { CamerasModule } from './modules/cameras/cameras.module';
import { PhoneManagementModule } from './modules/phone-management/phone-management.module';
import { ChatModule } from './modules/chat/chat.module';
import { CallsModule } from './modules/calls/calls.module';
import { DailyStatusModule } from './modules/daily-status/daily-status.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => [
        {
          ttl: configService.get<number>('throttle.ttl') ?? 60000,
          limit: configService.get<number>('throttle.limit') ?? 100,
        },
      ],
    }),
    SupabaseModule,
    DatabaseModule,
    FirebaseModule,
    RealtimeModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    FamiliesModule,
    DevicesModule,
    LocationsModule,
    GeofencesModule,
    NotificationsModule,
    SosModule,
    RemindersModule,
    CamerasModule,
    PhoneManagementModule,
    ChatModule,
    CallsModule,
    DailyStatusModule,
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseTransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: SupabaseAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
