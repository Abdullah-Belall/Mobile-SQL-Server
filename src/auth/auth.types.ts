import type { Request } from 'express';

export interface JwtPayload {
  sub: number;
  username: string;
  name: string | null;
  isSupervisor: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}
