import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SuggestQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(200)
  q!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  groupId?: string;
}

export class SuggestKindQueryDto extends SuggestQueryDto {
  @IsOptional()
  @IsIn(['events', 'groups'])
  kind?: 'events' | 'groups';
}
