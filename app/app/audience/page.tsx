import { notFound } from 'next/navigation';
import { q } from '@/lib/admin/db';
import { latestProfile, profileEvidence, type StatedAudience } from '@/lib/app/audience/profile';
import { isPresentationFeedback, ownerBuckets, type ContentBucket, type EvidenceLine, type ThemeEvidence, type WinningVideo } from '@/lib/app/audience/profile-core';
import { requestOwnerChannel } from '@/lib/app/audience/access';
import { OBSERVATION_TYPES } from '@/lib/app/audience/extraction-core';
import { AudienceControls } from './controls';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

interface Sections {
  summary: EvidenceLine | null;
  demographics: { field: string; value: string | null; source: string }[];
  devices: { key: string; views: number }[];
  traffic_sources: { key: string; views: number }[];
  subscribed_status: { key: string; views: number }[];
  window_end: string | null;
  core_beliefs: EvidenceLine[];
  emotional_drivers: EvidenceLine[];
  specific_interests: EvidenceLine[];
  content_buckets: ContentBucket[];
  transformation: { before: EvidenceLine | null; after: EvidenceLine | null };
}

function linkedEvidence(line: EvidenceLine, themes: Map<number, ThemeEvidence>) {
  const quotes = (line.theme_ids ?? []).flatMap((id) => themes.get(id)?.quotes.slice(0, 1) ?? []).slice(0, 5);
  if (!quotes.length) return null;
  return <details className={styles.evidence}><summary>Sources</summary><ul>
    {quotes.map((quote, i) => <li key={`${quote.comment_id}-${i}`}>
      <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(quote.video_id)}&lc=${encodeURIComponent(quote.comment_id)}`} target="_blank" rel="noreferrer">“{quote.quote}” ↗</a>
    </li>)}
  </ul></details>;
}

function Lines({ title, lines, stated, themes }: { title: string; lines: EvidenceLine[]; stated?: string; themes: Map<number, ThemeEvidence> }) {
  const shown = stated?.trim() ? stated.split('\n').map((text) => text.trim()).filter(Boolean)
    .map((text): EvidenceLine => ({ text, source: 'stated' })) : lines;
  if (!shown.length) return null;
  return <section className={styles.section}><h2>{title}</h2><ul className={styles.lines}>
    {shown.map((line, i) => <li key={i} data-source={line.source}>
      <div className={styles.claim}><span>{line.text}</span>{linkedEvidence(line, themes)}</div>
    </li>)}
  </ul></section>;
}

function MetricList({ title, rows }: { title: string; rows: { key: string; views: number }[] }) {
  return <div><h3>{title}</h3><ul className={styles.metrics}>
    {rows.slice().sort((a, b) => b.views - a.views).slice(0, 5).map((row) =>
      <li key={row.key}><span>{row.key.replaceAll('_', ' ')}</span><strong>{row.views.toLocaleString()}</strong></li>)}
  </ul></div>;
}

function ThemeIndex({ themes }: { themes: ThemeEvidence[] }) {
  return <div className={styles.themeIndex}>{OBSERVATION_TYPES.map((type) => {
    const group = themes.filter((theme) => theme.type === type).sort((a, b) =>
      b.video_count - a.video_count || b.author_count - a.author_count);
    if (!group.length) return null;
    return <div key={type}><h3>{type.replaceAll('_', ' ')}</h3><ul>
      {group.map((theme) => <li key={theme.id}>
        <div className={styles.themeRow}><strong>{theme.label}</strong><span>{theme.video_count} videos · {theme.author_count} authors · {theme.observation_count} observations</span></div>
        {linkedEvidence({ text: theme.label, source: 'inferred', theme_ids: [Number(theme.id)] }, new Map([[Number(theme.id), theme]]))}
      </li>)}
    </ul></div>;
  })}</div>;
}

export default async function AudiencePage() {
  const channelId = await requestOwnerChannel();
  if (!channelId) notFound();
  const [profile, evidence, counts] = await Promise.all([
    latestProfile(channelId), profileEvidence(channelId),
    q<{ comments: string; mined: string; observations: string; themes: string }>(
      `select (select count(*) from audience_comments where channel_id=$1) comments,
       (select count(*) from audience_comments where channel_id=$1 and mined_at is not null) mined,
       (select count(*) from audience_observations where channel_id=$1) observations,
       (select count(*) from audience_themes where channel_id=$1 and profile_version=(
         select max(profile_version) from audience_themes where channel_id=$1)) themes`, [channelId]),
  ]);
  const sections = profile?.sections as unknown as Sections | undefined;
  const stated = profile?.stated ?? {} as StatedAudience;
  const themes = new Map(evidence.themes.map((theme) => [Number(theme.id), theme]));
  const winners = new Map(evidence.winners.map((video) => [video.video_id, video]));
  const statedBuckets = ownerBuckets(stated.content_buckets, evidence.winners);
  const feedback = evidence.themes.filter(isPresentationFeedback);
  const visibleThemes = evidence.themes.filter((theme) => !isPresentationFeedback(theme));
  const stamp = profile?.built_at ? new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'short',
  }).format(new Date(profile.built_at)) : null;
  const demographics = sections?.demographics.filter((row) => row.value &&
    !['income', 'occupation'].includes(row.field)) ?? [];
  const buckets = statedBuckets.length ? statedBuckets.map((bucket) => ({
    ...bucket, text: '', source: 'stated' as const,
  })) : sections?.content_buckets ?? [];

  return <>
    <header className={styles.top}><h1>Audience{profile?.name ? ` · ${profile.name}` : ''}</h1></header>
    {!profile && <AudienceControls stated={{}} hasProfile={false} />}
    {sections?.summary && <div className={styles.intro} data-source="inferred">
      <span className={styles.sourceNote}>Based on viewer comments</span>
      <div className={styles.claim}><span>{sections.summary.text}</span>{linkedEvidence(sections.summary, themes)}</div>
    </div>}
    {sections && <>
      <Lines title="Core beliefs" lines={sections.core_beliefs} stated={stated.core_beliefs} themes={themes} />
      <Lines title="Emotional drivers" lines={sections.emotional_drivers} stated={stated.emotional_drivers} themes={themes} />
      <Lines title="Specific interests" lines={sections.specific_interests} stated={stated.specific_interests} themes={themes} />
      <section className={styles.section}><h2>Content buckets</h2><div className={styles.buckets}>
        {buckets.map((bucket, i) => <div key={i} className={styles.bucket} data-source={bucket.source}>
          <h3>{bucket.title}</h3>{bucket.text && <p>{bucket.text}</p>}
          <ul>{bucket.video_ids.map((id) => {
            const video = winners.get(id) as WinningVideo | undefined;
            return video && <li key={id}><a href={`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`} target="_blank" rel="noreferrer">{video.title} ↗</a><span>{Number(video.views).toLocaleString()} views</span></li>;
          })}</ul>{linkedEvidence(bucket, themes)}
        </div>)}
      </div></section>
      <section className={styles.section}><h2>Audience data</h2>
        <p className={styles.meta}>Measured over 90 days ending {sections.window_end ? new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', dateStyle: 'medium',
        }).format(new Date(sections.window_end)) : '—'} ET</p>
        <ul className={styles.facts}>{demographics.map((row) => <li key={row.field}><strong>{row.field}</strong><span>{row.value}</span></li>)}
          {stated.income && <li><strong>income · stated</strong><span>{stated.income}</span></li>}
          {stated.occupation && <li><strong>occupation · stated</strong><span>{stated.occupation}</span></li>}
        </ul>
        <details className={styles.disclosure}><summary>Devices, traffic, and subscription status</summary>
          <div className={styles.metricGrid}><MetricList title="Devices" rows={sections.devices} />
            <MetricList title="Traffic sources" rows={sections.traffic_sources} />
            <MetricList title="Subscribed status" rows={sections.subscribed_status} /></div>
        </details>
      </section>
      {(sections.transformation.before || sections.transformation.after) && <section className={styles.section}>
        <h2>Transformation · stated by you</h2><dl className={styles.transformation}>
          {sections.transformation.before && <><dt>Before</dt><dd>{sections.transformation.before.text}</dd></>}
          {sections.transformation.after && <><dt>After</dt><dd>{sections.transformation.after.text}</dd></>}
        </dl>
      </section>}
    </>}
    <details className={styles.disclosure}><summary>Explore comment themes <span>{counts[0].themes}</span></summary>
      <p className={styles.meta}>{Number(counts[0].mined).toLocaleString()} of {Number(counts[0].comments).toLocaleString()} comments mined · {Number(counts[0].observations).toLocaleString()} observations. Video and author counts show how widely each theme recurs.</p>
      <ThemeIndex themes={visibleThemes} />
    </details>
    <details className={styles.disclosure}><summary>Presentation feedback <span>{feedback.length}</span></summary>
      <ThemeIndex themes={feedback} />
    </details>
    {profile && <p className={styles.meta}>Updated {stamp} ET · version {profile.version}</p>}
    {profile && <AudienceControls stated={stated} />}
  </>;
}
