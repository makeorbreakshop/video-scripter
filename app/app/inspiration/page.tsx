import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Thumb, ThumbFallbackScript } from '@/components/app/thumb';
import { LocalTime } from '@/components/app/local-time';
import { requireAppUser } from '@/lib/app/session';
import { canSeeInspiration } from '@/lib/app/flags';
import {
  inspirationFeedbackFor,
  listInspirationTargets,
  searchInspiration,
  type InspirationFeedback,
  type InspirationResult,
} from '@/lib/app/inspiration';
import { parseInspirationDistance, type InspirationDistance } from '@/lib/semantic/inspiration';
import { updateInspirationFeedback } from './actions';
import styles from './inspiration.module.css';
import { InspirationTarget } from '@/app/app/_components/inspiration-target';

export const dynamic = 'force-dynamic';

const DISTANCES: Array<{ value: InspirationDistance; label: string }> = [
  { value: 'near', label: 'Near' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'far', label: 'Far' },
];

// Dates in the app are the READER's, not Brandon's, so nothing is formatted on the server here:
// the instant crosses and <LocalTime> writes it. (lib/app/local-time.ts)

function words(signals: string[]): string {
  if (!signals.length) return 'Loose title-pattern match';
  return signals.slice(0, 3).map((signal) => signal.replaceAll('_', ' ')).join(' · ');
}

function territory(proximity: number): string {
  if (proximity >= 0.67) return 'Closer within this candidate pool';
  if (proximity <= 0.33) return 'Furthest within this candidate pool';
  return 'Mid-range within this candidate pool';
}

function packagingFit(value: number): string {
  if (value >= 0.67) return 'Strong pattern fit';
  if (value >= 0.34) return 'Moderate pattern fit';
  return 'Loose pattern fit';
}

function FeedbackButton({
  result,
  targetChannelId,
  distance,
  current,
  choice,
}: {
  result: InspirationResult;
  targetChannelId: string;
  distance: InspirationDistance;
  current?: InspirationFeedback;
  choice: InspirationFeedback;
}) {
  const selected = current === choice;
  const label = choice === 'saved' ? (selected ? 'Saved' : 'Save') : (selected ? 'Dismissed' : 'Dismiss');
  return (
    <form action={updateInspirationFeedback}>
      <input type="hidden" name="target_channel_id" value={targetChannelId} />
      <input type="hidden" name="video_id" value={result.videoId} />
      <input type="hidden" name="distance" value={distance} />
      <input type="hidden" name="rank" value={result.rank} />
      <input type="hidden" name="decision" value={selected ? 'clear' : choice} />
      <button
        type="submit"
        className={`cs-btn ${choice === 'dismissed' ? styles.dismiss : styles.feedback}`}
        data-selected={selected}
        aria-pressed={selected}
        title={selected ? `Undo ${choice}` : undefined}
      >
        {label}
      </button>
    </form>
  );
}

