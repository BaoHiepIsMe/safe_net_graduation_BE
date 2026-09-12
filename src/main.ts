import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { json, urlencoded } from 'express';

import { AppModule } from './app.module';
import { createCorsOptions } from './config/cors.config';
import { ConfiguredSocketIoAdapter } from './infrastructure/realtime/configured-socket-io.adapter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port') || 3000;
  const apiPrefix = configService.get<string>('apiPrefix') || 'api/v1';
  const corsOptions = createCorsOptions(
    configService.get<string[]>('corsOrigins'),
  );
  const maxBodySize = configService.get<string>('maxBodySize') || '1mb';

  // Ensure Prisma and scheduler lifecycle hooks run on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  // Body parser limits
  app.use(json({ limit: maxBodySize }));
  app.use(urlencoded({ limit: maxBodySize, extended: true }));

  // CORS
  app.enableCors({
    ...corsOptions,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  app.useWebSocketAdapter(new ConfiguredSocketIoAdapter(app, corsOptions));

  // Global prefix
  app.setGlobalPrefix(apiPrefix);

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('SafeNet Backend API')
    .setDescription(
      'Hệ thống Backend API cho ứng dụng SafeNet - Bảo vệ và kết nối an toàn cho gia đình.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Nhập Supabase Access Token',
        in: 'header',
      },
      'JWT-auth',
    )
    .addTag('Health', 'Kiểm tra trạng thái hệ thống')
    .addTag('Auth & Profiles', 'Xác thực người dùng và quản lý hồ sơ')
    .addTag('Families', 'Quản lý gia đình và lời mời')
    .addTag('Family Members', 'Thành viên và phân quyền theo gia đình')
    .addTag('Devices', 'Thiết bị ứng dụng thuộc tài khoản đã xác thực')
    .addTag('Locations', 'Vị trí hiện tại, lịch sử và Family Map')
    .addTag(
      'Phone Management',
      'Persisted child-device policy, telemetry, commands, and Device ACK state',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port);
  logger.log(
    `SafeNet backend server is running on: http://localhost:${port}/${apiPrefix}`,
  );
  logger.log(
    `Swagger documentation available at: http://localhost:${port}/api/docs`,
  );
}

void bootstrap();
