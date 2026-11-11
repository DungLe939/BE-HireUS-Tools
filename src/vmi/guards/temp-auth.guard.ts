import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface VmiAuthenticatedRequest extends Request {
  userId?: string;
}

@Injectable()
export class TempAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<VmiAuthenticatedRequest>();

    // TODO: Replace this temporary identity with the real authentication guard.
    let userId = 'vmi-mock-user';
    if (process.env.NODE_ENV === 'test') {
      const mockUserId = request.headers['x-mock-user-id'];
      if (typeof mockUserId === 'string' && mockUserId.trim()) {
        userId = mockUserId.trim();
      }
    }

    request.userId = userId;
    return true;
  }
}
