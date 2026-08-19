import type { Card } from '@yoppi/game-types';
import type {
  PokerAction,
  PokerHandCategory,
  PokerPhase,
  PokerStateView,
  ServerErrorCode,
} from '@yoppi/protocol';
import { createPokerDeck } from './cards';
import { compareHands, evaluateBest, type EvaluatedHand } from './evaluator';
import { buildSidePots } from './pots';

export interface PokerEnginePlayer {
  playerId: string;
  displayName: string;
  seat: number;
}

export interface PokerEngineOptions {
  roomId: string;
  hostPlayerId: string;
  players: PokerEnginePlayer[];
  startingChips?: number;
  smallBlind?: number;
  bigBlind?: number;
  turnTimeoutMs?: number;
  deck?: Card[];
}

interface PlayerState extends PokerEnginePlayer {
  stack: number;
  streetBet: number;
  contributed: number;
  folded: boolean;
  allIn: boolean;
  connected: boolean;
  cards: [Card, Card];
  handCategory: PokerHandCategory | null;
  won: number;
}

export class PokerEngineError extends Error {
  constructor(public readonly code: ServerErrorCode, message: string) {
    super(message);
  }
}

export class PokerEngine {
  readonly roomId: string;
  readonly startingChips: number;
  readonly smallBlind: number;
  readonly bigBlind: number;
  readonly turnTimeoutMs: number;

  private hostPlayerId: string;
  private players: PlayerState[];
  private phase: PokerPhase = 'PREFLOP';
  private hand = 0;
  private revision = 0;
  private dealerPlayerId = '';
  private board: Card[] = [];
  private deck: Card[] = [];
  private injectedDeck: Card[] | null;
  private currentBet = 0;
  private minRaiseSize: number;
  private currentPlayerId: string | null = null;
  private turnDeadline: string | null = null;
  private acted = new Set<string>();
  private leavingPlayerIds = new Set<string>();

  constructor(options: PokerEngineOptions) {
    if (options.players.length < 2 || options.players.length > 6) {
      throw new Error('Poker requires between two and six players.');
    }
    this.roomId = options.roomId;
    this.hostPlayerId = options.hostPlayerId;
    this.startingChips = options.startingChips ?? 1000;
    this.smallBlind = options.smallBlind ?? 10;
    this.bigBlind = options.bigBlind ?? 20;
    this.turnTimeoutMs = options.turnTimeoutMs ?? 30_000;
    this.minRaiseSize = this.bigBlind;
    this.injectedDeck = options.deck ? [...options.deck] : null;
    this.players = [...options.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({
        ...player,
        stack: this.startingChips,
        streetBet: 0,
        contributed: 0,
        folded: false,
        allIn: false,
        connected: true,
        cards: [{ suit: 'CLUBS', rank: '2' }, { suit: 'CLUBS', rank: '2' }],
        handCategory: null,
        won: 0,
      }));
    this.beginHandInternal();
  }

  check(playerId: string): void {
    const player = this.assertTurn(playerId);
    if (player.streetBet !== this.currentBet) this.invalid('You must call, raise, or fold.');
    this.acted.add(playerId);
    this.finishAction(playerId);
  }

  call(playerId: string): void {
    const player = this.assertTurn(playerId);
    const due = this.currentBet - player.streetBet;
    if (due <= 0) this.invalid('There is nothing to call.');
    this.commit(player, Math.min(due, player.stack));
    this.acted.add(playerId);
    this.finishAction(playerId);
  }

  bet(playerId: string, amount: number): void {
    const player = this.assertTurn(playerId);
    if (this.currentBet !== 0) this.invalid('Use raise when a bet is already open.');
    if (!Number.isInteger(amount) || amount <= 0 || amount > player.stack) this.invalid('Invalid bet amount.');
    if (amount < this.bigBlind && amount !== player.stack) this.invalid(`Minimum bet is ${this.bigBlind}.`);
    this.commit(player, amount);
    this.currentBet = player.streetBet;
    this.minRaiseSize = Math.max(this.bigBlind, amount);
    this.acted = new Set([playerId]);
    this.finishAction(playerId);
  }

