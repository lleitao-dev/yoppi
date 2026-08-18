import type { Card } from '@yoppi/game-types';
import type {
  BlackjackAction,
  BlackjackPlayerStatus,
  BlackjackResult,
  BlackjackStateView,
  ServerErrorCode,
} from '@yoppi/protocol';
import { createShoe, drawCard } from './cards';
import { valueHand } from './hand';

export interface BlackjackEnginePlayer {
  playerId: string;
  displayName: string;
  seat: number;
}

interface PlayerState extends BlackjackEnginePlayer {
  chips: number;
  bet: number;
  cards: Card[];
  status: BlackjackPlayerStatus;
  result: BlackjackResult | null;
  net: number;
}

export interface BlackjackEngineOptions {
  roomId: string;
  hostPlayerId: string;
  players: BlackjackEnginePlayer[];
  startingChips?: number;
  minBet?: number;
  maxBet?: number;
  deckCount?: number;
  shoe?: Card[];
}

const BET_INCREMENT = 10;

export class BlackjackEngineError extends Error {
  constructor(
    public readonly code: Extract<
      ServerErrorCode,
      'INVALID_ACTION' | 'INVALID_BET' | 'INSUFFICIENT_CHIPS' | 'NOT_YOUR_TURN'
    >,
    message: string,
  ) {
    super(message);
  }
}

export class BlackjackEngine {
  readonly roomId: string;
  private hostPlayerId: string;
  readonly minBet: number;
  readonly maxBet: number;

  private readonly deckCount: number;
  private readonly startingChips: number;
  private readonly leavingPlayerIds = new Set<string>();
  private shoe: Card[];
  private players: PlayerState[];
  private dealerCards: Card[] = [];
  private currentPlayerId: string | null = null;
  private revision = 0;
  private round = 1;
  private phase: BlackjackStateView['phase'] = 'BETTING';

  constructor(options: BlackjackEngineOptions) {
    if (options.players.length < 1 || options.players.length > 5) {
      throw new Error('Blackjack requires between one and five players.');
    }

    this.roomId = options.roomId;
    this.hostPlayerId = options.hostPlayerId;
    this.minBet = options.minBet ?? 10;
    this.maxBet = options.maxBet ?? 250;
    this.deckCount = options.deckCount ?? 6;
    this.shoe = options.shoe ? [...options.shoe] : createShoe(this.deckCount);
    this.startingChips = options.startingChips ?? 1000;

    this.players = [...options.players]
      .sort((a, b) => a.seat - b.seat)
      .map((player) => ({
        ...player,
        chips: this.startingChips,
        bet: 0,
        cards: [],
        status: this.startingChips >= this.minBet ? 'BETTING' : 'OUT',
        result: null,
        net: 0,
      }));
  }

  placeBet(playerId: string, amount: number): void {
    if (this.leavingPlayerIds.has(playerId)) this.invalidAction('This player is leaving the table.');
    if (this.phase !== 'BETTING') this.invalidAction('Bets are closed for this round.');
    const player = this.player(playerId);
    if (player.status === 'OUT') this.invalidAction('This player does not have enough chips to bet.');
    if (player.bet > 0) this.invalidAction('A bet has already been placed for this round.');
    if (!Number.isInteger(amount) || amount < this.minBet || amount > this.maxBet || amount % BET_INCREMENT !== 0) {
      throw new BlackjackEngineError(
        'INVALID_BET',
        `Bet must be a multiple of ${BET_INCREMENT} between ${this.minBet} and ${this.maxBet}.`,
      );
    }
    if (amount > player.chips) {
      throw new BlackjackEngineError('INSUFFICIENT_CHIPS', 'Insufficient chips for that bet.');
    }

    player.chips -= amount;
    player.bet = amount;
    this.bump();

    this.maybeDealInitialCards();
  }

  hit(playerId: string): void {
    const player = this.assertTurn(playerId);
    player.cards.push(this.draw());
    const value = valueHand(player.cards);
    if (value.bust) {
      player.status = 'BUST';
      player.result = 'BUST';
      player.net = -player.bet;
      this.advanceTurn();
      return;
    }
    if (value.total === 21) {
      player.status = 'STANDING';
      this.advanceTurn();
      return;
    }
    this.bump();
  }

  stand(playerId: string): void {
    const player = this.assertTurn(playerId);
    player.status = 'STANDING';
    this.advanceTurn();
  }

  doubleDown(playerId: string): void {
    const player = this.assertTurn(playerId);
    if (player.cards.length !== 2) this.invalidAction('Double down is only available on the first two cards.');
    if (player.chips < player.bet) {
      throw new BlackjackEngineError('INSUFFICIENT_CHIPS', 'Insufficient chips to double down.');
    }

    player.chips -= player.bet;
    player.bet *= 2;
    player.cards.push(this.draw());
    const value = valueHand(player.cards);
    if (value.bust) {
      player.status = 'BUST';
      player.result = 'BUST';
      player.net = -player.bet;
    } else {
      player.status = 'STANDING';
    }
    this.advanceTurn();
  }

