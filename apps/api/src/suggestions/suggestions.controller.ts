import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SuggestQueryDto } from './dto/suggestions.dto';
import { SuggestionsService } from './suggestions.service';

@ApiTags('suggestions')
@Controller('suggestions')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  /** Autofill suggestions while composing a new event. */
  @Get('events')
  suggestEvents(@Query() dto: SuggestQueryDto) {
    return this.suggestions.suggestEvents(dto.q, dto.groupId);
  }

  /** Autofill suggestions while creating a community. */
  @Get('groups')
  suggestGroups(@Query() dto: SuggestQueryDto) {
    return this.suggestions.suggestGroups(dto.q);
  }
}
