import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

export const Route = createFileRoute('/unsubscribe')({
  component: UnsubscribePage,
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === 'string' ? s.token : '',
  }),
})

type State =
  | { status: 'loading' }
  | { status: 'ready' }
  | { status: 'already' }
  | { status: 'invalid' }
  | { status: 'success' }
  | { status: 'error'; message: string }

function UnsubscribePage() {
  const { token } = Route.useSearch()
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid' })
      return
    }
    fetch(`/email/unsubscribe?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const json = await r.json().catch(() => ({}))
        if (!r.ok) return setState({ status: 'invalid' })
        if (json.valid) return setState({ status: 'ready' })
        if (json.reason === 'already_unsubscribed')
          return setState({ status: 'already' })
        setState({ status: 'invalid' })
      })
      .catch((e) =>
        setState({ status: 'error', message: e?.message ?? 'Network error' }),
      )
  }, [token])

  async function confirm() {
    setState({ status: 'loading' })
    try {
      const r = await fetch('/email/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) return setState({ status: 'error', message: json.error ?? 'Failed' })
      if (json.success) return setState({ status: 'success' })
      if (json.reason === 'already_unsubscribed')
        return setState({ status: 'already' })
      setState({ status: 'error', message: 'Unexpected response' })
    } catch (e: any) {
      setState({ status: 'error', message: e?.message ?? 'Network error' })
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-4 border rounded-lg p-8 bg-card">
        <h1 className="text-2xl font-semibold">Unsubscribe from emails</h1>
        {state.status === 'loading' && (
          <p className="text-muted-foreground">Loading…</p>
        )}
        {state.status === 'ready' && (
          <>
            <p className="text-muted-foreground">
              Click below to stop receiving emails from Blue Collar Tips at this
              address.
            </p>
            <button
              onClick={confirm}
              className="w-full rounded-md bg-primary text-primary-foreground px-4 py-2 font-medium hover:bg-primary/90"
            >
              Confirm unsubscribe
            </button>
          </>
        )}
        {state.status === 'success' && (
          <p className="text-muted-foreground">
            You've been unsubscribed. You won't receive further emails from us.
          </p>
        )}
        {state.status === 'already' && (
          <p className="text-muted-foreground">
            You're already unsubscribed — nothing more to do.
          </p>
        )}
        {state.status === 'invalid' && (
          <p className="text-muted-foreground">
            This unsubscribe link is invalid or has expired.
          </p>
        )}
        {state.status === 'error' && (
          <p className="text-destructive">Something went wrong: {state.message}</p>
        )}
      </div>
    </main>
  )
}