'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { GameType, RoomResponse } from '@yoppi/protocol';
import { ApiError, apiFetch } from '@/lib/api';

interface RoomEntryProps {
  gameType: GameType;
  title: string;
  description: string;
}

export function RoomEntry({ gameType, title, description }: RoomEntryProps) {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<RoomResponse>('/api/v1/rooms', {
        method: 'POST',
        body: JSON.stringify({ gameType }),
      });
      router.push(`/rooms/${response.room.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to create the room.');
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<RoomResponse>('/api/v1/rooms/join', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim().toUpperCase() }),
      });
      router.push(`/rooms/${response.room.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Unable to join the room.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl px-6 py-16">
      <button className="text-sm text-slate-400 hover:text-white" onClick={() => router.push('/lobby')}>
        ← Lobby
      </button>
      <p className="mt-12 text-sm font-semibold uppercase tracking-[0.24em] text-emerald-400">Yoppi</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-4 max-w-2xl text-slate-300">{description}</p>

      <div className="mt-10 grid gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-medium">Create a room</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">You become the host and receive a six-character room code.</p>
          <button
            disabled={busy}
            onClick={() => void createRoom()}
            className="mt-6 w-full rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
          >
            Create room
          </button>
        </section>

        <form onSubmit={(event) => void joinRoom(event)} className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-medium">Join a room</h2>
          <p className="mt-2 text-sm leading-6 text-slate-400">If play is already underway, you will wait for the game's next safe admission point.</p>
          <label className="mt-5 block text-sm text-slate-300" htmlFor="roomCode">Room code</label>
          <input
            id="roomCode"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
            placeholder="e.g. 7MK2QP"
            className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 font-mono uppercase tracking-[0.2em] outline-none focus:border-emerald-500"
          />
          <button
            disabled={busy || code.length !== 6}
            className="mt-4 w-full rounded-xl border border-white/15 px-4 py-3 font-semibold hover:bg-white/5 disabled:opacity-50"
          >
            Join room
          </button>
        </form>
      </div>

      {error && <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </main>
  );
}
