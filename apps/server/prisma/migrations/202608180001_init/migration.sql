CREATE TYPE "GameType" AS ENUM ('BLACKJACK', 'POKER');
CREATE TYPE "RoomStatus" AS ENUM ('WAITING', 'ACTIVE', 'COMPLETE', 'CLOSED');

CREATE TABLE "Player" (
  "id" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "sessionTokenHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Room" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "gameType" "GameType" NOT NULL,
  "status" "RoomStatus" NOT NULL DEFAULT 'WAITING',
  "hostId" TEXT NOT NULL,
  "maxPlayers" INTEGER NOT NULL,
  "config" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoomMember" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "seat" INTEGER NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GameSession" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "gameType" "GameType" NOT NULL,
  "config" JSONB NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Player_sessionTokenHash_key" ON "Player"("sessionTokenHash");
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");
CREATE UNIQUE INDEX "RoomMember_roomId_playerId_key" ON "RoomMember"("roomId", "playerId");
CREATE UNIQUE INDEX "RoomMember_roomId_seat_key" ON "RoomMember"("roomId", "seat");

ALTER TABLE "Room"
  ADD CONSTRAINT "Room_hostId_fkey"
  FOREIGN KEY ("hostId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RoomMember"
  ADD CONSTRAINT "RoomMember_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RoomMember"
  ADD CONSTRAINT "RoomMember_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GameSession"
  ADD CONSTRAINT "GameSession_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
