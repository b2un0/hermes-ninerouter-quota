import { host, cn, Popover, Switch, queryClient, PopoverContent, PopoverTrigger, useQuery } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'hermes-ninerouter-quota'
let rest = null

const fetchQuotas = (force = false) => rest(`/quotas${force ? '?force=1' : ''}`)

function useQuotas() {
  return useQuery({
    queryKey: [ID, 'quotas'],
    queryFn: () => fetchQuotas(false),
    refetchInterval: 60_000,
    staleTime: 30_000
  })
}

const pctOf = q => (typeof q.remainingPct === 'number' ? q.remainingPct : null)

function lowest(items) {
  let min = null
  let exhausted = false
  for (const it of items || []) {
    if (!it.active) continue
    const values = (it.quotas || []).map(pctOf).filter(p => p !== null && Number.isFinite(p))
    if (!values.length) continue
    const remaining = Math.min(...values)
    if (remaining <= 0) {
      exhausted = true
      continue
    }
    if (min === null || remaining < min) min = remaining
  }
  return min ?? (exhausted ? 0 : null)
}

function fmtReset(iso) {
  if (!iso) return ''
  const ms = new Date(iso).getTime() - Date.now()
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'reset'
  const m = Math.round(ms / 60000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ${m % 60}m`
  return `${Math.floor(h / 24)}d ${h % 24}h`
}

function resetBubble(resets) {
  if (!resets) return null
  const n = resets.available
  const expires = n > 0 && resets.expiresAt ? ` · expires ${fmtReset(resets.expiresAt)}` : ''
  return { text: `${n}↻`, active: n > 0, title: `${n} reset${n === 1 ? '' : 's'} available${expires}` }
}

// color by remaining %: theme vars only, via opacity-free tokens
const tone = p => (p === null ? 'var(--ui-text-quaternary)' : p < 15 ? 'var(--destructive, #e5484d)' : p < 35 ? 'var(--ui-text-secondary)' : 'var(--ui-accent)')

function Bar({ q }) {
  const p = pctOf(q)
  return jsxs('div', {
    className: 'flex flex-col gap-0.5',
    children: [
      jsxs('div', {
        className: 'flex justify-between text-[0.6875rem] text-(--ui-text-secondary)',
        children: [
          jsx('span', { children: q.name }),
          jsx('span', {
            children: q.unlimited ? 'unlimited' : `${p === null ? '?' : Math.round(p)}% left${q.resetAt ? ` · ${fmtReset(q.resetAt)}` : ''}`
          })
        ]
      }),
      jsx('div', {
        className: 'h-1.5 w-full overflow-hidden rounded-full',
        style: { background: 'var(--ui-stroke-secondary)' },
        children: jsx('div', {
          className: 'h-full rounded-full',
          style: { width: `${q.unlimited ? 100 : Math.max(0, Math.min(100, p ?? 0))}%`, background: tone(q.unlimited ? 100 : p) }
        })
      })
    ]
  })
}

async function setActive(it, active) {
  const r = await rest('/toggle', { method: 'POST', body: { id: it.id, active } })
  if (r && r.ok === false) host.notify({ kind: 'error', message: `9router: ${r.error}` })
  await fetchQuotas(true)
  queryClient.invalidateQueries({ queryKey: [ID, 'quotas'] })
}

function Account({ it }) {
  const bubble = resetBubble(it.resets)
  return jsxs('div', {
    className: 'flex flex-col gap-1.5',
    children: [
      jsxs('div', {
        className: 'flex h-6 items-center gap-2 text-xs font-medium',
        children: [
          jsx('span', { className: cn('min-w-0 flex-1 truncate', !it.active && 'opacity-50'), children: `${it.provider} · ${it.label}${it.active ? '' : ' (off)'}` }),
          it.plan
            ? jsx('span', { className: 'shrink-0 text-[0.6875rem] font-normal text-(--ui-text-tertiary)', children: it.plan })
            : null,
          bubble
            ? jsx('span', {
                title: bubble.title,
                className: 'shrink-0 rounded-full px-1.5 text-[0.625rem] font-normal leading-4',
                style: {
                  background: 'var(--ui-stroke-secondary)',
                  color: bubble.active ? 'var(--ui-accent)' : 'var(--ui-text-tertiary)'
                },
                children: bubble.text
              })
            : null,
          jsx('span', {
            className: 'flex h-6 w-9 shrink-0 items-center justify-end',
            children: jsx(Switch, { size: 'xs', checked: it.active, onCheckedChange: v => setActive(it, v) })
          })
        ]
      }),
      it.error ? jsx('div', { className: 'text-[0.6875rem] text-(--ui-text-tertiary)', children: it.error }) : null,
      ...(it.quotas || []).map(q => jsx(Bar, { q }, q.name)),
      it.extra
        ? jsx(Bar, {
            q: {
              name: `extra ${it.extra.currency || ''} ${(it.extra.used ?? 0) / 100}/${(it.extra.limit ?? 0) / 100}`.trim(),
              remainingPct: it.extra.pct == null ? null : 100 - it.extra.pct
            }
          })
        : null
    ]
  })
}

function Body() {
  const { data, isLoading, isFetching, refetch } = useQuotas()
  return jsxs('div', {
    className: 'flex flex-col gap-3 p-3 text-sm',
    children: [
      jsxs('div', {
        className: 'flex items-center justify-between',
        children: [
          jsx('div', { className: 'font-medium', children: '9router quotas' }),
          jsx('button', {
            type: 'button',
            className: 'text-[0.6875rem] text-(--ui-text-tertiary) hover:text-foreground',
            onClick: async () => {
              await fetchQuotas(true)
              refetch()
            },
            children: isFetching ? 'loading…' : 'refresh'
          })
        ]
      }),
      isLoading ? jsx('div', { className: 'text-(--ui-text-tertiary)', children: 'loading…' }) : null,
      data && !data.ok ? jsx('div', { className: 'text-(--ui-text-tertiary)', children: data.error }) : null,
      ...((data && data.items) || []).map(it => jsx(Account, { it }, it.id))
    ]
  })
}

function Chip() {
  const { data } = useQuotas()
  const p = data && data.ok ? lowest(data.items) : null
  const label = !data ? '9router …' : !data.ok ? '9router !' : `9router ${p === null ? '?' : Math.round(p) + '%'}`
  const resets = data && data.ok ? (data.items || []).reduce((n, it) => n + (it.active && it.resets ? it.resets.available : 0), 0) : 0
  return jsxs(Popover, {
    children: [
      jsx(PopoverTrigger, {
        asChild: true,
        children: jsx('button', {
          type: 'button',
          className: cn(
            'inline-flex h-full items-center gap-1 px-1.5 text-[0.6875rem] transition-colors',
            'text-(--ui-text-tertiary) hover:bg-(--chrome-action-hover) hover:text-foreground'
          ),
          style: p !== null && p < 15 ? { color: tone(p) } : undefined,
          children: resets > 0 ? `${label} · ${resets}↻` : label
        })
      }),
      jsx(PopoverContent, { side: 'top', align: 'end', className: 'w-80 p-0', children: jsx(Body, {}) })
    ]
  })
}

export default {
  id: ID,
  name: '9router Quota',
  register(ctx) {
    rest = ctx.rest
    ctx.register({ id: 'chip', area: 'statusBar.right', order: 125, render: () => jsx(Chip, {}) })

  }
}
