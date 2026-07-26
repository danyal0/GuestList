import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SEARCH_PROVIDER } from './search-provider.interface';
import { PostgresSearchProvider } from './postgres-search.provider';

/**
 * Search is consumed through the SEARCH_PROVIDER token. Swapping Postgres FTS
 * for ElasticSearch/OpenSearch later means adding a new provider class and
 * changing this binding — no call sites change.
 */
@Module({
  controllers: [SearchController],
  providers: [{ provide: SEARCH_PROVIDER, useClass: PostgresSearchProvider }],
  exports: [SEARCH_PROVIDER],
})
export class SearchModule {}
