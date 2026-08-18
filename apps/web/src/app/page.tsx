'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionResponse } from '@yoppi/protocol';
import { ApiError, apiFetch } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState('');
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<SessionResponse>('/api/v1/session')
      .then(() => router.replace('/lobby'))
      .catch(() => setChecking(false));
  }, [router]);

  async function enterYoppi(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch<SessionResponse>('/api/v1/session', {
        method: 'POST',
        body: JSON.stringify({ displayName }),
      });
      router.push('/lobby');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to create a guest session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-6 py-16">
      <div className="grid w-full gap-12 lg:grid-cols-[1.2fr_0.8fr] lg:items-center">
        <section>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-400">Blackjack v0.3</p>
          <h1 className="mt-3 max-w-3xl text-5xl font-semibold tracking-tight sm:text-6xl">Yoppi Online Casino</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">
            Multiplayer, play-money Blackjack and Texas Hold&apos;em. Create a guest identity and enter the lobby.
          </p>
        </section>

        <form onSubmit={(event) => void enterYoppi(event)} className="rounded-2xl border border-white/10 bg-white/5 p-7">
          <h2 className="text-xl font-medium">Enter Yoppi</h2>
          <label className="mt-5 block text-sm text-slate-300" htmlFor="displayName">Display name</label>
          <input
            id="displayName"
            autoComplete="nickname"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            minLength={2}
            maxLength={24}
            disabled={checking || busy}
            placeholder="Alex"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 outline-none focus:border-emerald-500"
          />
          <button
            disabled={checking || busy || displayName.trim().length < 2}
            className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
          >
            {checking ? 'Checking session…' : busy ? 'Entering…' : 'Enter Yoppi'}
          </button>
          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        </form>
      </div>
    </main>
  );
}
