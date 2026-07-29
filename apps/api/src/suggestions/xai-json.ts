/**
 * Optional xAI chat helper for form autofill when local data is sparse.
 */

export async function askXaiJson<T extends Record<string, unknown>>(input: {
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<T | null> {
  const apiKey = (process.env.XAI_API_KEY || '').trim();
  if (!apiKey) return null;

  const apiUrl = process.env.XAI_API_URL || 'https://api.x.ai/v1/chat/completions';
  const model = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning-latest';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 6000);

  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = data.choices?.[0]?.message?.content ?? '';
    return JSON.parse(raw) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