  raise(playerId: string, raiseTo: number): void {
    const player = this.assertTurn(playerId);
    if (this.currentBet <= 0) this.invalid('Use bet to open the betting.');
    if (this.acted.has(playerId)) this.invalid('Betting has not been reopened for another raise.');
    if (!Number.isInteger(raiseTo) || raiseTo <= this.currentBet) this.invalid('Raise must exceed the current bet.');
    const cost = raiseTo - player.streetBet;
    if (cost > player.stack) this.invalid('Insufficient chips for that raise.');
    const raiseSize = raiseTo - this.currentBet;
    if (raiseSize < this.minRaiseSize && cost !== player.stack) {
      this.invalid(`Minimum raise-to amount is ${this.currentBet + this.minRaiseSize}.`);
    }
    this.commit(player, cost);
    this.currentBet = raiseTo;
    if (raiseSize >= this.minRaiseSize) {
      this.minRaiseSize = raiseSize;
      this.acted = new Set([playerId]);
    } else {
      this.acted.add(playerId);
    }
    this.finishAction(playerId);
  }

  fold(playerId: string): void {
    const player = this.assertTurn(playerId);
    player.folded = true;
    this.acted.add(playerId);
    this.finishAction(playerId);
  }

  allIn(playerId: string): void {
    const player = this.assertTurn(playerId);
    if (player.stack <= 0) this.invalid('You have no chips remaining.');
    const target = player.streetBet + player.stack;
    const previousBet = this.currentBet;
    const raiseSize = target - previousBet;
    if (target > previousBet && this.acted.has(playerId)) {
      this.invalid('Betting has not been reopened for another raise.');
    }
    this.commit(player, player.stack);
    if (target > previousBet) {
      this.currentBet = target;
      if (previousBet === 0 || raiseSize >= this.minRaiseSize) {
        this.minRaiseSize = Math.max(this.bigBlind, raiseSize);
        this.acted = new Set([playerId]);
      } else {
        this.acted.add(playerId);
      }
    } else {
      this.acted.add(playerId);
    }
    this.finishAction(playerId);
  }

  beginNextHand(playerId: string): void {
    if (playerId !== this.hostPlayerId) this.invalid('Only the room host can start the next hand.');
    if (this.phase !== 'HAND_COMPLETE') this.invalid('The current hand is still in progress.');
    if (this.players.filter((player) => player.stack > 0 && !this.leavingPlayerIds.has(player.playerId)).length < 2) {
      this.invalid('At least two players with chips are required for another hand.');
    }
    this.beginHandInternal();
  }

  timeoutCurrentPlayer(now = Date.now()): boolean {
    if (!this.currentPlayerId || !this.turnDeadline || now < new Date(this.turnDeadline).getTime()) return false;
    const player = this.players.find((entry) => entry.playerId === this.currentPlayerId);
    if (!player) return false;
    if (player.streetBet === this.currentBet) this.check(player.playerId);
    else this.fold(player.playerId);
    return true;
  }

  requestLeave(playerId: string): boolean {
    const player = this.players.find((entry) => entry.playerId === playerId);
    if (!player || this.leavingPlayerIds.has(playerId)) return false;
    this.leavingPlayerIds.add(playerId);
    player.connected = false;
    if (this.phase !== 'HAND_COMPLETE' && !player.folded) {
      player.folded = true;
      this.acted.add(playerId);
      if (this.currentPlayerId === playerId) this.finishAction(playerId);
      else {
        this.bump();
        this.maybeFinishByFold();
      }
    } else {
      this.bump();
    }
    return true;
  }

  playerDisconnected(playerId: string): boolean {
    const player = this.players.find((entry) => entry.playerId === playerId);
    if (!player || !player.connected) return false;
    player.connected = false;
    this.bump();
    return true;
  }

  playerConnected(playerId: string): boolean {
    const player = this.players.find((entry) => entry.playerId === playerId);
    if (!player || player.connected) return false;
    player.connected = true;
    this.bump();
    return true;
  }

  isAdmissionBoundary(): boolean {
    return this.phase === 'HAND_COMPLETE';
  }