  beginNextRound(playerId: string): void {
    if (playerId !== this.hostPlayerId) this.invalidAction('Only the room host can start the next round.');
    if (this.phase !== 'ROUND_COMPLETE') this.invalidAction('The current round is still in progress.');

    this.round += 1;
    this.phase = 'BETTING';
    this.currentPlayerId = null;
    this.dealerCards = [];
    if (this.shoe.length < 52) this.shoe = createShoe(this.deckCount);

    for (const player of this.players) {
      player.bet = 0;
      player.cards = [];
      player.result = null;
      player.net = 0;
      player.status = player.chips >= this.minBet ? 'BETTING' : 'OUT';
    }
    this.bump();
  }

  requestLeave(playerId: string): boolean {
    const player = this.players.find((candidate) => candidate.playerId === playerId);
    if (!player || this.leavingPlayerIds.has(playerId)) return false;

    this.leavingPlayerIds.add(playerId);

    if (this.phase === 'BETTING') {
      if (player.bet === 0) player.status = 'OUT';
      this.bump();
      this.maybeDealInitialCards();
      return true;
    }

    if (this.phase === 'PLAYER_TURNS' && player.status === 'PLAYING') {
      player.status = 'STANDING';
      if (this.currentPlayerId === playerId) this.advanceTurn();
      else this.bump();
      return true;
    }

    this.bump();
    return true;
  }

  isAdmissionBoundary(): boolean {
    return this.phase === 'ROUND_COMPLETE';
  }

  syncPlayers(players: BlackjackEnginePlayer[]): void {
    if (!this.isAdmissionBoundary()) {
      throw new Error('Blackjack participants can only be synchronized at a round boundary.');
    }

    const desired = new Map(players.map((player) => [player.playerId, player]));
    const existing = new Map(this.players.map((player) => [player.playerId, player]));
    const next: PlayerState[] = [];
    let changed = false;

    for (const player of players) {
      const current = existing.get(player.playerId);
      if (current) {
        if (current.displayName !== player.displayName || current.seat !== player.seat) changed = true;
        current.displayName = player.displayName;
        current.seat = player.seat;
        next.push(current);
        continue;
      }

      changed = true;
      next.push({
        ...player,
        chips: this.startingChips,
        bet: 0,
        cards: [],
        status: this.startingChips >= this.minBet ? 'BETTING' : 'OUT',
        result: null,
        net: 0,
      });
    }

    if (this.players.some((player) => !desired.has(player.playerId))) changed = true;
    this.players = next.sort((a, b) => a.seat - b.seat);

    for (const leavingId of [...this.leavingPlayerIds]) {
      if (!desired.has(leavingId)) this.leavingPlayerIds.delete(leavingId);
    }

    if (changed) this.bump();
  }

  setHostPlayerId(playerId: string): void {
    if (this.hostPlayerId === playerId) return;
    this.hostPlayerId = playerId;
    this.bump();
  }

  autoStand(playerId: string): boolean {
    if (this.phase !== 'PLAYER_TURNS' || this.currentPlayerId !== playerId) return false;
    this.stand(playerId);
    return true;
  }

  getView(viewerPlayerId: string): BlackjackStateView {
    const revealDealer = this.phase === 'DEALER_TURN' || this.phase === 'ROUND_COMPLETE';
    const dealerValue = revealDealer ? valueHand(this.dealerCards) : null;

    return {
      roomId: this.roomId,
      round: this.round,
      revision: this.revision,
      phase: this.phase,
      currentPlayerId: this.currentPlayerId,
      minBet: this.minBet,
      maxBet: this.maxBet,
      dealer: {
        cards: revealDealer
          ? [...this.dealerCards]
          : this.dealerCards.map((card, index) => (index === 1 ? null : card)),
        total: dealerValue?.total ?? null,
        soft: dealerValue?.soft ?? null,
      },
      players: this.players.map((player) => {
        const value = valueHand(player.cards);
        return {
          playerId: player.playerId,
          displayName: player.displayName,
          seat: player.seat,
          chips: player.chips,
          bet: player.bet,
          cards: [...player.cards],
          total: value.total,
          soft: value.soft,
          status: player.status,
          result: player.result,
          net: player.net,
        };
      }),
      allowedActions: this.allowedActions(viewerPlayerId),
    };
  }

