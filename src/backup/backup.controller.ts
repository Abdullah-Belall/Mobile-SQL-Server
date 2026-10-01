import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, SupervisorGuard } from '../auth/auth.guard';
import type { JwtPayload } from '../auth/auth.types';
import { BackupService } from './backup.service';

@Controller()
@UseGuards(AuthGuard, SupervisorGuard)
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Post('backup')
  @HttpCode(HttpStatus.OK)
  backup(@CurrentUser() user: JwtPayload) {
    return this.backupService.backup(user);
  }
}
