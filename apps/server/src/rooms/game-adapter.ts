import type { GameType, RoomView } from '@yoppi/protocol';
import { blackjackGames } from '../games/blackjack/game-manager';

export interface RoomGameAdapter {
  readonly gameType: GameType;
  requestLeave(roomId: string, playerId: string): boolean;
  isAdmissionBoundary(roomId: string): boolean;
  syncParticipants(room: RoomView): void;
  stop(roomId: string): void;
}

const blackjackAdapter: RoomGameAdapter = {
  gameType: 'BLACKJACK',
  requestLeave(roomId, playerId) {
    return blackjackGames.requestLeave(roomId, playerId);
  },
  isAdmissionBoundary(roomId) {
    return blackjackGames.isAdmissionBoundary(roomId);
  },
  syncParticipants(room) {
    blackjackGames.syncParticipants(room);
  },
  stop(roomId) {
    blackjackGames.delete(roomId);
  },
};

export function getRoomGameAdapter(gameType: GameType): RoomGameAdapter | null {
  if (gameType === 'BLACKJACK') return blackjackAdapter;
  return null;
}
