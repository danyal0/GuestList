/**
 * Optional live LLM self-check: "Does this meetup make sense? Are you confident?"
 * Falls back to null when XAI_API_KEY is unset or the call fails (local assessor still runs).
 */

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
  startTimeIso: string;
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

  const system = `You are a final reviewer for MKE Plays WhatsApp sports meetups in Milwaukee.
Ask yourself: does this proposed event make sense? Are you confident it should be saved?
Reject nonsense, incomplete plans, incompatible sport/venue (e.g. swimming at tennis courts), absurd times, or vague places.
Accept clear tennis/pickleball/etc. meetups at known courts with a sensible time.
Return ONLY JSON: {"makesSense":true,"confidence":0.0,"reason":"short"}`;

  const user = JSON.stringify({
    mode: input.mode,
    messageBody: input.messageBody,
    title: input.title,
    venueName: input.venueName,
    venueSlug: input.venueSlug,
    startTime: input.startTimeIso,
    timezone: input.timezone,
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
    const makesSense = Boolean(parsed.makesSense) && confidence >= 0.5;
    return {
      makesSense,
      confidence: makesSense ? confidence : Math.min(confidence, 0.49),
      reason: String(parsed.reason || (makesSense ? 'AI approved' : 'AI rejected')).slice(
        0,
        240,
      ),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
