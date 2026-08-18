'use client';

import { useMemo, useState } from 'react';
import type {
  BlackjackAction,
  BlackjackStateView,
  CardView,
  CommandAck,
  RoomView,
} from '@yoppi/protocol';
import type { YoppiSocket } from '@/lib/socket';

const SUIT_SYMBOL: Record<CardView['suit'], string> = {
  CLUBS: '♣',
  DIAMONDS: '♦',
  HEARTS: '♥',
  SPADES: '♠',
};

function PlayingCard({ card }: { card: CardView | null }) {
  if (!card) {
    return (
      <div className="flex h-24 w-16 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-950 shadow-lg">
        <span className="text-2xl text-emerald-300/50">Y</span>
      </div>
    );
  }

  const red = card.suit === 'HEARTS' || card.suit === 'DIAMONDS';
  return (
    <div className={`flex h-24 w-16 flex-col justify-between rounded-xl bg-slate-50 p-2 shadow-lg ${red ? 'text-red-600' : 'text-slate-950'}`}>
      <span className="text-lg font-bold leading-none">{card.rank}</span>
      <span className="self-center text-3xl leading-none">{SUIT_SYMBOL[card.suit]}</span>
      <span className="self-end rotate-180 text-lg font-bold leading-none">{card.rank}</span>
    </div>
  );
}

function resultLabel(result: BlackjackStateView['players'][number]['result'], net: number): string | null {
  if (!result) return null;
  if (result === 'BLACKJACK') return `Blackjack · +${net}`;
  if (result === 'WIN') return `Win · +${net}`;
  if (result === 'PUSH') return 'Push';
  if (result === 'BUST') return `Bust · ${net}`;
  return `Loss · ${net}`;
}

interface BlackjackTableProps {
  room: RoomView;
  playerId: string;
  state: BlackjackStateView;
  socket: YoppiSocket;
  onError: (message: string | null) => void;
}

export function BlackjackTable({ room, playerId, state, socket, onError }: BlackjackTableProps) {
  const [bet, setBet] = useState(state.minBet);
  const [pending, setPending] = useState(false);
  const you = useMemo(() => state.players.find((player) => player.playerId === playerId), [playerId, state.players]);

  function can(action: BlackjackAction): boolean {
    return state.allowedActions.includes(action);
  }

  async function command(
    event: 'blackjack:hit' | 'blackjack:stand' | 'blackjack:double' | 'blackjack:nextRound',
  ) {
    if (pending) return;
    setPending(true);
    onError(null);
    const result = await new Promise<CommandAck>((resolve) => socket.emit(event, { roomId: room.id }, resolve));
    if (!result.ok) onError(result.error.message);
    setPending(false);
  }

  async function placeBet() {
    if (pending) return;
    setPending(true);
    onError(null);
    const result = await new Promise<CommandAck>((resolve) => {
      socket.emit('blackjack:bet', { roomId: room.id, amount: bet }, resolve);
    });
    if (!result.ok) onError(result.error.message);
    setPending(false);
  }

  const phaseLabel = {
    BETTING: 'Place bets',
    PLAYER_TURNS: state.currentPlayerId === playerId ? 'Your turn' : 'Player turn',
    DEALER_TURN: 'Dealer turn',
    ROUND_COMPLETE: 'Round complete',
  }[state.phase];

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-300/15 bg-emerald-950/40 shadow-2xl">
      <div className="border-b border-white/10 bg-black/15 px-6 py-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Blackjack · round {state.round}</p>
            <h2 className="mt-1 text-2xl font-semibold">{phaseLabel}</h2>
          </div>
          <div className="text-right text-sm text-slate-300">
            <p>Dealer stands on soft 17</p>
            <p className="text-slate-500">Bet {state.minBet}–{state.maxBet} · 3:2 blackjack</p>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 sm:px-8">
        <div className="mx-auto max-w-xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Dealer</p>
          <div className="mt-4 flex min-h-24 justify-center gap-2">
            {state.dealer.cards.length === 0 ? (
              <p className="self-center text-sm text-slate-500">Waiting for bets</p>
            ) : (
              state.dealer.cards.map((card, index) => <PlayingCard key={index} card={card} />)
            )}
          </div>
          {state.dealer.total !== null && <p className="mt-3 text-sm font-medium text-slate-300">Total {state.dealer.total}</p>}
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {state.players.map((player) => {
            const active = state.currentPlayerId === player.playerId;
            const isYou = player.playerId === playerId;
            return (
              <article
                key={player.playerId}
                className={`rounded-2xl border p-5 ${active ? 'border-emerald-300/50 bg-emerald-300/10' : 'border-white/10 bg-black/10'}`}
                data-testid={`blackjack-player-${player.playerId}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{player.displayName}</h3>
                      {isYou && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">You</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{player.chips} chips · bet {player.bet}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">{player.status}</span>
                </div>

                <div className="mt-5 flex min-h-24 flex-wrap gap-2">
                  {player.cards.map((card, index) => <PlayingCard key={index} card={card} />)}
                </div>
                {player.cards.length > 0 && <p className="mt-3 text-sm text-slate-300">Total {player.total}{player.soft ? ' · soft' : ''}</p>}
                {resultLabel(player.result, player.net) && (
                  <p className="mt-3 font-semibold text-emerald-300" data-testid={`blackjack-result-${player.playerId}`}>
                    {resultLabel(player.result, player.net)}
                  </p>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          {can('BET') && you ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-2 text-sm text-slate-300">
                Bet amount
                <input
                  aria-label="Bet amount"
                  type="number"
                  min={state.minBet}
                  max={Math.min(state.maxBet, you.chips)}
                  step={10}
                  value={bet}
                  onChange={(event) => setBet(Number(event.target.value))}
                  className="w-36 rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
                />
              </label>
              <button
                disabled={pending || bet < state.minBet || bet > state.maxBet || bet > you.chips}
                onClick={() => void placeBet()}
                className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                Place bet
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              {can('HIT') && <button disabled={pending} onClick={() => void command('blackjack:hit')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Hit</button>}
              {can('STAND') && <button disabled={pending} onClick={() => void command('blackjack:stand')} className="rounded-xl border border-white/20 px-5 py-3 font-semibold disabled:opacity-50">Stand</button>}
              {can('DOUBLE') && <button disabled={pending} onClick={() => void command('blackjack:double')} className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-5 py-3 font-semibold text-amber-200 disabled:opacity-50">Double</button>}
              {can('NEXT_ROUND') && <button disabled={pending} onClick={() => void command('blackjack:nextRound')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Next round</button>}
              {state.allowedActions.length === 0 && (
                <p className="py-2 text-sm text-slate-400">
                  {state.phase === 'BETTING' ? 'Waiting for the other players to bet.' : state.phase === 'ROUND_COMPLETE' ? 'Waiting for the host to start the next round.' : 'Waiting for the current player.'}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
