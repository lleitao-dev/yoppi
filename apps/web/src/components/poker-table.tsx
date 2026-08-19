'use client';

import { useEffect, useMemo, useState } from 'react';
import type {
  CardView,
  CommandAck,
  PokerAction,
  PokerHandCategory,
  PokerStateView,
  RoomView,
} from '@yoppi/protocol';
import type { YoppiSocket } from '@/lib/socket';

const SUIT_SYMBOL: Record<CardView['suit'], string> = {
  CLUBS: '♣',
  DIAMONDS: '♦',
  HEARTS: '♥',
  SPADES: '♠',
};

function PokerCard({ card }: { card: CardView | null }) {
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

const CATEGORY_LABEL: Record<PokerHandCategory, string> = {
  HIGH_CARD: 'High card',
  PAIR: 'Pair',
  TWO_PAIR: 'Two pair',
  THREE_OF_A_KIND: 'Three of a kind',
  STRAIGHT: 'Straight',
  FLUSH: 'Flush',
  FULL_HOUSE: 'Full house',
  FOUR_OF_A_KIND: 'Four of a kind',
  STRAIGHT_FLUSH: 'Straight flush',
};

function useTurnSeconds(deadline: string | null): number | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  if (!deadline) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

interface PokerTableProps {
  room: RoomView;
  playerId: string;
  state: PokerStateView;
  socket: YoppiSocket;
  onError: (message: string | null) => void;
}

export function PokerTable({ room, playerId, state, socket, onError }: PokerTableProps) {
  const [pending, setPending] = useState(false);
  const [amount, setAmount] = useState(state.minimumRaiseTo);
  const turnSeconds = useTurnSeconds(state.turnDeadline);
  const you = useMemo(() => state.players.find((player) => player.playerId === playerId) ?? null, [playerId, state.players]);
  const totalPot = useMemo(() => state.pots.reduce((sum, pot) => sum + pot.amount, 0), [state.pots]);

  useEffect(() => {
    setAmount((current) => Math.max(current, state.minimumRaiseTo));
  }, [state.minimumRaiseTo]);

  function can(action: PokerAction): boolean {
    return state.allowedActions.includes(action);
  }

  async function simpleCommand(
    event: 'poker:check' | 'poker:call' | 'poker:fold' | 'poker:allIn' | 'poker:nextHand',
  ) {
    if (pending) return;
    setPending(true);
    onError(null);
    const result = await new Promise<CommandAck>((resolve) => socket.emit(event, { roomId: room.id }, resolve));
    if (!result.ok) onError(result.error.message);
    setPending(false);
  }

  async function amountCommand(event: 'poker:bet' | 'poker:raise') {
    if (pending || !Number.isInteger(amount) || amount <= 0) return;
    setPending(true);
    onError(null);
    const result = await new Promise<CommandAck>((resolve) => socket.emit(event, { roomId: room.id, amount }, resolve));
    if (!result.ok) onError(result.error.message);
    setPending(false);
  }

  const phaseLabel: Record<PokerStateView['phase'], string> = {
    PREFLOP: 'Pre-flop',
    FLOP: 'Flop',
    TURN: 'Turn',
    RIVER: 'River',
    SHOWDOWN: 'Showdown',
    HAND_COMPLETE: 'Hand complete',
  };

  return (
    <section className="mt-8 overflow-hidden rounded-3xl border border-emerald-300/15 bg-emerald-950/40 shadow-2xl" data-testid="poker-table">
      <div className="border-b border-white/10 bg-black/15 px-6 py-4 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">Texas Hold&apos;em · hand {state.hand}</p>
            <h2 className="mt-1 text-2xl font-semibold">{phaseLabel[state.phase]}</h2>
          </div>
          <div className="text-right text-sm text-slate-300">
            <p>Blinds {state.smallBlind}/{state.bigBlind} · pot {totalPot}</p>
            <p className="text-slate-500">
              {state.currentPlayerId
                ? `Action ${turnSeconds ?? '—'}s`
                : state.phase === 'HAND_COMPLETE'
                  ? 'Awaiting next hand'
                  : 'Resolving hand'}
            </p>
          </div>
        </div>
      </div>

      <div className="px-6 py-8 sm:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Board</p>
          <div className="mt-4 flex min-h-24 flex-wrap justify-center gap-2" data-testid="poker-board">
            {state.board.map((card, index) => <PokerCard key={`${card.rank}-${card.suit}-${index}`} card={card} />)}
            {Array.from({ length: Math.max(0, 5 - state.board.length) }).map((_, index) => (
              <div key={`empty-${index}`} className="h-24 w-16 rounded-xl border border-dashed border-white/10 bg-black/10" />
            ))}
          </div>
          <p className="mt-3 text-sm text-slate-400">Current bet {state.currentBet}</p>
        </div>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {state.players.map((player) => {
            const active = state.currentPlayerId === player.playerId;
            const isYou = player.playerId === playerId;
            const dealer = state.dealerPlayerId === player.playerId;
            return (
              <article
                key={player.playerId}
                data-testid={`poker-player-${player.playerId}`}
                className={`rounded-2xl border p-5 ${active ? 'border-emerald-300/50 bg-emerald-300/10' : 'border-white/10 bg-black/10'} ${player.folded ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold">{player.displayName}</h3>
                      {isYou && <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-300">You</span>}
                      {dealer && <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-xs text-amber-200">Dealer</span>}
                    </div>
                    <p className="mt-1 text-sm text-slate-400">{player.stack} chips · committed {player.streetBet}</p>
                  </div>
                  <span className="text-xs uppercase tracking-[0.12em] text-slate-500">
                    {player.folded ? 'Folded' : player.allIn ? 'All-in' : player.connected ? 'Playing' : 'Offline'}
                  </span>
                </div>

                <div className="mt-5 flex min-h-24 gap-2">
                  {player.cards.map((card, index) => <PokerCard key={index} card={card} />)}
                </div>
                {player.handCategory && (
                  <p className="mt-3 text-sm font-medium text-emerald-200">{CATEGORY_LABEL[player.handCategory]}</p>
                )}
                {player.won > 0 && (
                  <p className="mt-2 font-semibold text-emerald-300" data-testid={`poker-won-${player.playerId}`}>Won {player.won}</p>
                )}
              </article>
            );
          })}
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
          {state.currentPlayerId === playerId && turnSeconds !== null && (
            <p className="mb-4 text-sm text-slate-400">Your action expires in <span className="font-semibold text-white">{turnSeconds}s</span>. Timeout checks when legal and otherwise folds.</p>
          )}

          <div className="flex flex-wrap items-end gap-3">
            {can('CHECK') && <button disabled={pending} onClick={() => void simpleCommand('poker:check')} className="rounded-xl border border-white/20 px-5 py-3 font-semibold disabled:opacity-50">Check</button>}
            {can('CALL') && <button disabled={pending} onClick={() => void simpleCommand('poker:call')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Call {state.callAmount}</button>}
            {can('FOLD') && <button disabled={pending} onClick={() => void simpleCommand('poker:fold')} className="rounded-xl border border-red-300/25 bg-red-300/10 px-5 py-3 font-semibold text-red-100 disabled:opacity-50">Fold</button>}
            {can('ALL_IN') && <button disabled={pending} onClick={() => void simpleCommand('poker:allIn')} className="rounded-xl border border-amber-300/30 bg-amber-300/10 px-5 py-3 font-semibold text-amber-100 disabled:opacity-50">All-in{you ? ` ${you.stack}` : ''}</button>}

            {(can('BET') || can('RAISE')) && (
              <label className="grid gap-2 text-sm text-slate-300">
                {can('BET') ? 'Bet amount' : 'Raise to'}
                <input
                  aria-label={can('BET') ? 'Bet amount' : 'Raise to'}
                  type="number"
                  min={can('BET') ? state.bigBlind : state.minimumRaiseTo}
                  max={you ? you.streetBet + you.stack : undefined}
                  step={state.bigBlind}
                  value={amount}
                  onChange={(event) => setAmount(Number(event.target.value))}
                  className="w-36 rounded-xl border border-white/15 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-400"
                />
              </label>
            )}
            {can('BET') && <button disabled={pending || amount < state.bigBlind || !you || amount > you.stack} onClick={() => void amountCommand('poker:bet')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Bet</button>}
            {can('RAISE') && <button disabled={pending || amount <= state.currentBet || !you || amount - you.streetBet > you.stack} onClick={() => void amountCommand('poker:raise')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Raise</button>}
            {can('NEXT_HAND') && <button disabled={pending} onClick={() => void simpleCommand('poker:nextHand')} className="rounded-xl bg-emerald-400 px-5 py-3 font-semibold text-emerald-950 disabled:opacity-50">Next hand</button>}

            {state.allowedActions.length === 0 && (
              <p className="py-2 text-sm text-slate-400">
                {state.phase === 'HAND_COMPLETE'
                  ? 'Waiting for the host to start the next hand.'
                  : state.currentPlayerId
                    ? 'Waiting for the current player.'
                    : 'Resolving the hand.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
