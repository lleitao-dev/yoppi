import type { BlackjackStateView, RoomView } from '@yoppi/protocol';
import { BlackjackEngine } from './engine';

export class BlackjackGameManager {
  private readonly games = new Map<string, BlackjackEngine>();

  start(room: RoomView): BlackjackEngine {
    if (room.gameType !== 'BLACKJACK') {
      throw new Error('Cannot start a Blackjack engine for another game type.');
    }
    const existing = this.games.get(room.id);
    if (existing) return existing;

    const engine = new BlackjackEngine({
      roomId: room.id,
      hostPlayerId: room.hostPlayerId,
      players: room.players
        .filter((player) => player.participation === 'PLAYING' && player.seat !== null)
        .map((player) => ({
          playerId: player.playerId,
          displayName: player.displayName,
          seat: player.seat as number,
        })),
    });
    this.games.set(room.id, engine);
    return engine;
  }

  setHost(roomId: string, playerId: string): void {
    this.games.get(roomId)?.setHostPlayerId(playerId);
  }

  requestLeave(roomId: string, playerId: string): boolean {
    return this.games.get(roomId)?.requestLeave(playerId) ?? false;
  }

  isAdmissionBoundary(roomId: string): boolean {
    return this.games.get(roomId)?.isAdmissionBoundary() ?? false;
  }

  syncParticipants(room: RoomView): void {
    const engine = this.games.get(room.id);
    if (!engine) return;
    engine.syncPlayers(
      room.players
        .filter((player) => player.participation === 'PLAYING' && player.seat !== null)
        .map((player) => ({
          playerId: player.playerId,
          displayName: player.displayName,
          seat: player.seat as number,
        })),
    );
  }

  get(roomId: string): BlackjackEngine | undefined {
    return this.games.get(roomId);
  }

  view(roomId: string, viewerPlayerId: string): BlackjackStateView | undefined {
    return this.games.get(roomId)?.getView(viewerPlayerId);
  }

  delete(roomId: string): void {
    this.games.delete(roomId);
  }
}

export const blackjackGames = new BlackjackGameManager();
