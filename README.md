# Yoppi Online Casino — Texas Hold'em v0.7.0

Yoppi is a multiplayer, play-money casino project. v0.7.0 adds the first complete Texas Hold'em game on top of the generic room lifecycle introduced in v0.4–v0.6.

## Included in v0.7.0

- server-authoritative No-Limit Texas Hold'em for 2–6 players
- 1,000 starting play chips with 10/20 blinds and no antes
- cryptographically shuffled 52-card deck using Node `crypto.randomInt()` and Fisher-Yates
- heads-up and multi-player dealer/blind rotation
- pre-flop, flop, turn, river, showdown, and hand-complete state transitions
- check, call, bet, raise, fold, and all-in actions
- minimum bet and minimum full-raise enforcement
- short all-in handling without incorrectly reopening betting
- side-pot construction and multi-pot showdown settlement
- five-from-seven hand evaluator with tie/kicker resolution
- private hole-card projection: opponents' cards are never sent before showdown
- server-owned 30-second action deadline; timeout checks when legal and folds when facing a bet
- deliberate leave folds the player safely and removes them at `HAND_COMPLETE`
- disconnected players retain their seat and may reconnect during the current hand
- active-room joins enter `QUEUED` and are admitted only between hands
- active host transfer is synchronized into the Poker engine
- generic game adapter now supports both Blackjack and Poker
- Poker table UI with board, hole cards, stacks, bets, pot, dealer marker, action controls, and turn countdown
- unit coverage for deck integrity, hand evaluation, side pots, turn order, street progression, privacy, timeout behavior, and lifecycle synchronization
- Playwright coverage for a two-player Poker hand and queued third-player admission

No Prisma migration is required for v0.7.0. The existing room, membership, participation, and `GameSession` models already support Poker.

## Poker rules in this MVP

- variant: No-Limit Texas Hold'em
- players: 2–6
- starting chips: 1,000
- small blind: 10
- big blind: 20
- antes: none
- action timer: 30 seconds
- supported actions: check, call, bet, raise, fold, all-in
- queued entrants join at `HAND_COMPLETE`
- deliberate leavers fold immediately and are removed at `HAND_COMPLETE`

Deferred Poker features include tournaments, paid/rebuy flows, straddles, custom blind schedules, spectators, rabbit hunting, and persistent hand history.

## Room lifecycle integration

Poker uses the same lifecycle system as Blackjack:

- any connected member may start once the game minimum is met
- existing members can reconnect to active rooms
- host ownership transfers during active games
- new active-room entrants wait in `QUEUED`
- Poker defines `HAND_COMPLETE` as its safe admission/removal boundary
- the 15-second insufficient-player grace controller uses Poker's minimum of two available players
- if the grace deadline expires, the active game session ends and surviving members return to the waiting room

## Start locally

Requirements: Docker with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: http://localhost:3000
- API health: http://localhost:4000/api/v1/health

Expected health response:

```json
{"status":"ok"}
```

## Automated tests

Inside a dependency-installed checkout:

```bash
pnpm test
pnpm typecheck
```

For browser coverage, keep Docker Compose running and use:

```bash
pnpm test:e2e
```

The Poker action timer can be changed for development with:

```env
POKER_TURN_TIMEOUT_MS=30000
```

## Persistence boundary

PostgreSQL persists room membership, participation, host ownership, and `GameSession` history. Live Blackjack and Poker state remain in the server process. A server restart during an active game still loses the current round/hand; durable active-game recovery remains a later reliability milestone.
