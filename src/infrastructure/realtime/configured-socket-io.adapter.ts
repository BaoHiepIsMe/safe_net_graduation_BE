import { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';
import type { SafeNetCorsOptions } from '../../config/cors.config';

export function withValidatedSocketCors(
  options: Partial<ServerOptions> | undefined,
  cors: SafeNetCorsOptions,
): Partial<ServerOptions> {
  return {
    ...options,
    cors: {
      ...(options?.cors || {}),
      ...cors,
    },
  };
}

export class ConfiguredSocketIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly corsOptions: SafeNetCorsOptions,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions): unknown {
    return super.createIOServer(
      port,
      withValidatedSocketCors(options, this.corsOptions),
    );
  }
}
