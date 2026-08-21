'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { SessionResponse } from '@yoppi/protocol';
import { apiFetch } from '@/lib/api';

export default function LobbyPage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionResponse | null>(null);

  useEffect(() => {
    apiFetch<SessionResponse>('/api/v1/session')
      .then(setSession)
      .catch(() => router.replace('/'));
  }, [router]);

  async function leaveSession() {
    await apiFetch<void>('/api/v1/session', { method: 'DELETE' });
    router.replace('/');
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-16">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Yoppi Lobby
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Choose a game</h1>
        </div>
        <div className="text-right text-sm text-slate-400">
          <p>{session ? session.player.displayName : 'Loading…'}</p>
          <button className="mt-1 hover:text-white" onClick={() => void leaveSession()}>
            End guest session
          </button>
        </div>
      </div>

      <div className="mt-12 grid gap-6 md:grid-cols-2">
        <Link
          href="/games/blackjack"
          className="group rounded-2xl border border-white/10 bg-white/5 p-7 hover:border-emerald-400/40 hover:bg-white/[0.07]"
        >
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-400">1–5 players</p>
          <h2 className="mt-3 text-3xl font-semibold">Blackjack</h2>
          <p className="mt-3 leading-7 text-slate-400">
            Create a private table or join with a room code.
          </p>
          <p className="mt-8 font-medium text-white">Open Blackjack →</p>
        </Link>

        <Link
          href="/games/poker"
          className="group rounded-2xl border border-white/10 bg-white/5 p-7 hover:border-emerald-400/40 hover:bg-white/[0.07]"
        >
          <p className="text-sm uppercase tracking-[0.2em] text-emerald-400">2–6 players</p>
          <h2 className="mt-3 text-3xl font-semibold">Texas Hold&apos;em</h2>
          <p className="mt-3 leading-7 text-slate-400">
            Create a private table or join with a room code.
          </p>
          <p className="mt-8 font-medium text-white">Open Poker →</p>
        </Link>
      </div>
    </main>
  );
}
