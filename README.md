# Yoppi Online Casino — Minimum-Player Grace v0.6.0

Yoppi is a multiplayer, play-money casino project. v0.6.0 completes the generic active-room lifecycle foundation by adding a server-authoritative minimum-player requirement and a 15-second recovery window before an under-populated active game is returned to its waiting room.

## Included in v0.6.0

- `RoomView.playerRequirement` exposes the game minimum, current connected eligible count, and server-owned grace deadline
- active requirement counting includes connected `PLAYING` and `QUEUED` members and excludes `LEAVING` members
- queued arrivals may satisfy the room minimum immediately while still waiting for the game-specific admission boundary
- a dedicated server controller starts a 15-second timer when an active room falls below its game minimum
- reconnecting or joining before the deadline cancels the timer
- the client renders the deadline as a live countdown; the browser clock is informational only
- timer expiry ends open `GameSession` records and returns remaining members to `WAITING`
- `LEAVING` memberships are finalized during an insufficient-player reset
- remaining seats are normalized before the room returns to the lobby
- the active game adapter is stopped after timeout; Blackjack discards its in-memory engine
- rooms with no remaining members close instead of returning to an empty lobby
- host ownership remains valid through the timeout reset and connected-host transfer rules still apply
- timer duration is configurable with `ROOM_MINIMUM_PLAYER_GRACE_MS`, defaulting to `15000`
- unit tests cover deadline creation, expiry, and cancellation from a queued arrival
- E2E coverage verifies Blackjack timeout after disconnect and cancellation after reconnect

No Prisma migration is required for v0.6.0. The grace deadline is transient active-game state owned by the server process; existing room and game-session fields already support the timeout transition.

## Start locally

Requirements: Docker with Docker Compose.

```bash
cp .env.example .env
docker compose up --build
```

Existing `.env` files from v0.5.0 continue to work because the server defaults `ROOM_MINIMUM_PLAYER_GRACE_MS` to 15 seconds. Add this line if you want the setting to be explicit:

```env
ROOM_MINIMUM_PLAYER_GRACE_MS=15000
```

Open:

- Web: http://localhost:3000
- API health: http://localhost:4000/api/v1/health

Expected health response:

```json
{"status":"ok"}
```

## Grace-period behavior

For an active room, Yoppi evaluates:

```text
current connected eligible players >= game minimum
```

Eligible active members are connected players whose participation is `PLAYING` or `QUEUED`.

If the requirement becomes false:

```text
ACTIVE
  -> start 15 second server timer
  -> broadcast graceDeadline
  -> player reconnects / queued player arrives -> cancel timer
  -> deadline expires -> end game session -> WAITING
```

For Blackjack the minimum is one, so the grace period normally starts only when the last eligible player disconnects or departs. Poker will use the same controller with a minimum of two.

## Manual Blackjack smoke test

1. Create a Blackjack room as a single guest.
2. Start Blackjack.
3. Close the active table tab.
4. Reconnect to the room using the same guest session within 15 seconds and confirm the room is still `ACTIVE`.
5. Close the table again and remain disconnected for more than 15 seconds.
6. Re-enter the room using its six-character code.
7. Confirm the room is now a `WAITING` room and Blackjack can be started again.

For games with a minimum above one, connected players see an on-screen countdown while the grace period is active.

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

The new grace E2E cases intentionally wait across the real 15-second server deadline.

## Active-game persistence boundary

The grace timer, live Blackjack engine, shoe, cards, balances, and turn state remain in the application server process. PostgreSQL persists room membership and completed/ended `GameSession` timing. A server restart during an active game still does not restore live game state; restart recovery remains a later reliability milestone.

## Next milestone

With room membership, queueing, host transfer, active departure, safe admission boundaries, and minimum-player recovery now defined generically, the next game-engine milestone can begin: No-Limit Texas Hold'em Poker.
