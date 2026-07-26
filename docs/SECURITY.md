# Security Checklist

## OWASP Top 10 mapping

| Risk | Mitigation |
| --- | --- |
| A01 Broken access control | Global `JwtAuthGuard` (deny-by-default; `@Public()` is explicit), `RolesGuard` for platform RBAC, `GroupPermissionsService` for community roles with outranking rules, hidden groups return 404 to non-members, resource ownership checked in every mutation |
| A02 Cryptographic failures | argon2id password hashing; refresh/email tokens are 48-byte random values stored **only as SHA-256 digests**; JWTs signed with dedicated secrets; `Secure`/`HttpOnly`/`SameSite=Lax` cookies in production |
| A03 Injection | Prisma parameterized queries everywhere; the few raw FTS queries use bound parameters (`$1…`) with numeric-only interpolation helpers; class-validator `whitelist + forbidNonWhitelisted` strips unknown fields |
| A04 Insecure design | Refresh-token rotation with family-wide revocation on reuse; serializable transactions for capacity; single-use, expiring email tokens; account enumeration prevented (uniform login error + timing-equalized dummy hash verify, forgot-password always 200) |
| A05 Security misconfiguration | Helmet headers; CORS restricted to configured origins with credentials; Swagger disabled in production; `X-Frame-Options: DENY`, `nosniff`, strict `Referrer-Policy` on the web app; non-root Docker user |
| A06 Vulnerable components | Minimal dependency surface, lockfiles committed, CI builds on every PR |
| A07 Auth failures | Rate limits on auth endpoints (login/signup 10/min, reset 5/min, resend 3/min); suspended/deleted accounts rejected at login **and** refresh; password change/reset revokes all sessions |
| A08 Integrity failures | Audit log (actor, action, target, IP) for security-sensitive operations; soft deletes preserve evidence |
| A09 Logging failures | Request logging interceptor, audit trail, health endpoint; errors normalized without stack leaks |
| A10 SSRF | No user-supplied URL fetching server-side; OAuth verification goes to pinned Google/Apple JWKS endpoints only |

## CSRF

Web sessions use httpOnly cookies, so state-changing requests require the double-submit token: `gatherly_csrf` cookie (readable, random per login) must match the `X-CSRF-Token` header, compared with `timingSafeEqual`. Bearer-token requests (mobile) are exempt — they cannot be forged cross-origin.

## Uploads

- Extension **and** magic-byte sniffing (JPEG/PNG/WebP/GIF signatures) — a renamed executable is rejected.
- 5 MB cap, random UUID filenames (no path traversal, no user-controlled names), served from a static prefix with immutable caching, `crossOriginResourcePolicy` configured.

## Rate limiting

Global 120 req/min per IP via `@nestjs/throttler`, with stricter per-route budgets on the auth surface (see API docs).

## Secrets

No secrets in the repository — `.env.example` templates only. Production secrets are injected as Railway variables; JWT secrets must be ≥32 chars and differ between access/refresh.

## Residual risks / future hardening

- Uploaded images are stored on a volume; move to object storage + CDN with signed URLs for scale.
- Add per-account (not just per-IP) login throttling and optional TOTP 2FA.
- Add CSP with nonces (currently the strict default headers, no inline-script allowance needed by the app shell).
