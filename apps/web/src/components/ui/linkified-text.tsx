import * as React from 'react';

const URL_RE =
  /https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+/gi;

function splitUrl(raw: string): { href: string; display: string; trailing: string } {
  const trailingMatch = raw.match(/[.,;:!?)]+$/);
  const trailing = trailingMatch?.[0] ?? '';
  const core = trailing ? raw.slice(0, -trailing.length) : raw;
  const href = /^https?:\/\//i.test(core) ? core : `https://${core}`;
  return { href, display: core, trailing };
}

/** Render text with http(s)/www URLs as external links. */
export function LinkifiedText({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const nodes: React.ReactNode[] = [];
  let last = 0;
  const re = new RegExp(URL_RE.source, URL_RE.flags);
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const { href, display, trailing } = splitUrl(match[0]!);
    nodes.push(
      <a
        key={`link-${key++}`}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all font-semibold text-[var(--color-accent)] underline-offset-2 hover:underline"
      >
        {display}
      </a>,
    );
    if (trailing) nodes.push(trailing);
    last = match.index + match[0]!.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return (
    <p className={className} style={{ whiteSpace: 'pre-wrap' }}>
      {nodes}
    </p>
  );
}

/** Google Maps search URL from venue fields. */
export function googleMapsUrl(opts: {
  locationName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string | null {
  if (
    typeof opts.latitude === 'number' &&
    typeof opts.longitude === 'number' &&
    Number.isFinite(opts.latitude) &&
    Number.isFinite(opts.longitude)
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${opts.latitude}%2C${opts.longitude}`;
  }
  const query = [opts.locationName, opts.address].filter(Boolean).join(', ').trim();
  if (!query) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