  private allowedActions(playerId: string): BlackjackAction[] {
    if (this.leavingPlayerIds.has(playerId)) return [];
    if (this.phase === 'ROUND_COMPLETE' && playerId === this.hostPlayerId) return ['NEXT_ROUND'];

    const player = this.players.find((candidate) => candidate.playerId === playerId);
    if (!player) return [];

    if (this.phase === 'BETTING' && player.status === 'BETTING' && player.bet === 0) return ['BET'];
    if (this.phase !== 'PLAYER_TURNS' || this.currentPlayerId !== playerId) return [];

    const actions: BlackjackAction[] = ['HIT', 'STAND'];
    if (player.cards.length === 2 && player.chips >= player.bet) actions.push('DOUBLE');
    return actions;
  }

  private maybeDealInitialCards(): void {
    if (this.phase !== 'BETTING') return;
    if (!this.players.every((candidate) => candidate.status === 'OUT' || candidate.bet > 0)) return;

    const active = this.players.filter((player) => player.bet > 0);
    if (active.length === 0) {
      this.phase = 'ROUND_COMPLETE';
      this.currentPlayerId = null;
      this.dealerCards = [];
      this.bump();
      return;
    }
    this.dealInitialCards();
  }

  private dealInitialCards(): void {
    const active = this.players.filter((player) => player.bet > 0);
    for (const player of active) player.cards.push(this.draw());
    this.dealerCards.push(this.draw());
    for (const player of active) player.cards.push(this.draw());
    this.dealerCards.push(this.draw());

    for (const player of active) {
      const blackjack = valueHand(player.cards).blackjack;
      player.status = blackjack ? 'BLACKJACK' : this.leavingPlayerIds.has(player.playerId) ? 'STANDING' : 'PLAYING';
    }

    if (valueHand(this.dealerCards).blackjack) {
      this.runDealerAndSettle();
      return;
    }

    const first = this.players.find((player) => player.status === 'PLAYING');
    if (!first) {
      this.runDealerAndSettle();
      return;
    }

    this.phase = 'PLAYER_TURNS';
    this.currentPlayerId = first.playerId;
    this.bump();
  }

  private assertTurn(playerId: string): PlayerState {
    if (this.leavingPlayerIds.has(playerId)) this.invalidAction('This player is leaving the table.');
    if (this.phase !== 'PLAYER_TURNS' || this.currentPlayerId !== playerId) {
      throw new BlackjackEngineError('NOT_YOUR_TURN', 'It is not your turn.');
    }
    return this.player(playerId);
  }

  private advanceTurn(): void {
    const currentIndex = this.players.findIndex((player) => player.playerId === this.currentPlayerId);
    const next = this.players.slice(currentIndex + 1).find((player) => player.status === 'PLAYING');
    if (next) {
      this.currentPlayerId = next.playerId;
      this.bump();
      return;
    }
    this.runDealerAndSettle();
  }

  private runDealerAndSettle(): void {
    this.phase = 'DEALER_TURN';
    this.currentPlayerId = null;

    const livePlayers = this.players.some(
      (player) => player.bet > 0 && player.status !== 'BUST' && player.status !== 'BLACKJACK',
    );
    if (livePlayers) {
      let dealer = valueHand(this.dealerCards);
      while (dealer.total < 17) {
        this.dealerCards.push(this.draw());
        dealer = valueHand(this.dealerCards);
      }
    }

    this.settle();
  }

  private settle(): void {
    const dealer = valueHand(this.dealerCards);

    for (const player of this.players) {
      if (player.bet === 0) continue;
      const hand = valueHand(player.cards);

      if (player.status === 'BUST') {
        player.result = 'BUST';
        player.net = -player.bet;
      } else if (hand.blackjack && dealer.blackjack) {
        player.chips += player.bet;
        player.result = 'PUSH';
        player.net = 0;
      } else if (hand.blackjack) {
        const winnings = (player.bet * 3) / 2;
        player.chips += player.bet + winnings;
        player.result = 'BLACKJACK';
        player.net = winnings;
      } else if (dealer.blackjack) {
        player.result = 'LOSE';
        player.net = -player.bet;
      } else if (dealer.bust || hand.total > dealer.total) {
        player.chips += player.bet * 2;
        player.result = 'WIN';
        player.net = player.bet;
      } else if (hand.total === dealer.total) {
        player.chips += player.bet;
        player.result = 'PUSH';
        player.net = 0;
      } else {
        player.result = 'LOSE';
        player.net = -player.bet;
      }

      player.status = player.status === 'BUST' ? 'BUST' : 'DONE';
    }

    this.phase = 'ROUND_COMPLETE';
    this.bump();
  }

  private draw(): Card {
    if (this.shoe.length === 0) this.shoe = createShoe(this.deckCount);
    return drawCard(this.shoe);
  }

  private player(playerId: string): PlayerState {
    const player = this.players.find((candidate) => candidate.playerId === playerId);
    if (!player) this.invalidAction('Player is not seated at this table.');
    return player as PlayerState;
  }

  private invalidAction(message: string): never {
    throw new BlackjackEngineError('INVALID_ACTION', message);
  }

  private bump(): void {
    this.revision += 1;
  }
}
