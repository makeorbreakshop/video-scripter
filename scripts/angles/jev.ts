// Minimal Jev (typesafe.ai systemone) client. `state` is text only; every question is answered
// independently, so one request carries the whole angle library against one video.
//
// There are no rate-limit headers on this API, so the only backpressure signal is a 429/529 —
// hence a fixed concurrency ceiling plus exponential backoff rather than a token bucket.

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export type NoulQuestion = {
  type: 'noul';
  instructions: string;
  criteria: { true: string; false: string };
};
export type ScoreQuestion = {
  type: 'score';
  instructions: string;
  /** Ordered levels, low to high. The API answers on 0..n-1 and echoes them back as `legend`. */
  criteria: string[];
};
export type Question = NoulQuestion | ScoreQuestion;

export interface JevAnswer {
  type: string;
  noul?: number;
  score?: number;
  choice?: string;
  confidence?: number;
  legend?: Record<string, string>;
  probabilities?: Record<string, number>;
}

export interface JevResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

export class JevError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`jev HTTP ${status}: ${body.slice(0, 300)}`);
  }
}

/** 429 and 529 are the only retryable answers this API gives; 5xx is retried as a courtesy. */
export function retryable(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

/** Full jitter, capped — a thundering herd of 12 workers must not retry in lockstep. */
export function backoffMs(attempt: number, random = Math.random): number {
  const ceiling = Math.min(30_000, 500 * 2 ** attempt);
  return Math.round(random() * ceiling);
}

export async function askJev(
  state: string,
  questions: Record<string, Question>,
  options: { apiKey?: string; attempts?: number; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<JevResponse> {
  const apiKey = options.apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw new Error('TYPESAFE_API_KEY is not set');
  const attempts = options.attempts ?? 6;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    try {
      const response = await fetch(JEV_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state, questions }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
      });
      if (response.ok) return await response.json() as JevResponse;
      const body = await response.text();
      last = new JevError(response.status, body);
      if (!retryable(response.status)) throw last;
    } catch (e) {
      if (e instanceof JevError && !retryable(e.status)) throw e;
      last = e;
    }
  }
  throw last;
}