export default async function InspirationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAppUser();
  if (!user) redirect('/sign-in');
  if (!canSeeInspiration(user)) redirect('/app/feed');
  const [targets, params] = await Promise.all([listInspirationTargets(user.id), searchParams]);
  const askedChannel = Array.isArray(params.channel) ? params.channel[0] : params.channel;
  const target = targets.find((item) => item.channelId === askedChannel) ?? targets[0];
  const distance = parseInspirationDistance(params.distance);

  if (!target) {
    return (
      <>
        <div className="cs-page-head"><div><h1 className="cs-h1">Inspiration</h1></div></div>
        <div className="cs-empty">
          <div className="cs-coin">Choose a target</div>
          <p>Track your channel first, then this sandbox can search for ideas around it.</p>
          <div className="cs-center"><Link className="cs-btn" data-variant="primary" href="/app/channels">Add a channel</Link></div>
        </div>
      </>
    );
  }

  const search = await searchInspiration(target.channelId, distance);
  const feedback = search.status === 'ready'
    ? await inspirationFeedbackFor(user.id, target.channelId, search.results.map((result) => result.videoId))
    : {};

  return (
    <>
      <ThumbFallbackScript />
      <div className="cs-page-head">
        <div>
          <h1 className="cs-h1">Inspiration</h1>
          <p className="cs-sub">Find scored outlier ideas at the distance you want.</p>
        </div>
        <span className="cs-badge" data-case="sentence">Experimental</span>
      </div>

      <form className={styles.controls} method="get">
        <div className={styles.field}>
          <span className={styles.label}>Build for</span>
          <InspirationTarget targets={targets} value={target.channelId} distance={distance} />
          <input type="hidden" name="channel" value={target.channelId} />
        </div>
        <fieldset className={styles.distance}>
          <legend>How far outside its territory?</legend>
          <div className={styles.modes}>
            {DISTANCES.map((item) => (
              <label className={styles.mode} key={item.value}>
                <input type="radio" name="distance" value={item.value} defaultChecked={distance === item.value} />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <button className="cs-btn" data-variant="primary" type="submit">Explore</button>
      </form>

      {search.status === 'unavailable' && (
        <div className="cs-note" data-tone="bad">
          Inspiration search is offline right now. The rest of ChannelSmith still works; retry when the local vector service is running.
        </div>
      )}

      {search.status === 'target_not_indexed' && (
        <div className="cs-note">
          {target.name} is not in this bounded test corpus yet. Choose another tracked channel above.
        </div>
      )}

      {search.status === 'ready' && search.results.length === 0 && (
        <div className="cs-empty"><div className="cs-coin">No ideas found</div><p>Try another distance or target channel.</p></div>
      )}

      {search.status === 'ready' && search.results.length > 0 && (
        <>
          <div className={styles.stream}>
            {search.results.map((result, index) => {
              const current = feedback[result.videoId];
              const youtubeThumb = `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`;
              return (
                <article className={styles.result} data-feedback={current} key={result.videoId}>
                  <div className={styles.media}>
                    <Thumb
                      src={result.thumbnailUrl || youtubeThumb}
                      fallbackSrc={youtubeThumb}
                      alt={`Thumbnail for ${result.title}`}
                      loading={index < 2 ? 'eager' : 'lazy'}
                      fetchPriority={index < 2 ? 'high' : undefined}
                    />
                  </div>
                  <div className={styles.body}>
                    <div className={styles.byline}>
                      <span className={styles.channel}>{result.channelName}</span>
                      {result.publishedAt && <time dateTime={result.publishedAt}><LocalTime ms={Date.parse(result.publishedAt)} format="dayYear" /></time>}
                      <span className={styles.outlier} title={`${result.outlierScore.toFixed(2)} times this channel's baseline`}>
                        {result.outlierScore.toFixed(1)}× typical
                      </span>
                    </div>
                    <h2 className={styles.title}><Link href={`/app/videos/${result.videoId}`}>{result.title}</Link></h2>
                    <dl className={styles.evidence}>
                      <div>
                        <dt>Title pattern</dt>
                        <dd>{packagingFit(result.components.packaging_form)} · {words(result.packagingSignals)}</dd>
                      </div>
                      <div>
                        <dt>Content distance</dt>
                        <dd>{territory(result.components.content_proximity)} for {search.targetName}</dd>
                      </div>
                      <div>
                        <dt>Performance proof</dt>
                        <dd>{result.outlierScore.toFixed(1)}× the channel baseline · {result.baselineVideos} baseline videos</dd>
                      </div>
                    </dl>
                    <div className={styles.actions}>
                      <FeedbackButton result={result} targetChannelId={target.channelId} distance={distance} current={current} choice="saved" />
                      <FeedbackButton result={result} targetChannelId={target.channelId} distance={distance} current={current} choice="dismissed" />
                      <Link className="cs-btn" href={`/app/videos/${result.videoId}`}>Details</Link>
                      <a className="cs-linkbtn" href={`https://www.youtube.com/watch?v=${result.videoId}`} target="_blank" rel="noreferrer">YouTube ↗</a>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
          <p className={styles.receipt}>
            Ranked {search.candidatePoolSize.toLocaleString('en-US')} candidates from the scored one-year outlier corpus as of <LocalTime ms={Date.parse(search.corpusAsOf)} format="dayYear" />.
            {' '}Text model: {search.model}; recipe: {search.recipe}. No transcript or runtime LLM call.
          </p>
        </>
      )}
    </>
  );
}
