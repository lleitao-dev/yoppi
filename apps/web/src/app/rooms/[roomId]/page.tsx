'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import type {
  BlackjackStateView,
  PokerStateView,
  CommandAck,
  RoomLeaveAck,
  RoomResponse,
  RoomView,
  ServerError,
  SessionResponse,
} from '@yoppi/protocol';
import { BlackjackTable } from '@/components/blackjack-table';
import { PokerTable } from '@/components/poker-table';
import { InsufficientPlayerBanner } from '@/components/insufficient-player-banner';
import { ApiError, apiFetch } from '@/lib/api';
import { createSocket, type YoppiSocket } from '@/lib/socket';

function gameLabel(gameType: RoomView['gameType']): string {
  return gameType === 'BLACKJACK' ? 'Blackjack' : "Texas Hold'em";
}

export default function WaitingRoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const roomId = params.roomId;
  const [room, setRoom] = useState<RoomView | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [blackjack, setBlackjack] = useState<BlackjackStateView | null>(null);
  const [poker, setPoker] = useState<PokerStateView | null>(null);
  const [socket, setSocket] = useState<YoppiSocket | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      apiFetch<RoomResponse>(`/api/v1/rooms/${roomId}`),
      apiFetch<SessionResponse>('/api/v1/session'),
    ])
      .then(([roomResponse, sessionResponse]) => {
        if (!active) return;
        setRoom(roomResponse.room);
        setPlayerId(sessionResponse.player.id);
      })
      .catch((caught) => {
        if (!active) return;
        if (caught instanceof ApiError && caught.status === 401) router.replace('/');
        else setError(caught instanceof ApiError ? caught.message : 'Unable to load the room.');
      });
    return () => {
      active = false;
    };
  }, [roomId, router]);

  useEffect(() => {
    const realtime = createSocket();
    const updateRoom = (next: RoomView) => setRoom(next);
    const updateBlackjack = (next: BlackjackStateView) => setBlackjack(next);
    const updatePoker = (next: PokerStateView) => setPoker(next);
    const handleError = (next: ServerError) => setError(next.message);

    realtime.on('connect', () => realtime.emit('room:subscribe', { roomId }));
    realtime.on('room:state', updateRoom);
    realtime.on('room:playerJoined', updateRoom);
    realtime.on('room:playerLeft', updateRoom);
    realtime.on('room:hostChanged', updateRoom);
    realtime.on('blackjack:state', updateBlackjack);
    realtime.on('poker:state', updatePoker);
    realtime.on('server:error', handleError);
    realtime.on('connect_error', (caught) => {
      setError(caught.message === 'UNAUTHENTICATED' ? 'Your guest session has expired.' : 'Real-time connection failed.');
    });
    realtime.connect();
    setSocket(realtime);

    return () => {
      realtime.disconnect();
      setSocket(null);
    };
  }, [roomId]);

  const connectedCount = useMemo(() => room?.players.filter((player) => player.connected).length ?? 0, [room]);
  const seatedCount = useMemo(
    () => room?.players.filter((player) => player.participation === 'PLAYING' && player.seat !== null).length ?? 0,
    [room],
  );
  const queuedCount = useMemo(() => room?.players.filter((player) => player.participation === 'QUEUED').length ?? 0, [room]);
  const membership = useMemo(() => room?.players.find((player) => player.playerId === playerId) ?? null, [playerId, room]);
  const eligibleCount = useMemo(
    () => room?.players.filter((player) => player.connected && player.participation === 'WAITING').length ?? 0,
    [room],
  );

  async function leaveRoom() {
    if (!socket?.connected || leaving || !room) return;
    setLeaving(true);
    setError(null);
    const result = await new Promise<RoomLeaveAck>((resolve) => {
      socket.emit('room:leave', { roomId }, resolve);
    });
    if (result.ok) {
      router.push(`/games/${room?.gameType === 'POKER' ? 'poker' : 'blackjack'}`);
      return;
    }
    setError(result.error.message);
    setLeaving(false);
  }

  async function startGame() {
    if (!socket?.connected || starting) return;
    setStarting(true);
    setError(null);
    const result = await new Promise<CommandAck>((resolve) => socket.emit('game:start', { roomId }, resolve));
    if (!result.ok) setError(result.error.message);
    setStarting(false);
  }

  if (!room || !playerId) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-6 py-16">
        <p className="text-slate-400">{error ?? 'Loading room…'}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-6 py-12 sm:py-16">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-400">
            {room.status === 'WAITING' ? 'Waiting room' : 'Live table'}
          </p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">{gameLabel(room.gameType)}</h1>
          <p className="mt-3 text-slate-400">
            {connectedCount} connected · {room.status === 'ACTIVE' ? `${seatedCount}/${room.maxPlayers} seated${queuedCount > 0 ? ` · ${queuedCount} queued` : ''}` : `${room.players.length}/${room.maxPlayers} members`}
          </p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Room code</p>
          <p data-testid="room-code" className="mt-1 font-mono text-2xl font-semibold tracking-[0.18em]">{room.code}</p>
        </div>
      </div>

      {room.status === 'WAITING' && (
        <>
          <section className="mt-10 rounded-2xl border border-white/10 bg-white/5 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-medium">Players</h2>
              <span className="text-xs text-slate-500">revision {room.revision}</span>
            </div>
            <div className="mt-5 divide-y divide-white/10">
              {room.players.map((player) => (
                <div key={player.playerId} className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{player.displayName}</p>
                      {player.isHost && <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-xs text-emerald-300">Host</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {player.seat === null ? 'Waiting for a seat' : `Seat ${player.seat + 1}`} · {player.participation.toLowerCase()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-400">
                    <span className={`h-2.5 w-2.5 rounded-full ${player.connected ? 'bg-emerald-400' : 'bg-slate-600'}`} />
                    {player.connected ? 'Connected' : 'Offline'}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-6">
            <h2 className="font-medium">Gameplay status</h2>
            {room.gameType === 'BLACKJACK' ? (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Any connected room member can start once the game minimum is met. Blackjack requires {room.minPlayers} player and supports up to {room.maxPlayers}.
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {eligibleCount} connected waiting player{eligibleCount === 1 ? '' : 's'} currently eligible to start.
                </p>
                <button
                  disabled={!room.canStart || !socket?.connected || starting}
                  onClick={() => void startGame()}
                  className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {starting ? 'Starting…' : room.canStart ? 'Start Blackjack' : `Need ${room.minPlayers} connected player${room.minPlayers === 1 ? '' : 's'}`}
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Any connected room member can start once the game minimum is met. Texas Hold&apos;em requires {room.minPlayers} players and supports up to {room.maxPlayers}. Blinds are 10/20 with 1,000 starting chips.
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  {eligibleCount} connected waiting player{eligibleCount === 1 ? '' : 's'} currently eligible to start.
                </p>
                <button
                  disabled={!room.canStart || !socket?.connected || starting}
                  onClick={() => void startGame()}
                  className="mt-5 rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {starting ? 'Starting…' : room.canStart ? "Start Texas Hold'em" : `Need ${room.minPlayers} connected players`}
                </button>
              </>
            )}
          </section>

          <div className="mt-8 flex items-center gap-4">
            <button
              disabled={!socket?.connected || leaving}
              onClick={() => void leaveRoom()}
              className="rounded-xl border border-white/15 px-5 py-3 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
            >
              {leaving ? 'Leaving…' : 'Leave room'}
            </button>
            <p className="text-sm text-slate-500">Share code {room.code} with another player.</p>
          </div>
        </>
      )}

      {room.status === 'ACTIVE' && (
        <InsufficientPlayerBanner requirement={room.playerRequirement} />
      )}

      {room.status === 'ACTIVE' && (
        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Room lifecycle</p>
              <p className="mt-1 text-sm text-slate-300">
                Host: {room.players.find((player) => player.playerId === room.hostPlayerId)?.displayName ?? 'Unassigned'}
              </p>
            </div>
            <p className="text-xs text-slate-500">
              Available {room.playerRequirement.current}/{room.playerRequirement.minimum} · maximum {room.maxPlayers}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {room.players.map((player) => (
              <span key={player.playerId} className="rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-xs text-slate-300">
                {player.displayName}{player.isHost ? ' · host' : ''} · {player.participation.toLowerCase()} · {player.connected ? 'online' : 'offline'}
              </span>
            ))}
          </div>
          {membership?.participation === 'QUEUED' && (
            <div data-testid="queued-player-notice" className="mt-5 rounded-xl border border-sky-300/20 bg-sky-300/10 px-4 py-3 text-sm text-sky-100">
              You are waiting to join the next {room.gameType === 'POKER' ? 'hand' : 'round'}. You may watch the current table while your seat is pending.
            </div>
          )}
          {membership?.participation === 'LEAVING' && (
            <div className="mt-5 rounded-xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-100">
              Your departure is pending and will be finalized at the end of the current {room.gameType === 'POKER' ? 'hand' : 'round'}.
            </div>
          )}
          <button
            disabled={!socket?.connected || leaving}
            onClick={() => void leaveRoom()}
            className="mt-5 rounded-xl border border-white/15 px-5 py-3 text-sm font-medium hover:bg-white/5 disabled:opacity-50"
          >
            {leaving ? 'Leaving…' : membership?.participation === 'PLAYING' ? `Leave after this ${room.gameType === 'POKER' ? 'hand' : 'round'}` : 'Leave room'}
          </button>
        </section>
      )}

      {room.status === 'ACTIVE' && room.gameType === 'BLACKJACK' && socket && (
        blackjack ? (
          <BlackjackTable room={room} playerId={playerId} state={blackjack} socket={socket} onError={setError} />
        ) : (
          <p className="mt-10 text-slate-400">Loading Blackjack state…</p>
        )
      )}

      {room.status === 'ACTIVE' && room.gameType === 'POKER' && socket && (
        poker ? (
          <PokerTable room={room} playerId={playerId} state={poker} socket={socket} onError={setError} />
        ) : (
          <p className="mt-10 text-slate-400">Loading Poker state…</p>
        )
      )}

      {error && <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
    </main>
  );
}
