import { IsNumber, IsOptional, IsString } from 'class-validator';

export class WhatsappCreateEventDto {
  @IsOptional()
  @IsString()
  senderPhone?: string;

  @IsOptional()
  @IsString()
  senderLid?: string | null;

  @IsOptional()
  @IsString()
  senderJid?: string | null;

  @IsOptional()
  @IsString()
  senderName?: string | null;

  @IsOptional()
  @IsString()
  messageBody?: string;

  @IsOptional()
  @IsString()
  whatsappMessageId?: string;

  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  suggestedTime?: string | null;

  @IsOptional()
  @IsString()
  venue?: string | null;

  @IsOptional()
  @IsString()
  locationName?: string | null;

  @IsOptional()
  @IsString()
  address?: string | null;

  @IsOptional()
  @IsNumber()
  latitude?: number | null;

  @IsOptional()
  @IsNumber()
  longitude?: number | null;

  @IsOptional()
  @IsString()
  instructions?: string | null;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsString()
  skillLevel?: string | null;

  @IsOptional()
  @IsString()
  courtInfo?: string | null;

  @IsOptional()
  @IsNumber()
  durationMinutes?: number | null;

  @IsOptional()
  @IsString()
  timezone?: string | null;

  @IsOptional()
  @IsNumber()
  confidence?: number;
}

export class WhatsappRsvpDto {
  @IsOptional()
  @IsString()
  whatsappMessageId?: string;

  @IsOptional()
  @IsString()
  reactorPhone?: string;

  @IsOptional()
  @IsString()
  reactorLid?: string | null;

  @IsOptional()
  @IsString()
  reactorJid?: string | null;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsNumber()
  confidence?: number;
}
