import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NVarChar } from 'mssql';
import { win32 } from 'node:path';
import type { JwtPayload } from '../auth/auth.types';
import {
  DatabaseService,
  describeSqlError,
} from '../database/database.service';

function timestamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `_${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private running = false;
  private defaultBackupDir?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
  ) {}

  async backup(user: JwtPayload) {
    if (this.running) {
      throw new ConflictException('A backup is already in progress');
    }
    this.running = true;
    const startedAt = Date.now();

    try {
      const dir = await this.resolveBackupDir();
      const database = this.db.databaseName;
      // Path is resolved by SQL Server on its own machine, hence win32.
      const filePath = win32.join(dir, `${database}_${timestamp()}.bak`);
      this.logger.log(`Backup started by "${user.username}" -> ${filePath}`);

      // Separate requests on purpose: inside one batch a failed BACKUP does not stop the
      // following statements, and Last_Bak_Date must only move after a verified backup.
      const backup = await this.db.request();
      await backup
        .input('db', NVarChar(128), database)
        .input('path', NVarChar(4000), filePath)
        .input('name', NVarChar(128), `${database}-Full Database Backup`)
        .query(
          'BACKUP DATABASE @db TO DISK = @path WITH INIT, CHECKSUM, NAME = @name',
        );

      const verify = await this.db.request();
      await verify
        .input('path', NVarChar(4000), filePath)
        .query('RESTORE VERIFYONLY FROM DISK = @path WITH CHECKSUM');

      // Same text format the desktop system writes; mission-1.sql parses it with style 103.
      const stamp = await this.db.request();
      const { recordset } = await stamp
        .input('path', NVarChar(4000), filePath)
        .query<{ lastBackupDate: string; sizeBytes: number | null }>(
          `UPDATE JS_Config SET Last_Bak_Date = FORMAT(GETDATE(), 'dd/MM/yyyy hh:mm:ss tt', 'en-US');
           SELECT
             (SELECT TOP 1 Last_Bak_Date FROM JS_Config) AS lastBackupDate,
             (SELECT TOP 1 b.backup_size
                FROM msdb.dbo.backupset b
                JOIN msdb.dbo.backupmediafamily m ON m.media_set_id = b.media_set_id
               WHERE m.physical_device_name = @path
               ORDER BY b.backup_finish_date DESC) AS sizeBytes;`,
        );

      const durationMs = Date.now() - startedAt;
      this.logger.log(`Backup finished in ${durationMs} ms -> ${filePath}`);

      return {
        success: true,
        database,
        filePath,
        sizeBytes: recordset[0]?.sizeBytes ?? null,
        verified: true,
        lastBackupDate: recordset[0]?.lastBackupDate ?? null,
        durationMs,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const message = describeSqlError(error);
      this.logger.error(`Backup failed: ${message}`);
      throw new InternalServerErrorException(`Backup failed: ${message}`);
    } finally {
      this.running = false;
    }
  }

  private async resolveBackupDir(): Promise<string> {
    const configured = this.config.get<string>('BACKUP_DIR')?.trim();
    if (configured) {
      const mkdir = await this.db.request();
      await mkdir
        .input('dir', NVarChar(4000), configured)
        .query('EXEC master.dbo.xp_create_subdir @dir');
      return configured;
    }

    if (!this.defaultBackupDir) {
      const regread = await this.db.request();
      const { output } = await regread.output('dir', NVarChar(4000)).query(
        `EXEC master.dbo.xp_instance_regread
             N'HKEY_LOCAL_MACHINE',
             N'Software\\Microsoft\\MSSQLServer\\MSSQLServer',
             N'BackupDirectory',
             @dir OUTPUT`,
      );
      const dir = (output as { dir?: string | null }).dir;
      if (!dir) {
        throw new InternalServerErrorException(
          'Could not determine the SQL Server backup directory; set BACKUP_DIR in .env',
        );
      }
      this.defaultBackupDir = dir;
    }
    return this.defaultBackupDir;
  }
}