  syncPlayers(players: PokerEnginePlayer[]): void {
    if (!this.isAdmissionBoundary()) throw new Error('Poker participants can only change between hands.');
    const desired = new Map(players.map((player) => [player.playerId, player]));
    const existing = new Map(this.players.map((player) => [player.playerId, player]));
    const next: PlayerState[] = [];
    let changed = false;

    for (const player of players) {
      const current = existing.get(player.playerId);
      if (current) {
        current.displayName = player.displayName;
        current.seat = player.seat;
        next.push(current);
      } else {
        changed = true;
        next.push({
          ...player,
          stack: this.startingChips,
          streetBet: 0,
          contributed: 0,
          folded: false,
          allIn: false,
          connected: true,
          cards: [{ suit: 'CLUBS', rank: '2' }, { suit: 'CLUBS', rank: '2' }],
          handCategory: null,
          won: 0,
        });
      }
    }
    if (this.players.some((player) => !desired.has(player.playerId))) changed = true;
    this.players = next.sort((a, b) => a.seat - b.seat);
    for (const playerId of [...this.leavingPlayerIds]) if (!desired.has(playerId)) this.leavingPlayerIds.delete(playerId);
    if (changed) this.bump();
  }

  setHostPlayerId(playerId: string): void {
    if (this.hostPlayerId === playerId) return;
    this.hostPlayerId = playerId;
    this.bump();
  }

  getTurnDeadline(): string | null {
    return this.turnDeadline;
  }

  getCurrentPlayerId(): string | null {
    return this.currentPlayerId;
  }

  getView(viewerPlayerId: string): PokerStateView {
    const reveal = this.phase === 'SHOWDOWN' || this.phase === 'HAND_COMPLETE';
    const viewer = this.players.find((player) => player.playerId === viewerPlayerId);
    const callAmount = viewer && this.currentPlayerId === viewerPlayerId
      ? Math.min(viewer.stack, Math.max(0, this.currentBet - viewer.streetBet))
      : 0;
    return {
      roomId: this.roomId,
      hand: this.hand,
      revision: this.revision,
      phase: this.phase,
      dealerPlayerId: this.dealerPlayerId,
      smallBlind: this.smallBlind,
      bigBlind: this.bigBlind,
      currentBet: this.currentBet,
      minimumRaiseTo: this.currentBet === 0 ? this.bigBlind : this.currentBet + this.minRaiseSize,
      currentPlayerId: this.currentPlayerId,
      turnDeadline: this.turnDeadline,
      board: [...this.board],
      pots: buildSidePots(this.players.map((player) => ({
        playerId: player.playerId,
        amount: player.contributed,
        folded: player.folded,
      }))),
      players: this.players.map((player) => ({
        playerId: player.playerId,
        displayName: player.displayName,
        seat: player.seat,
        stack: player.stack,
        streetBet: player.streetBet,
        contributed: player.contributed,
        folded: player.folded,
        allIn: player.allIn,
        connected: player.connected,
        cards: viewerPlayerId === player.playerId || (reveal && !player.folded)
          ? [player.cards[0], player.cards[1]]
          : [null, null],
        handCategory: reveal && !player.folded ? player.handCategory : null,
        won: player.won,
      })),
      allowedActions: this.allowedActions(viewerPlayerId),
      callAmount,
    };
  }

  private beginHandInternal(): void {
    const funded = this.players.filter((player) => player.stack > 0 && !this.leavingPlayerIds.has(player.playerId));
    if (funded.length < 2) this.invalid('At least two players with chips are required.');
    const firstFunded = funded[0];
    if (!firstFunded) this.invalid('At least two players with chips are required.');

    this.hand += 1;
    this.phase = 'PREFLOP';
    this.board = [];
    this.currentBet = 0;
    this.minRaiseSize = this.bigBlind;
    this.acted.clear();
    this.deck = this.injectedDeck ? [...this.injectedDeck] : createPokerDeck();
    this.injectedDeck = null;

    for (const player of this.players) {
      player.streetBet = 0;
      player.contributed = 0;
      player.folded = player.stack <= 0 || this.leavingPlayerIds.has(player.playerId);
      player.allIn = false;
      player.handCategory = null;
      player.won = 0;
    }

    const previousDealer = this.dealerPlayerId;
    this.dealerPlayerId = previousDealer
      ? this.nextFundedPlayer(previousDealer, funded)?.playerId ?? firstFunded.playerId
      : firstFunded.playerId;

    for (let round = 0; round < 2; round += 1) {
      for (const player of this.playersInOrderAfter(this.dealerPlayerId).filter((entry) => funded.some((f) => f.playerId === entry.playerId))) {
        if (round === 0) player.cards = [this.draw(), player.cards[1]];
        else player.cards = [player.cards[0], this.draw()];
      }
    }

    const dealer = this.player(this.dealerPlayerId);
    const smallBlindPlayer = funded.length === 2 ? dealer : this.nextFundedPlayer(dealer.playerId, funded)!;
    const bigBlindPlayer = this.nextFundedPlayer(smallBlindPlayer.playerId, funded)!;
    this.postBlind(smallBlindPlayer, this.smallBlind);
    this.postBlind(bigBlindPlayer, this.bigBlind);
    this.currentBet = this.bigBlind;
    this.minRaiseSize = this.bigBlind;
    this.currentPlayerId = this.nextDecisionPlayer(bigBlindPlayer.playerId)?.playerId ?? null;
    this.setDeadline();
    this.bump();

    if (!this.currentPlayerId) this.runoutAndShowdown();
  }

