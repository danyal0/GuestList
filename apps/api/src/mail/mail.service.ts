import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

interface MailOptions {
  to: string;
  subject: string;
  heading: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/**
 * Transactional email channel. Uses SMTP when configured; falls back to a
 * JSON transport that logs messages in development so flows remain testable
 * without external infrastructure.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('mail.host');
    this.from = this.config.get<string>('mail.from') ?? 'MKE Plays <no-reply@mkeplays.app>';

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: this.config.get<number>('mail.port'),
        secure: this.config.get<number>('mail.port') === 465,
        auth: this.config.get<string>('mail.user')
          ? {
              user: this.config.get<string>('mail.user'),
              pass: this.config.get<string>('mail.pass'),
            }
          : undefined,
      });
    } else {
      this.transporter = nodemailer.createTransport({ jsonTransport: true });
    }
  }

  async send(options: MailOptions): Promise<void> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        subject: options.subject,
        text: this.renderText(options),
        html: this.renderHtml(options),
      });
      if ((info as { message?: string }).message) {
        this.logger.log(`[dev mail] ${options.subject} → ${options.to}`);
        if (options.ctaUrl) this.logger.log(`[dev mail] link: ${options.ctaUrl}`);
      }
    } catch (err) {
      // Email failures must never break the user-facing flow.
      this.logger.error(`Failed to send email "${options.subject}" to ${options.to}`, err as Error);
    }
  }

  private renderText(o: MailOptions): string {
    return `${o.heading}\n\n${o.body}${o.ctaUrl ? `\n\n${o.ctaLabel ?? 'Open'}: ${o.ctaUrl}` : ''}`;
  }

  private renderHtml(o: MailOptions): string {
    const webUrl = this.config.get<string>('webUrl') ?? 'https://mkeplays.com';
    const logoUrl = `${webUrl.replace(/\/$/, '')}/brand/logo.png`;
    const cta = o.ctaUrl
      ? `<a href="${o.ctaUrl}" style="display:inline-block;margin-top:24px;padding:12px 28px;background:#0a84ff;color:#fff;border-radius:12px;text-decoration:none;font-weight:600">${o.ctaLabel ?? 'Open'}</a>`
      : '';
    return `<!doctype html><html><body style="margin:0;padding:32px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
      <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:20px;padding:40px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <div style="text-align:center;margin:0 0 20px">
          <img src="${logoUrl}" alt="MKE Plays" width="64" height="64" style="border-radius:14px;display:inline-block" />
        </div>
        <p style="font-size:14px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0a84ff;margin:0 0 16px;text-align:center">MKE Plays</p>
        <h1 style="font-size:24px;font-weight:700;color:#1d1d1f;margin:0 0 12px">${o.heading}</h1>
        <p style="font-size:16px;line-height:1.6;color:#515154;margin:0">${o.body}</p>
        ${cta}
      </div>
      <p style="text-align:center;font-size:12px;color:#86868b;margin-top:24px">© ${new Date().getFullYear()} MKE Plays</p>
    </body></html>`;
  }
}
