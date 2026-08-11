/**
 * Optional live LLM self-check: "Does this meetup make sense? Are you confident?"
 * Falls back to null when XAI_API_KEY is unset or the call fails (local assessor still runs).
 */

import { formatStartForSenseCheck } from './whatsapp-time';

export type AiSenseCheckResult = {
  makesSense: boolean;
  confidence: number;
  reason: string;
};

function clip(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Ask xAI whether the proposed create/reschedule should be saved.
 * Returns null when disabled or unavailable.
 */
export async function askAiEventSenseCheck(input: {
  mode: 'create' | 'reschedule';
  messageBody: string;
  title: string;
  venueName: string | null;
  venueSlug: string | null;
  startTime: Date;
  timezone: string;
  changes?: { timeChanged: boolean; venueChanged: boolean } | null;
}): Promise<AiSenseCheckResult | null> {
  const enabled =
    (process.env.WHATSAPP_AI_SENSE_CHECK || '1').toLowerCase() !== '0' &&
    (process.env.WHATSAPP_AI_SENSE_CHECK || '1').toLowerCase() !== 'false';
  const apiKey = (process.env.XAI_API_KEY || '').trim();
  if (!enabled || !apiKey) return null;

  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model =
    process.env.XAI_SENSE_MODEL ||
    process.env.XAI_MODEL ||
    'grok-4-1-fast-non-reasoning-latest';

  const local = formatStartForSenseCheck(input.startTime, input.timezone);

  const system = `You are a final reviewer for MKE Plays WhatsApp sports meetups in Milwaukee (default sport: tennis).
Ask yourself: does this proposed event make sense? Are you confident it should be saved?
Use startTimeLocal / localHour (venue timezone) — NEVER judge lateness from UTC/Z timestamps.
Evening tennis around localHour 17–19 is normal and should be accepted.
Reject nonsense, incomplete plans, incompatible sport/venue (e.g. swimming at tennis courts), absurd LOCAL times (e.g. localHour 2 or ≥22), or vague places.
Accept clear tennis/pickleball meetups at known courts with a sensible local time. Maps links / street addresses in a tennis group still mean tennis.
Return ONLY JSON: {"makesSense":true,"confidence":0.0,"reason":"short"}`;

  const user = JSON.stringify({
    mode: input.mode,
    messageBody: input.messageBody,
    title: input.title,
    venueName: input.venueName,
    venueSlug: input.venueSlug,
    timezone: input.timezone,
    startTimeLocal: local.startTimeLocal,
    localHour: local.localHour,
    localMinute: local.localMinute,
    // UTC only for reference — do not use the hour for "too late" judgments.
    startTimeUtc: local.startTimeUtc,
    changes: input.changes ?? null,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const parsed = JSON.parse(raw) as {
      makesSense?: boolean;
      confidence?: number;
      reason?: string;
    };
    const confidence = clip(Number(parsed.confidence ?? 0));
    let makesSense = Boolean(parsed.makesSense) && confidence >= 0.5;
    let reason = String(
      parsed.reason || (makesSense ? 'AI approved' : 'AI rejected'),
    ).slice(0, 240);

    // Safety net: models sometimes still misread UTC 23:00Z (6pm Chicago) as "too late".
    if (
      !makesSense &&
      local.localHour >= 7 &&
      local.localHour < 22 &&
      /\b(23:00|22:00|too late|absurd).*(tennis|time|start)?|\b(utc|zulu)\b/i.test(
        reason,
      )
    ) {
      makesSense = true;
      reason = `Ignored UTC-confused lateness check; localHour=${local.localHour} is fine (${reason})`;
    }

    return {
      makesSense,
      confidence: makesSense ? Math.max(confidence, 0.7) : Math.min(confidence, 0.49),
      reason,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