  private finishAction(actorId: string): void {
    if (this.maybeFinishByFold()) return;
    if (this.streetComplete()) {
      this.advanceStreet();
      return;
    }
    this.currentPlayerId = this.nextDecisionPlayer(actorId)?.playerId ?? null;
    this.setDeadline();
    this.bump();
    if (!this.currentPlayerId) this.runoutAndShowdown();
  }

  private maybeFinishByFold(): boolean {
    const remaining = this.players.filter((player) => !player.folded);
    if (remaining.length !== 1) return false;
    const winner = remaining[0];
    if (!winner) return false;
    const amount = this.players.reduce((total, player) => total + player.contributed, 0);
    winner.stack += amount;
    winner.won += amount;
    this.phase = 'HAND_COMPLETE';
    this.currentPlayerId = null;
    this.turnDeadline = null;
    this.bump();
    return true;
  }

  private streetComplete(): boolean {
    const decisionPlayers = this.players.filter((player) => !player.folded && !player.allIn);
    if (decisionPlayers.length === 0) return true;
    return decisionPlayers.every((player) => player.streetBet === this.currentBet && this.acted.has(player.playerId));
  }

  private advanceStreet(): void {
    for (const player of this.players) player.streetBet = 0;
    this.currentBet = 0;
    this.minRaiseSize = this.bigBlind;
    this.acted.clear();

    if (this.phase === 'PREFLOP') {
      this.phase = 'FLOP';
      this.board.push(this.draw(), this.draw(), this.draw());
    } else if (this.phase === 'FLOP') {
      this.phase = 'TURN';
      this.board.push(this.draw());
    } else if (this.phase === 'TURN') {
      this.phase = 'RIVER';
      this.board.push(this.draw());
    } else if (this.phase === 'RIVER') {
      this.runoutAndShowdown();
      return;
    }

    const active = this.players.filter((player) => !player.folded && !player.allIn);
    if (active.length <= 1) {
      this.runoutAndShowdown();
      return;
    }
    this.currentPlayerId = this.nextDecisionPlayer(this.dealerPlayerId)?.playerId ?? null;
    this.setDeadline();
    this.bump();
    if (!this.currentPlayerId) this.runoutAndShowdown();
  }

  private runoutAndShowdown(): void {
    while (this.board.length < 5) this.board.push(this.draw());
    this.phase = 'SHOWDOWN';
    this.currentPlayerId = null;
    this.turnDeadline = null;

    const evaluations = new Map<string, EvaluatedHand>();
    for (const player of this.players.filter((entry) => !entry.folded)) {
      const evaluated = evaluateBest([...player.cards, ...this.board]);
      evaluations.set(player.playerId, evaluated);
      player.handCategory = evaluated.category;
    }

    const pots = buildSidePots(this.players.map((player) => ({
      playerId: player.playerId,
      amount: player.contributed,
      folded: player.folded,
    })));

    for (const pot of pots) {
      const eligible = pot.eligiblePlayerIds
        .map((playerId) => ({ player: this.player(playerId), hand: evaluations.get(playerId)! }))
        .filter((entry) => Boolean(entry.hand));
      const firstEligible = eligible[0];
      if (!firstEligible) continue;
      let best = firstEligible.hand;
      for (const entry of eligible.slice(1)) if (compareHands(entry.hand, best) > 0) best = entry.hand;
      const winners = eligible.filter((entry) => compareHands(entry.hand, best) === 0).map((entry) => entry.player);
      const share = Math.floor(pot.amount / winners.length);
      let remainder = pot.amount % winners.length;
      const ordered = this.playersInOrderAfter(this.dealerPlayerId).filter((candidate) => winners.some((winner) => winner.playerId === candidate.playerId));
      for (const winner of ordered) {
        const award = share + (remainder > 0 ? 1 : 0);
        remainder = Math.max(0, remainder - 1);
        winner.stack += award;
        winner.won += award;
      }
    }

    this.phase = 'HAND_COMPLETE';
    this.bump();
  }

