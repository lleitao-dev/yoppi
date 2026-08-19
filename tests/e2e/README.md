# Yoppi end-to-end tests

Run the Docker Compose stack first, then execute:

```bash
pnpm test:e2e
```

Coverage includes independent browser contexts for Blackjack and Texas Hold'em, room creation/joining, active host transfer, reconnects, queued admission at game boundaries, and deliberate leave behavior.
