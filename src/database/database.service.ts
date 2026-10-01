import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectionPool, Request } from 'mssql';

export interface BatchResult<T = Record<string, unknown>> {
  recordsets: T[][];
  messages: string[];
}

/**
 * mssql rejects with the *last* server error (e.g. the generic "BACKUP DATABASE is terminating
 * abnormally") and keeps the useful ones in `precedingErrors`, so join them all.
 */
export function describeSqlError(error: unknown): string {
  const err = error as Error & { precedingErrors?: Error[] };
  return [...(err.precedingErrors ?? []), err]
    .map((e) => e?.message)
    .filter(Boolean)
    .join(' | ');
}

export class SqlBatchError extends Error {
  constructor(
    readonly sqlError: Error & { number?: number },
    readonly messages: string[],
  ) {
    super(describeSqlError(sqlError));
  }

  get number(): number | undefined {
    return this.sqlError.number;
  }
}

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private readonly pool: ConnectionPool;
  private connecting?: Promise<ConnectionPool>;

  readonly databaseName: string;

  constructor(config: ConfigService) {
    this.databaseName = config.getOrThrow<string>('DB_DATABASE');
    this.pool = new ConnectionPool({
      server: config.getOrThrow<string>('DB_HOST'),
      port: Number(config.get('DB_PORT', 1433)),
      user: config.getOrThrow<string>('DB_USERNAME'),
      password: config.getOrThrow<string>('DB_PASSWORD'),
      database: this.databaseName,
      connectionTimeout: 15_000,
      // Backups and the mission script run far longer than the 15s driver default.
      requestTimeout: Number(config.get('DB_REQUEST_TIMEOUT_MS', 30 * 60_000)),
      pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
      options: { encrypt: false, trustServerCertificate: true },
    });
    this.pool.on('error', (err: Error) =>
      this.logger.error(`Pool error: ${err.message}`),
    );
  }

  async onModuleInit() {
    try {
      await this.getPool();
      this.logger.log(`Connected to database ${this.databaseName}`);
    } catch {
      this.logger.warn(
        'Database is not reachable yet; will retry on the first request',
      );
    }
  }

  async onModuleDestroy() {
    await this.pool.close();
  }

  async request(): Promise<Request> {
    const pool = await this.getPool();
    return pool.request();
  }

  /**
   * Runs a raw T-SQL batch and collects PRINT / informational messages.
   * On failure the messages printed before the error are kept on the thrown SqlBatchError.
   */
  async runBatch<T = Record<string, unknown>>(
    batch: string,
  ): Promise<BatchResult<T>> {
    const request = await this.request();
    const messages: string[] = [];
    request.on('info', (info: { message: string }) =>
      messages.push(info.message),
    );

    try {
      const result = await request.batch<T>(batch);
      const recordsets = (result.recordsets ?? []) as unknown as T[][];
      return { recordsets, messages };
    } catch (error) {
      throw new SqlBatchError(error as Error, messages);
    }
  }

  private async getPool(): Promise<ConnectionPool> {
    if (this.pool.connected) return this.pool;

    this.connecting ??= this.pool.connect().finally(() => {
      this.connecting = undefined;
    });

    try {
      return await this.connecting;
    } catch (error) {
      this.logger.error(
        `Database connection failed: ${(error as Error).message}`,
      );
      throw new ServiceUnavailableException('Database is not reachable');
    }
  }
}