  private assertTurn(playerId: string): PlayerState {
    if (this.phase === 'HAND_COMPLETE' || this.phase === 'SHOWDOWN') this.invalid('The hand is complete.');
    if (this.currentPlayerId !== playerId) throw new PokerEngineError('NOT_YOUR_TURN', 'It is not your turn.');
    const player = this.player(playerId);
    if (player.folded || player.allIn) this.invalid('You cannot act in this hand.');
    if (this.leavingPlayerIds.has(playerId)) this.invalid('You are leaving this table.');
    return player;
  }

  private allowedActions(playerId: string): PokerAction[] {
    if (this.phase === 'HAND_COMPLETE' && playerId === this.hostPlayerId) return ['NEXT_HAND'];
    if (this.currentPlayerId !== playerId || this.leavingPlayerIds.has(playerId)) return [];
    const player = this.players.find((entry) => entry.playerId === playerId);
    if (!player || player.folded || player.allIn) return [];
    const due = this.currentBet - player.streetBet;
    const actions: PokerAction[] = ['FOLD'];
    if (due === 0) actions.unshift('CHECK');
    else actions.unshift('CALL');
    if (this.currentBet === 0 && player.stack > 0) actions.push('BET');
    const allInTarget = player.streetBet + player.stack;
    if (allInTarget <= this.currentBet || !this.acted.has(playerId)) actions.push('ALL_IN');
    if (this.currentBet > 0 && allInTarget > this.currentBet && !this.acted.has(playerId)) actions.push('RAISE');
    return actions;
  }

  private commit(player: PlayerState, amount: number): void {
    if (amount < 0 || amount > player.stack) this.invalid('Invalid chip commitment.');
    player.stack -= amount;
    player.streetBet += amount;
    player.contributed += amount;
    if (player.stack === 0) player.allIn = true;
  }

  private postBlind(player: PlayerState, blind: number): void {
    this.commit(player, Math.min(blind, player.stack));
  }

  private nextDecisionPlayer(afterPlayerId: string): PlayerState | null {
    return this.playersInOrderAfter(afterPlayerId).find((player) => !player.folded && !player.allIn) ?? null;
  }

  private nextFundedPlayer(afterPlayerId: string, funded: PlayerState[]): PlayerState | null {
    return this.playersInOrderAfter(afterPlayerId).find((player) => funded.some((candidate) => candidate.playerId === player.playerId)) ?? null;
  }

  private playersInOrderAfter(playerId: string): PlayerState[] {
    if (this.players.length === 0) return [];
    const sorted = [...this.players].sort((a, b) => a.seat - b.seat);
    const index = sorted.findIndex((player) => player.playerId === playerId);
    if (index < 0) return sorted;
    return [...sorted.slice(index + 1), ...sorted.slice(0, index + 1)];
  }

  private draw(): Card {
    const card = this.deck.pop();
    if (!card) throw new Error('Poker deck exhausted.');
    return card;
  }

  private player(playerId: string): PlayerState {
    const player = this.players.find((entry) => entry.playerId === playerId);
    if (!player) throw new PokerEngineError('INVALID_ACTION', 'Player is not seated in this game.');
    return player;
  }

  private setDeadline(): void {
    this.turnDeadline = this.currentPlayerId ? new Date(Date.now() + this.turnTimeoutMs).toISOString() : null;
  }

  private invalid(message: string): never {
    throw new PokerEngineError('INVALID_ACTION', message);
  }

  private bump(): void {
    this.revision += 1;
  }
}
