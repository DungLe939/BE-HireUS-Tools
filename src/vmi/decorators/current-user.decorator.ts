import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { VmiAuthenticatedRequest } from '../guards/temp-auth.guard';

// Use with TempAuthGuard to obtain the identity assigned to this request.
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string | undefined =>
    context.switchToHttp().getRequest<VmiAuthenticatedRequest>().userId,
);
