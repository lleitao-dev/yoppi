import type { GameType, RoomView } from '@yoppi/protocol';
import { blackjackGames } from '../games/blackjack/game-manager';
import { pokerGames } from '../games/poker/game-manager';

export interface RoomGameAdapter {
  readonly gameType: GameType;
  requestLeave(roomId: string, playerId: string): boolean;
  playerConnected(roomId: string, playerId: string): boolean;
  playerDisconnected(roomId: string, playerId: string): boolean;
  isAdmissionBoundary(roomId: string): boolean;
  syncParticipants(room: RoomView): void;
  setHost(roomId: string, playerId: string): void;
  terminate(roomId: string): void;
}

const blackjackAdapter: RoomGameAdapter = {
  gameType: 'BLACKJACK',
  requestLeave: (roomId, playerId) => blackjackGames.requestLeave(roomId, playerId),
  playerConnected: (roomId, playerId) => blackjackGames.playerConnected(roomId, playerId),
  playerDisconnected: (roomId, playerId) => blackjackGames.playerDisconnected(roomId, playerId),
  isAdmissionBoundary: (roomId) => blackjackGames.isAdmissionBoundary(roomId),
  syncParticipants: (room) => blackjackGames.syncParticipants(room),
  setHost: (roomId, playerId) => blackjackGames.setHost(roomId, playerId),
  terminate: (roomId) => blackjackGames.delete(roomId),
};

const pokerAdapter: RoomGameAdapter = {
  gameType: 'POKER',
  requestLeave: (roomId, playerId) => pokerGames.requestLeave(roomId, playerId),
  playerConnected: (roomId, playerId) => pokerGames.playerConnected(roomId, playerId),
  playerDisconnected: (roomId, playerId) => pokerGames.playerDisconnected(roomId, playerId),
  isAdmissionBoundary: (roomId) => pokerGames.isAdmissionBoundary(roomId),
  syncParticipants: (room) => pokerGames.syncParticipants(room),
  setHost: (roomId, playerId) => pokerGames.setHost(roomId, playerId),
  terminate: (roomId) => pokerGames.delete(roomId),
};

export function getRoomGameAdapter(gameType: GameType): RoomGameAdapter {
  return gameType === 'BLACKJACK' ? blackjackAdapter : pokerAdapter;
}
