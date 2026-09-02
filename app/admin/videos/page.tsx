import { redirect } from 'next/navigation';

// Header search box posts here; extract a video id from a raw id or a YouTube URL.
export default async function VideoSearch({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const raw = (id ?? '').trim();
  const m = raw.match(/(?:v=|youtu\.be\/|shorts\/|^)([\w-]{11})(?:[?&#]|$)/);
  if (m) redirect(`/admin/videos/${m[1]}`);
  redirect('/admin');
}
