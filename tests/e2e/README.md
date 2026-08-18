# End-to-end tests

The Blackjack E2E scenario uses two isolated Playwright browser contexts to represent independent guest sessions.

With the Docker Compose stack already running:

```bash
pnpm install
pnpm exec playwright install chromium
pnpm test:e2e
```

The test creates Alice and Bob, creates/joins one Blackjack room, starts the game, places both bets, completes the round, and begins the next round.
