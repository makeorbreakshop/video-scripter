// Decides where an archived thumbnail version should be served from.
// The watcher archives image bytes to data/thumbnails/ on the machine that runs it (Brandon's Mac),
// so hosts without that folder (Vercel) fall back: the latest version is byte-identical to what the
// YouTube CDN serves right now, older versions are simply not available on that host.
export type ThumbSource =
  | { kind: 'file'; path: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'missing' };

export function ytCdnUrl(videoId: string) {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function archivePath(videoId: string, version: number) {
  return `data/thumbnails/${videoId}_v${version}.jpg`;
}

export function resolveThumbSource(args: {
  videoId: string;
  version: number;
  latestVersion: number | null;
  fileExists: boolean;
}): ThumbSource {
  if (args.fileExists) return { kind: 'file', path: archivePath(args.videoId, args.version) };
  if (args.latestVersion == null || args.version >= args.latestVersion) return { kind: 'redirect', url: ytCdnUrl(args.videoId) };
  return { kind: 'missing' };
}
