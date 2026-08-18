import type { RoomView } from '@yoppi/protocol';
import { getRoomGameAdapter } from './game-adapter';
import { applyBoundaryMembership, getRoomById } from './room-service';

export interface BoundaryReconciliation {
  room: RoomView | null;
  changed: boolean;
  admittedPlayerIds: string[];
  removedPlayerIds: string[];
}

export async function reconcileRoomAtGameBoundary(roomId: string): Promise<BoundaryReconciliation> {
  const room = await getRoomById(roomId);
  if (!room || room.status !== 'ACTIVE') {
    return { room, changed: false, admittedPlayerIds: [], removedPlayerIds: [] };
  }

  const adapter = getRoomGameAdapter(room.gameType);
  if (!adapter || !adapter.isAdmissionBoundary(roomId)) {
    return { room, changed: false, admittedPlayerIds: [], removedPlayerIds: [] };
  }

  const result = await applyBoundaryMembership(roomId);
  if (result.room) adapter.syncParticipants(result.room);
  return result;
}
