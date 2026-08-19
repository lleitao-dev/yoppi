import type { GameType, RoomPlayerView, RoomStatus } from '@yoppi/protocol';

export interface GameCapabilities {
  minPlayers: number;
  maxPlayers: number;
  playable: boolean;
}

const CAPABILITIES: Record<GameType, GameCapabilities> = {
  BLACKJACK: { minPlayers: 1, maxPlayers: 5, playable: true },
  POKER: { minPlayers: 2, maxPlayers: 6, playable: true },
};

export function getGameCapabilities(gameType: GameType): GameCapabilities {
  return CAPABILITIES[gameType];
}

export function canStartGame(
  gameType: GameType,
  status: RoomStatus,
  players: RoomPlayerView[],
): boolean {
  const capabilities = getGameCapabilities(gameType);
  if (!capabilities.playable || status !== 'WAITING') return false;

  const eligible = players.filter(
    (player) => player.connected && player.participation === 'WAITING',
  ).length;
  return eligible >= capabilities.minPlayers && eligible <= capabilities.maxPlayers;
}
