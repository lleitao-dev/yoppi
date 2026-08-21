import type { PokerStateView, RoomView } from '@yoppi/protocol';
import { PokerEngine } from './engine';

export class PokerGameManager {
  private readonly games = new Map<string, PokerEngine>();

  start(room: RoomView, turnTimeoutMs = 30_000): PokerEngine {
    if (room.gameType !== 'POKER')
      throw new Error('Cannot start a Poker engine for another game type.');
    const existing = this.games.get(room.id);
    if (existing) return existing;

    const engine = new PokerEngine({
      roomId: room.id,
      hostPlayerId: room.hostPlayerId,
      turnTimeoutMs,
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

  playerConnected(roomId: string, playerId: string): boolean {
    return this.games.get(roomId)?.playerConnected(playerId) ?? false;
  }

  playerDisconnected(roomId: string, playerId: string): boolean {
    return this.games.get(roomId)?.playerDisconnected(playerId) ?? false;
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

  get(roomId: string): PokerEngine | undefined {
    return this.games.get(roomId);
  }

  view(roomId: string, viewerPlayerId: string): PokerStateView | undefined {
    return this.games.get(roomId)?.getView(viewerPlayerId);
  }

  delete(roomId: string): void {
    this.games.delete(roomId);
  }
}

export const pokerGames = new PokerGameManager();
