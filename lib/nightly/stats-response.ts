interface Options {
  fetchResponse: () => Promise<Response>;
  maxAttempts: number;
  onAttempt: () => void;
  signal?: AbortSignal;
  wait?: (ms: number) => Promise<void>;
}

/** Headers and body share a retry boundary. A failed body leaves the video due next tick. */
export async function readStatsResponse(options: Options): Promise<{ response: Response; data: any } | null> {
  const wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < options.maxAttempts && !options.signal?.aborted; attempt++) {
    options.onAttempt();
    try {
      const response = await options.fetchResponse();
      return { response, data: response.ok ? await response.json() : null };
    } catch {
      if (attempt + 1 < options.maxAttempts && !options.signal?.aborted) await wait(2000 * (attempt + 1));
    }
  }
  return null;
}
