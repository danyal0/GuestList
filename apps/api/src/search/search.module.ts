import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SEARCH_PROVIDER } from './search-provider.interface';
import { PostgresSearchProvider } from './postgres-search.provider';
import { FileSearchProvider } from './file-search.provider';
import { useFileDataSource } from '../prisma/data-source';

/**
 * Search is consumed through the SEARCH_PROVIDER token. File mode uses a
 * simple in-process provider; Postgres mode uses FTS.
 */
@Module({
  controllers: [SearchController],
  providers: [
    {
      provide: SEARCH_PROVIDER,
      useClass: useFileDataSource() ? FileSearchProvider : PostgresSearchProvider,
    },
  ],
  exports: [SEARCH_PROVIDER],
})
export class SearchModule {}
