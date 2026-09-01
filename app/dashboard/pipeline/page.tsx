"use client"

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

interface DayCount { day: string; n: number }
interface Job {
  job: string
  ok: boolean
  lastRun: string | null
  today: number | null
  unit: string | null
  series: DayCount[]
  hasErrors: boolean
  median: number
  anomaly: boolean
}
interface LogEntry { job: string; mtime: string | null; tail: string[]; errTail: string[] }
interface Health {
  generatedAt: string
  jobs: Job[]
  thumbnails: {
    watched: number
    checked24h: number
    capturesToday: number
    changesToday: number
    days: { day: string; changes: number; captures: number }[]
  }
  quota: { usedToday: number; limit: number; ledger: { category: string; units: number }[] }
  logs: LogEntry[]
}

const ET: Intl.DateTimeFormatOptions = { timeZone: 'America/New_York' }

function etTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', { ...ET, hour: 'numeric', minute: '2-digit' })
}

function relative(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function Spark({ series, unit }: { series: DayCount[]; unit: string | null }) {
  if (series.length < 2) return <div className="w-[104px]" />
  const max = Math.max(...series.map((d) => d.n), 1)
  const w = 104
  const bw = Math.min(5, Math.max(2, Math.floor(w / series.length) - 2))
  const x0 = w - series.length * (bw + 2)
  const today = new Date().toISOString().split('T')[0]
  return (
    <svg
      width={w}
      height={24}
      className="shrink-0"
      role="img"
      aria-label={`last ${series.length} days of ${unit ?? 'output'}`}
    >
      {series.map((d, i) => {
        const h = Math.max(1, Math.round((d.n / max) * 22))
        return (
          <rect
            key={d.day}
            x={x0 + i * (bw + 2)}
            y={24 - h}
            width={bw}
            height={h}
            rx={1}
            className={d.day === today ? 'fill-foreground' : 'fill-muted-foreground/30'}
          />
        )
      })}
    </svg>
  )
}

function Dot({ job }: { job: Job }) {
  const state = !job.ok ? 'stale' : job.anomaly || job.hasErrors ? 'check' : 'ok'
  return (
    <span className="flex items-center gap-1.5 w-14 justify-end text-xs">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          state === 'ok' && 'bg-emerald-500',
          state === 'check' && 'bg-amber-500',
          state === 'stale' && 'bg-red-500'
        )}
      />
      <span className="text-muted-foreground">{state}</span>
    </span>
  )
}

export default function PipelinePage() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pipeline/health')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      setHealth(data)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  const bad = health?.jobs.filter((j) => !j.ok) ?? []
  const warn = health?.jobs.filter((j) => j.ok && (j.anomaly || j.hasErrors)) ?? []
  const quotaPct = health ? health.quota.usedToday / health.quota.limit : 0

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Pipeline</h1>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {health && <span>as of {etTime(health.generatedAt)} ET</span>}
          <button
            onClick={load}
            aria-label="Refresh"
            className="rounded p-1 hover:bg-muted focus-visible:outline focus-visible:outline-2"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      <p
        className={cn(
          'mt-1 text-sm',
          bad.length ? 'text-red-500' : warn.length ? 'text-amber-500' : 'text-muted-foreground'
        )}
      >
        {error
          ? error
          : !health
            ? 'Loading…'
            : bad.length
              ? `${bad.map((j) => j.job).join(', ')} did not run`
              : warn.length
                ? `${warn.map((j) => j.job).join(', ')} — output off baseline or stderr non-empty`
                : 'All jobs ran overnight.'}
      </p>

      {health && (
        <>
          <section className="mt-8 border-t border-border">
            {health.jobs.map((j) => {
              const log = health.logs.find((l) => l.job === j.job)
              const isOpen = open === j.job
              return (
                <div key={j.job} className="border-b border-border">
                  <button
                    onClick={() => setOpen(isOpen ? null : j.job)}
                    aria-expanded={isOpen}
                    className="grid w-full grid-cols-[14px_auto_1fr_auto] sm:grid-cols-[14px_7.5rem_1fr_auto_auto] items-center gap-3 py-2.5 text-left text-sm hover:bg-muted/40"
                  >
                    <ChevronRight
                      className={cn(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform',
                        isOpen && 'rotate-90'
                      )}
                    />
                    <span className="font-medium">{j.job}</span>
                    <span className="text-muted-foreground tabular-nums whitespace-nowrap">
                      {j.lastRun ? (
                        <>
                          {etTime(j.lastRun)} ET
                          <span className="hidden sm:inline"> · {relative(j.lastRun)}</span>
                        </>
                      ) : (
                        'no log'
                      )}
                    </span>
                    <span className="tabular-nums text-right whitespace-nowrap">
                      {j.today !== null && (
                        <>
                          {j.today.toLocaleString()}{' '}
                          <span className="text-muted-foreground">{j.unit} today</span>
                        </>
                      )}
                    </span>
                    <span className="hidden sm:flex items-center gap-3">
                      <Spark series={j.series} unit={j.unit} />
                      <Dot job={j} />
                    </span>
                  </button>
                  {isOpen && log && (
                    <div className="pb-3 pl-7">
                      <pre className="max-h-56 overflow-auto rounded bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
                        {log.tail.join('\n') || '(empty)'}
                      </pre>
                      {log.errTail.length > 0 && (
                        <pre className="mt-2 max-h-40 overflow-auto rounded bg-red-950/40 p-3 text-xs leading-relaxed text-red-400">
                          {log.errTail.join('\n')}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </section>

          <section className="mt-6 space-y-1.5 text-xs text-muted-foreground tabular-nums">
            <div className="flex items-center gap-3">
              <span className="w-24 shrink-0">YouTube quota</span>
              <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    quotaPct > 0.9 ? 'bg-red-500' : 'bg-foreground/60'
                  )}
                  style={{ width: `${Math.min(100, quotaPct * 100)}%` }}
                />
              </div>
              <span>
                {health.quota.usedToday.toLocaleString()} / {health.quota.limit.toLocaleString()}
                {health.quota.ledger.length > 0 && (
                  <span>
                    {' · '}
                    {health.quota.ledger.map((l) => `${l.category} ${l.units.toLocaleString()}`).join(' · ')}
                  </span>
                )}
              </span>
            </div>
            <div className="flex gap-3">
              <span className="w-24 shrink-0">Thumbnails</span>
              <span>
                {health.thumbnails.watched.toLocaleString()} watched ·{' '}
                {health.thumbnails.checked24h.toLocaleString()} checked 24h ·{' '}
                {health.thumbnails.capturesToday.toLocaleString()} first-captures today
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
