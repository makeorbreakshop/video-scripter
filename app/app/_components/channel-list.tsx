'use client';
// /app/channels — a list, not a gallery.
//
// The top line is the two things that act on the whole list: importing the subscriptions this
// account already has, and the meter saying how many channels it is being notified about.
// Then one box that does both jobs — it filters what is already tracked as you type, and
// hands off to the add flow (AddChannel, controlled) the moment the text names a channel we
// do not track. Then the group chips, then the rows.
//
// A row is: avatar, name, when it last published, the groups it is in, where its baseline has
// been going for 90 days, that baseline, and whether it notifies. Select mode swaps the chip
// row for a selection bar and does all of it in bulk.
//
// Every control here is one of the five in components/app/CONTROLS.md: the chip row is
// <Chips>, the sort and the group popovers are <Menu>, the notify lane is <Coin>. This page
// owns no dropdown of its own.
import { Suspense, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import AddChannel from './add-channel';
import ImportSubscriptions from './import-subscriptions';
import { ChannelListSkeleton } from '@/components/app/skeletons';
import { ChannelAvatar } from '@/components/app/avatar';
import { Menu, Sort, type MenuItem } from '@/components/app/menu';
import { Chips } from '@/components/app/chips';
import { Coin } from '@/components/app/coin';
import {
  baselineLabel, filterChannels, isBackfilling, shouldOfferAdd, sortChannels, type ChannelRowLike,
} from '@/lib/app/channel-view';
import {
  filterByGroup, groupCounts, groupColorVar, notifyGate, percentLabel, recencyLabel,
  sparkDirection, sparkPath, triState, triStateAction, type GroupLike, type SparkPoint,
} from '@/lib/app/groups-view';
import type { PlanLimits, PlanName } from '@/lib/app/plans';

export interface ChannelRow extends ChannelRowLike {
  notify: boolean;
  subscriber_count: number | null;
  groups: string[];
  last_upload_at: string | null;
  spark: { points: SparkPoint[]; pct: number | null } | null;
}

/**
 * How many rows are in the DOM at once. Each row carries an avatar, an inline SVG and two
 * menus; at 500 of them the page took ~22 s to become interactive. Search and the group chips
 * still run over the whole list — only the rendered slice is capped, and it grows as you
 * reach the bottom.
 */
const PAGE = 60;

const SORTS = [
  { key: 'baseline', label: 'Baseline' },
  { key: 'name', label: 'Name' },
  { key: 'added', label: 'Recently added' },
] as const;
type SortKey = (typeof SORTS)[number]['key'];

export interface ChannelsClientProps {
  /** The rows, as a promise: the head and the search box paint before the list resolves. */
  channels: ChannelRow[] | Promise<ChannelRow[]>;
  trackedIds: string[];
  groups: GroupLike[];
  plan: PlanName;
  limits: PlanLimits;
  usage: { tracked: number; watched_closely: number };
  notifyCount: number;
  readOnly?: boolean;
}

export default function ChannelsClient({
  channels, trackedIds, groups: initialGroups, limits, notifyCount: initialNotify, readOnly,
}: ChannelsClientProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<GroupLike[]>(initialGroups);
  const [notifying, setNotifying] = useState(initialNotify);
  const [importOpen, setImportOpen] = useState(false);
  const meter = notifyGate(notifying, limits.tracked);

  const refresh = useCallback(async () => { setQuery(''); router.refresh(); }, [router]);

  const createGroup = useCallback(async (name: string): Promise<GroupLike | null> => {
    const res = await fetch('/api/app/channels/groups', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || 'Could not create that group.');
    setGroups((g) => [...g, body.group]);
    return body.group;
  }, []);

  return (
    <div className="cs-chan-body">
      <div className="cs-page-head cs-chan-head">
        {!readOnly && (
          <button type="button" className="cs-btn" onClick={() => setImportOpen(true)}>
            <DownloadIcon />
            Import subscriptions
          </button>
        )}
        <div className="cs-nmeter">
          <div className="cs-nmeter-label">{meter.label}</div>
          <div className="cs-nmeter-bar" aria-hidden="true">
            {Array.from({ length: meter.segments }, (_, i) => (
              <i key={i} data-on={i < meter.count} />
            ))}
          </div>
        </div>
      </div>

      {!readOnly && (
        <div className="cs-searchbox">
          <SearchIcon />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or add a channel"
            aria-label="Search or add a channel"
          />
        </div>
      )}

      <Suspense fallback={<ChannelListSkeleton />}>
        <ChannelRows
          channels={channels}
          readOnly={readOnly}
          query={query}
          onQueryChange={setQuery}
          trackedIds={trackedIds}
          onAdded={refresh}
          groups={groups}
          onCreateGroup={createGroup}
          meter={meter}
          onNotifyingChange={setNotifying}
        />
      </Suspense>

      {!readOnly && importOpen && (
        <ImportSubscriptions
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImported={() => refresh()}
        />
      )}
    </div>
  );
}

interface RowsProps {
  channels: ChannelRow[] | Promise<ChannelRow[]>;
  readOnly?: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  trackedIds: string[];
  onAdded: (channelId: string) => void | Promise<void>;
  groups: GroupLike[];
  onCreateGroup: (name: string) => Promise<GroupLike | null>;
  meter: ReturnType<typeof notifyGate>;
  onNotifyingChange: (n: number) => void;
}

function ChannelRows({
  channels, readOnly, query, onQueryChange, trackedIds, onAdded, groups, onCreateGroup, meter, onNotifyingChange,
}: RowsProps) {
  const router = useRouter();
  const params = useSearchParams();
  const initial = Array.isArray(channels) ? channels : use(channels);
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('baseline');
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState<string[] | null>(null);

  const activeGroup = params?.get('group') || null;
  const [limit, setLimit] = useState(PAGE);

  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  const searched = useMemo(() => filterChannels(sorted, query), [sorted, query]);
  const shown = useMemo(() => filterByGroup(searched, activeGroup), [searched, activeGroup]);
  const visible = useMemo(() => shown.slice(0, limit), [shown, limit]);
  // A new filter is a new list: start it at the top again.
  useEffect(() => { setLimit(PAGE); }, [query, sort, activeGroup]);
  const counts = useMemo(() => groupCounts(rows, groups), [rows, groups]);
  // Built once for the whole list, not once per row on every keystroke.
  const byId = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);
  const offerAdd = !readOnly && shouldOfferAdd(query, shown.length);
  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.channel_id)), [rows, selected]);
  const activeGroupName = activeGroup ? byId.get(activeGroup)?.name ?? null : null;

  // Escape is the universal exit from a mode.
  useEffect(() => {
    if (!selectMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelectMode(false); setSelected(new Set()); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectMode]);

  function setGroupFilter(id: string | null) {
    const p = new URLSearchParams(params?.toString() ?? '');
    if (id && id !== 'all') p.set('group', id); else p.delete('group');
    const s = p.toString();
    router.replace(`/app/channels${s ? `?${s}` : ''}`, { scroll: false });
  }

  /** Every mutation edits the rows in place first; a failure puts them back and says why. */
  async function mutate(next: ChannelRow[], run: () => Promise<Response>, fallback: string) {
    const before = rows;
    setRows(next);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || fallback);
      return true;
    } catch (e: any) {
      setRows(before);
      setError(e.message || fallback);
      return false;
    }
  }

  async function setMembership(groupId: string, ids: string[], op: 'add' | 'remove') {
    const set = new Set(ids);
    const next = rows.map((r) => {
      if (!set.has(r.channel_id)) return r;
      const has = r.groups.includes(groupId);
      if (op === 'add' && !has) return { ...r, groups: [...r.groups, groupId] };
      if (op === 'remove' && has) return { ...r, groups: r.groups.filter((g) => g !== groupId) };
      return r;
    });
    await mutate(next, () => fetch(`/api/app/channels/groups/${groupId}/members`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel_ids: ids, op }),
    }), 'Could not update that group.');
  }

  async function setNotify(ids: string[], on: boolean) {
    const set = new Set(ids);
    const next = rows.map((r) => (set.has(r.channel_id) ? { ...r, notify: on } : r));
    const ok = await mutate(next, () => fetch('/api/app/channels/notify', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ channel_ids: ids, on }),
    }), 'Could not change notifications.');
    if (ok) onNotifyingChange(next.filter((r) => r.notify).length);
  }

  async function removeChannels(ids: string[]) {
    setConfirming(null);
    const set = new Set(ids);
    const before = rows;
    setRows(rows.filter((r) => !set.has(r.channel_id)));
    setSelected(new Set());
    try {
      for (const id of ids) {
        const res = await fetch(`/api/app/channels/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || 'Could not remove that channel.');
      }
      router.refresh();
    } catch (e: any) {
      setRows(before);
      setError(e.message);
    }
  }

  function toggleSelect(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const groupItems = (forRows: Array<{ channel_id: string; groups: string[] }>): MenuItem[] =>
    groups.map((g) => ({
      key: g.id,
      label: g.name,
      color: groupColorVar(g.color),
      count: counts[g.id] ?? 0,
      state: triState(forRows, g.id),
    }));

  const chipItems = [
    { key: 'all', label: 'All', count: counts.all },
    ...groups.map((g) => ({ key: g.id, label: g.name, count: counts[g.id] ?? 0, color: groupColorVar(g.color) })),
  ];

  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.channel_id));

  return (
    <>
      {error && <div className="cs-note" data-tone="bad">{error}</div>}

      {offerAdd && (
        <AddChannel trackedIds={trackedIds} onAdded={onAdded} value={query} onValueChange={onQueryChange} />
      )}

      {selectMode ? (
        <div className="cs-selbar">
          <div className="cs-selbar-left">
            <span className="cs-selbar-n">{selected.size} selected</span>
            {activeGroupName && <span className="cs-selbar-n">in {activeGroupName}</span>}
            <Menu
              mode="multi"
              label="Add to group"
              ariaLabel="Add to group"
              align="start"
              disabled={!selected.size}
              items={groupItems(selectedRows)}
              onToggle={(gid) => {
                const state = triState(selectedRows, gid);
                setMembership(gid, Array.from(selected), triStateAction(state));
              }}
              footer={(close) => (
                <NewGroupField
                  onCreate={async (name) => {
                    const g = await onCreateGroup(name);
                    if (g) await setMembership(g.id, Array.from(selected), 'add');
                    close();
                  }}
                  onError={setError}
                />
              )}
            />
            <button type="button" className="cs-linkish" disabled={!selected.size}
                    onClick={() => setNotify(Array.from(selected), true)}>Notify</button>
            <button type="button" className="cs-linkish" disabled={!selected.size}
                    onClick={() => setNotify(Array.from(selected), false)}>Mute</button>
            <button type="button" className="cs-linkish" data-tone="bad" disabled={!selected.size}
                    onClick={() => setConfirming(Array.from(selected))}>Remove</button>
          </div>
          <div className="cs-selbar-right">
            <button
              type="button" className="cs-linkish"
              onClick={() => setSelected(allShownSelected ? new Set() : new Set(shown.map((r) => r.channel_id)))}
            >
              {allShownSelected ? 'Deselect all' : `Select all ${shown.length}`}
            </button>
            <button type="button" className="cs-linkish"
                    onClick={() => { setSelectMode(false); setSelected(new Set()); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="cs-gchips">
          <Chips
            ariaLabel="Filter by group"
            value={activeGroup ?? 'all'}
            items={chipItems}
            onChange={(key) => setGroupFilter(key === activeGroup ? null : key)}
            onCreate={readOnly ? undefined : (name) => {
              onCreateGroup(name).then(() => setError(null)).catch((e) => setError(e.message));
            }}
            createLabel="New group"
          />
          {!readOnly && (
            <div className="cs-gchips-right">
              <button type="button" className="cs-linkish" onClick={() => setSelectMode(true)}>Select</button>
              <Sort
                ariaLabel="Sort"
                value={sort}
                options={SORTS.map((s) => ({ key: s.key, label: s.label }))}
                onChange={(k) => setSort(k as SortKey)}
              />
            </div>
          )}
        </div>
      )}

      <div className="cs-clist">
        <div className="cs-chead" aria-hidden="true">
          {selectMode && <span className="cs-l-check" />}
          <span className="cs-l-avatar" />
          <span className="cs-l-name">CHANNEL</span>
          <span className="cs-l-groups">GROUPS</span>
          <span className="cs-l-spark">90 DAYS</span>
          <span className="cs-l-base">BASELINE</span>
          <span className="cs-l-notify">NOTIFY</span>
          {!readOnly && <span className="cs-l-more" />}
        </div>
        {shown.length === 0 ? (
          <div className="cs-cnone">{emptyLabel(rows.length, query, activeGroupName)}</div>
        ) : visible.map((c, i) => (
          <Row
            key={c.channel_id}
            row={c}
            eager={i < 16}
            byId={byId}
            groups={groups}
            counts={counts}
            readOnly={readOnly}
            selectMode={selectMode}
            selected={selected.has(c.channel_id)}
            onSelect={() => toggleSelect(c.channel_id)}
            onToggleGroup={(gid) => setMembership(gid, [c.channel_id], triStateAction(triState([c], gid)))}
            onCreateGroup={async (name) => {
              const g = await onCreateGroup(name);
              if (g) await setMembership(g.id, [c.channel_id], 'add');
            }}
            onError={setError}
            onNotify={(on) => setNotify([c.channel_id], on)}
            onRemove={() => setConfirming([c.channel_id])}
            notifyBlocked={meter.atLimit && !c.notify}
          />
        ))}
        {visible.length < shown.length && (
          <MoreRows onReach={() => setLimit((n) => n + PAGE)} />
        )}
      </div>

      {confirming && (
        <ConfirmStop
          names={confirming.map((id) => rows.find((r) => r.channel_id === id)?.name || id)}
          onCancel={() => setConfirming(null)}
          onConfirm={() => removeChannels(confirming)}
        />
      )}
    </>
  );
}

/**
 * The bottom of the rendered slice. Reaching it loads the next page — no button, because the
 * list has no page boundary to name.
 */
function MoreRows({ onReach }: { onReach: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (older Safari, jsdom) means no lazy paging: load it all.
    if (typeof IntersectionObserver === 'undefined') { onReach(); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onReach();
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onReach]);
  return <div ref={ref} className="cs-cmore" aria-hidden="true" />;
}

/** What an empty list says. A name, never a sentence explaining the page. */
function emptyLabel(total: number, query: string, group: string | null): string {
  if (total === 0) return 'No channels';
  if (query.trim()) return 'No match';
  if (group) return `Nothing in ${group}`;
  return 'No channels';
}

const Row = memo(function Row({
  row, byId, groups, counts, readOnly, selectMode, selected, onSelect, onToggleGroup, onCreateGroup,
  onError, onNotify, onRemove, notifyBlocked, eager,
}: {
  row: ChannelRow;
  /** Above the fold: fetch the avatar now rather than lazily. */
  eager?: boolean;
  byId: Map<string, GroupLike>;
  /**
   * The group menu's items are built here, from stable props. Built by the parent they were a
   * fresh array on every keystroke, which made the memo above do nothing at all.
   */
  groups: GroupLike[];
  counts: Record<string, number>;
  readOnly?: boolean;
  selectMode: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleGroup: (groupId: string) => void;
  onCreateGroup: (name: string) => Promise<void>;
  onError: (m: string | null) => void;
  onNotify: (on: boolean) => void;
  onRemove: () => void;
  notifyBlocked: boolean;
}) {
  const mine = row.groups.map((id) => byId.get(id)).filter(Boolean) as GroupLike[];
  const items: MenuItem[] = useMemo(
    () => groups.map((g) => ({
      key: g.id,
      label: g.name,
      color: groupColorVar(g.color),
      count: counts[g.id] ?? 0,
      state: triState([row], g.id),
    })),
    [groups, counts, row]
  );
  // Nothing to draw and nothing to average yet: the catalog is still coming in.
  const waiting = isBackfilling(row) && row.baseline == null;
  const pct = row.spark?.pct ?? null;
  const dir = sparkDirection(pct);
  const name = row.name || row.channel_id;

  return (
    <div className="cs-crow" data-selected={selected || undefined}>
      {!selectMode && <Link className="cs-crow-link" href={`/app/channels/${row.channel_id}`} aria-label={name} />}
      {selectMode && (
        <input type="checkbox" className="cs-check cs-l-check" checked={selected} onChange={onSelect}
               aria-label={`Select ${name}`} />
      )}
      <span className="cs-l-avatar">
        <ChannelAvatar src={row.avatar_url} name={row.name} size={36} channelId={row.channel_id} eager={eager} />
      </span>
      <div className="cs-crow-id">
        <div className="cs-crow-name">
          <b>{name}</b>
          {row.role === 'self' && <span className="cs-crow-you">YOU</span>}
        </div>
        <div className="cs-crow-sub cs-num">{recencyLabel(row.last_upload_at)}</div>
      </div>

      <div className="cs-l-groups cs-crow-groups">
        {mine.map((g) => (
          <span key={g.id} className="cs-gtag" style={{ ['--cs-dot' as any]: groupColorVar(g.color) }}>
            <i /><span>{g.name}</span>
          </span>
        ))}
        {!readOnly && !selectMode && (
          <span className="cs-crow-plus" data-empty={mine.length === 0 || undefined}>
            <Menu
              mode="multi"
              variant="icon"
              align="start"
              ariaLabel={`Groups for ${name}`}
              label={<span aria-hidden="true">+</span>}
              items={items}
              onToggle={onToggleGroup}
              footer={(close) => (
                <NewGroupField
                  onCreate={async (n) => { await onCreateGroup(n); close(); }}
                  onError={onError}
                />
              )}
            />
          </span>
        )}
      </div>

      <span className="cs-l-spark">
        {waiting ? null : row.spark?.points?.length ? (
          <svg className="cs-spark" width="120" height="28" viewBox="0 0 120 28" data-dir={dir} aria-hidden="true">
            <polyline points={sparkPath(row.spark.points)} fill="none" stroke="currentColor"
                      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          // Never a hole in the lane: a flat rule holds the row's rhythm.
          <svg className="cs-spark-flat" width="120" height="28" viewBox="0 0 120 28" aria-hidden="true">
            <line x1="0" y1="14" x2="120" y2="14" stroke="currentColor" strokeWidth="1" />
          </svg>
        )}
      </span>

      <div className="cs-l-base cs-crow-base">
        <b data-wait={waiting || undefined}>{baselineLabel(row)}</b>
        <span data-dir={dir}>{percentLabel(pct)}</span>
      </div>

      <span className="cs-l-notify">
        {readOnly ? null : (
          <Coin
            on={row.notify}
            disabled={notifyBlocked}
            label={`${row.notify ? 'Mute' : 'Notify about'} ${name}`}
            onToggle={() => onNotify(!row.notify)}
          />
        )}
      </span>

      {!readOnly && !selectMode && (
        <span className="cs-crow-more cs-l-more">
          <Menu
            mode="actions"
            variant="icon"
            ariaLabel={`More for ${name}`}
            label={<span aria-hidden="true">···</span>}
            items={[{ key: 'remove', label: 'Stop tracking', destructive: true }]}
            onSelect={onRemove}
          />
        </span>
      )}
    </div>
  );
});

/** The panel's footer: name a group and the channels in hand join it. */
function NewGroupField({ onCreate, onError }: {
  onCreate: (name: string) => void | Promise<void>;
  onError: (m: string | null) => void;
}) {
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const n = name.trim();
        if (!n) return;
        setName('');
        try { await onCreate(n); onError(null); } catch (err: any) { onError(err.message); }
      }}
    >
      <span aria-hidden="true">+</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New group…"
             aria-label="New group name" />
    </form>
  );
}

/** The app's own confirm, on the app's own plate. The browser's is not one of the controls. */
function ConfirmStop({ names, onCancel, onConfirm }: {
  names: string[]; onCancel: () => void; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const listed = names.slice(0, 6);
  return (
    <dialog ref={ref} className="cs-dialog" onClose={onCancel} aria-label="Stop tracking">
      <div className="cs-dialog-head"><h3>Stop tracking</h3></div>
      <div className="cs-dialog-body">
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
          {listed.map((n) => <li key={n}>{n}</li>)}
          {names.length > listed.length && (
            <li className="cs-num" style={{ color: 'var(--cs-muted)' }}>+{names.length - listed.length} more</li>
          )}
        </ul>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button type="button" className="cs-linkish" onClick={onCancel}>Cancel</button>
          <button type="button" className="cs-btn" data-variant="danger" onClick={onConfirm} autoFocus>
            Stop tracking
          </button>
        </div>
      </div>
    </dialog>
  );
}

function sortRows(rows: ChannelRow[], sort: SortKey): ChannelRow[] {
  if (sort === 'name') {
    return [...rows].sort((a, b) => (a.name || a.channel_id).localeCompare(b.name || b.channel_id));
  }
  if (sort === 'added') {
    return [...rows].sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime());
  }
  return sortChannels(rows);
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="m10.4 10.4 3.1 3.1" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11.5v2h11v-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
