import { GroupCategory, GroupMemberRole, GroupPrivacy } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsIn,
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateGroupDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(80)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @IsEnum(GroupCategory)
  category!: GroupCategory;

  @IsOptional()
  @IsEnum(GroupPrivacy)
  privacy?: GroupPrivacy;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  rules?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  coverImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsEnum(GroupCategory)
  category?: GroupCategory;

  @IsOptional()
  @IsEnum(GroupPrivacy)
  privacy?: GroupPrivacy;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  rules?: string;

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  coverImage?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  location?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

export class ListGroupsDto extends PaginationDto {
  @IsOptional()
  @IsEnum(GroupCategory)
  category?: GroupCategory;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLatitude()
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsLongitude()
  lng?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20000)
  radiusKm?: number;

  @IsOptional()
  @IsIn(['popular', 'newest', 'nearby'])
  sort?: 'popular' | 'newest' | 'nearby';
}

export class UpdateMemberRoleDto {
  @IsEnum(GroupMemberRole)
  role!: GroupMemberRole;
}

export class TransferOwnershipDto {
  @IsString()
  @IsNotEmpty()
  newOwnerId!: string;
}
