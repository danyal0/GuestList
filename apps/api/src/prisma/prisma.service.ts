import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { useFileDataSource } from './data-source';
import { createFilePrismaClient } from './file-prisma';

/**
 * When DATA_SOURCE=file (default without DATABASE_URL), this service is backed
 * by apps/api/data/mock-db.json instead of Postgres.
 *
 * File mode returns a Proxy so PrismaClient prototype getters cannot shadow
 * the file-backed model delegates (findUniqueOrThrow, etc.).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly fileMode: boolean;

  constructor() {
    const fileMode = useFileDataSource();
    // PrismaClient reads DATABASE_URL at construct time; provide a harmless
    // placeholder in file mode so boot works without Postgres.
    if (fileMode && !process.env.DATABASE_URL) {
      process.env.DATABASE_URL = 'postgresql://mock:mock@127.0.0.1:5432/mock';
    }

    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });

    this.fileMode = fileMode;

    if (this.fileMode) {
      const fileClient = createFilePrismaClient() as Record<string, unknown>;
      this.logger.log('Using file data source (apps/api/data/mock-db.json)');

      // Prefer defineProperty so own props beat any prototype accessors.
      for (const [key, value] of Object.entries(fileClient)) {
        Object.defineProperty(this, key, {
          value,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }

      // Proxy as a belt-and-suspenders: always resolve model APIs from fileClient.
      // eslint-disable-next-line no-constructor-return -- intentional for file-mode override
      return new Proxy(this, {
        get(target, prop, receiver) {
          if (typeof prop === 'string' && Object.prototype.hasOwnProperty.call(fileClient, prop)) {
            const value = fileClient[prop];
            return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(fileClient) : value;
          }
          if (prop === 'isFileMode') {
            return () => true;
          }
          return Reflect.get(target, prop, receiver);
        },
      });
    }
  }

  async onModuleInit(): Promise<void> {
    if (this.fileMode) return;
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.fileMode) return;
    await this.$disconnect();
  }

  isFileMode(): boolean {
    return this.fileMode;
  }
}
