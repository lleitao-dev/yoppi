import type { RoomView } from '@yoppi/protocol';
import type { RoomManager } from './room-manager';

export const INSUFFICIENT_PLAYER_GRACE_MS = 15_000;

export interface GraceReconciliation {
  room: RoomView | null;
  changed: boolean;
  state: 'NONE' | 'STARTED' | 'CANCELLED' | 'ACTIVE';
}

type ExpirationHandler = (roomId: string) => Promise<void>;
type ErrorHandler = (error: unknown, roomId: string) => void;

export class InsufficientPlayerGraceController {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly manager: RoomManager,
    private readonly onExpired: ExpirationHandler,
    private readonly durationMs = INSUFFICIENT_PLAYER_GRACE_MS,
    private readonly onError: ErrorHandler = () => undefined,
  ) {}

  reconcile(roomId: string): GraceReconciliation {
    const room = this.manager.get(roomId);
    if (!room) {
      this.clearTimer(roomId);
      return { room: null, changed: false, state: 'NONE' };
    }

    if (room.status !== 'ACTIVE') {
      this.clearTimer(roomId);
      const updated = room.playerRequirement.graceDeadline
        ? (this.manager.setGraceDeadline(roomId, null) ?? room)
        : room;
      return {
        room: updated,
        changed: updated.revision !== room.revision,
        state: 'NONE',
      };
    }

    const sufficient = room.playerRequirement.current >= room.playerRequirement.minimum;
    if (sufficient) {
      this.clearTimer(roomId);
      if (!room.playerRequirement.graceDeadline) {
        return { room, changed: false, state: 'NONE' };
      }
      const updated = this.manager.setGraceDeadline(roomId, null) ?? room;
      return { room: updated, changed: true, state: 'CANCELLED' };
    }

    if (room.playerRequirement.graceDeadline) {
      if (!this.timers.has(roomId)) this.schedule(roomId, room.playerRequirement.graceDeadline);
      return { room, changed: false, state: 'ACTIVE' };
    }

    const graceDeadline = new Date(Date.now() + this.durationMs).toISOString();
    const updated = this.manager.setGraceDeadline(roomId, graceDeadline) ?? room;
    this.schedule(roomId, graceDeadline);
    return { room: updated, changed: true, state: 'STARTED' };
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private clearTimer(roomId: string): void {
    const timer = this.timers.get(roomId);
    if (timer) clearTimeout(timer);
    this.timers.delete(roomId);
  }

  private schedule(roomId: string, graceDeadline: string): void {
    this.clearTimer(roomId);
    const delay = Math.max(0, Date.parse(graceDeadline) - Date.now());
    const timer = setTimeout(() => {
      this.timers.delete(roomId);
      void this.expire(roomId, graceDeadline);
    }, delay);
    this.timers.set(roomId, timer);
  }

  private async expire(roomId: string, expectedDeadline: string): Promise<void> {
    const room = this.manager.get(roomId);
    if (
      !room ||
      room.status !== 'ACTIVE' ||
      room.playerRequirement.graceDeadline !== expectedDeadline ||
      room.playerRequirement.current >= room.playerRequirement.minimum
    ) {
      this.reconcile(roomId);
      return;
    }

    try {
      await this.onExpired(roomId);
    } catch (error) {
      this.onError(error, roomId);
      this.manager.setGraceDeadline(roomId, null);
      this.reconcile(roomId);
    }
  }
}
