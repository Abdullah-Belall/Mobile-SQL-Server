import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JwtPayload } from '../auth/auth.types';
import { DatabaseService, SqlBatchError } from '../database/database.service';

/** Raised by mission-1.sql when the last backup is not from today. */
const BACKUP_CHECK_FAILED = 50002;

@Injectable()
export class MissionsService {
  private readonly logger = new Logger(MissionsService.name);
  private readonly mission1Sql = readFileSync(
    join(__dirname, 'sql', 'mission-1.sql'),
    'utf8',
  ).replace(/^\uFEFF/, '');
  private running = false;

  constructor(private readonly db: DatabaseService) {}

  async executeMission1(user: JwtPayload) {
    if (this.running) {
      throw new ConflictException('Mission 1 is already running');
    }
    this.running = true;
    const startedAt = Date.now();
    this.logger.warn(`Mission 1 started by "${user.username}"`);

    try {
      const { messages } = await this.db.runBatch(this.mission1Sql);
      const durationMs = Date.now() - startedAt;
      this.logger.warn(`Mission 1 completed in ${durationMs} ms`);
      return { success: true, messages, durationMs };
    } catch (error) {
      if (!(error instanceof SqlBatchError)) throw error;

      if (error.number === BACKUP_CHECK_FAILED) {
        this.logger.warn(`Mission 1 refused: ${error.message}`);
        throw new ConflictException({
          statusCode: 409,
          error: 'BackupRequired',
          message: error.message,
          messages: error.messages,
        });
      }

      this.logger.error(
        `Mission 1 failed and was rolled back: ${error.message}`,
      );
      throw new InternalServerErrorException({
        statusCode: 500,
        error: 'MissionFailed',
        message: `Mission 1 failed; no changes were applied. ${error.message}`,
        messages: error.messages,
      });
    } finally {
      this.running = false;
    }
  }
}
