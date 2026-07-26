import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { useFileDataSource } from './data-source';
import { createFilePrismaClient } from './file-prisma';

/**
 * When DATA_SOURCE=file (default without DATABASE_URL), this service is backed
 * by apps/api/data/mock-db.json instead of Postgres.
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
      const fileClient = createFilePrismaClient();
      Object.assign(this, fileClient);
      this.logger.log('Using file data source (apps/api/data/mock-db.json)');
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
