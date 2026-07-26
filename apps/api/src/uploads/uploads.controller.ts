import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../common/types/auth-user';
import { AuditService } from '../audit/audit.service';

const UPLOAD_DIR = join(process.cwd(), 'uploads');

/**
 * Secure image uploads:
 * - authenticated users only
 * - content sniffed via magic bytes (never trust client mimetype)
 * - random server-generated filenames (no path traversal, no collisions)
 * - size capped by config
 * Files land in ./uploads which is served statically; in production this
 * directory is a mounted volume, and the returned URLs are CDN-ready
 * (relative paths that can be fronted by any CDN).
 */
@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {
    mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  @Post('image')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async uploadImage(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) throw new BadRequestException('No file provided');

    const maxBytes = this.config.get<number>('uploads.maxBytes') ?? 5 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException(`File exceeds the ${Math.round(maxBytes / 1024 / 1024)}MB limit`);
    }

    const ext = this.sniffImageType(file.buffer);
    if (!ext) {
      throw new BadRequestException('Only JPEG, PNG, WebP and GIF images are allowed');
    }

    const filename = `${randomBytes(16).toString('hex')}.${ext}`;
    await writeFile(join(UPLOAD_DIR, filename), file.buffer);

    await this.auditService.log({
      actorId: user.id,
      action: 'upload.image',
      metadata: { filename, bytes: file.size },
    });

    const apiUrl = this.config.get<string>('apiUrl') ?? '';
    return { url: `${apiUrl}/uploads/${filename}` };
  }

  /** Magic-byte detection for the allowed image formats. */
  private sniffImageType(buffer: Buffer): 'jpg' | 'png' | 'webp' | 'gif' | null {
    if (buffer.length < 12) return null;
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'gif';
    return null;
  }
}
