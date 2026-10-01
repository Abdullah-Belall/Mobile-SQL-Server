import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, SupervisorGuard } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { MissionsService } from './missions.service';

@Controller()
@UseGuards(AuthGuard, SupervisorGuard)
export class MissionsController {
  constructor(private readonly missionsService: MissionsService) {}

  @Post('execute-mission-1')
  @HttpCode(HttpStatus.OK)
  executeMission1(@CurrentUser() user: JwtPayload) {
    return this.missionsService.executeMission1(user);
  }
}
