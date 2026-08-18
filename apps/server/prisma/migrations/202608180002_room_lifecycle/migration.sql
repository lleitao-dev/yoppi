CREATE TYPE "ParticipationStatus" AS ENUM ('WAITING', 'PLAYING', 'QUEUED', 'LEAVING');

ALTER TABLE "RoomMember"
  ADD COLUMN "participation" "ParticipationStatus" NOT NULL DEFAULT 'WAITING';

ALTER TABLE "RoomMember"
  ALTER COLUMN "seat" DROP NOT NULL;

UPDATE "RoomMember" AS member
SET "participation" = 'PLAYING'
FROM "Room" AS room
WHERE member."roomId" = room."id"
  AND room."status" = 'ACTIVE'
  AND member."leftAt" IS NULL;
