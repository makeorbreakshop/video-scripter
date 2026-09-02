// YouTube serves a vertical thumbnail variant (oardefault.jpg) only for Shorts; regular videos 404.
// Zero API quota, and it survives the 3-minute Shorts duration change. One HEAD per video.
export function isShortFromStatus(status: number): boolean { return status === 200; }
export async function isShortByCdn(videoId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/oardefault.jpg`, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    if (res.status === 200 || res.status === 404) return isShortFromStatus(res.status);
    return null; // rate limited or odd status: unknown
  } catch { return null; }
}
