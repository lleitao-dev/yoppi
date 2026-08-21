import { RoomEntry } from '@/components/room-entry';

export default function BlackjackEntryPage() {
  return (
    <RoomEntry
      gameType="BLACKJACK"
      title="Blackjack"
      description="Create a private Blackjack room or join an existing table with its room code."
    />
  );
}
