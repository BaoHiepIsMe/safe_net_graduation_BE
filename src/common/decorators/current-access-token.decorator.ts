import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentAccessToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest<{ authToken?: string }>();
    return request.authToken;
  },
);
