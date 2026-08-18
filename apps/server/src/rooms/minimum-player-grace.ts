import type { RoomView } from '@yoppi/protocol';
import type { RoomManager } from './room-manager';

export const DEFAULT_MINIMUM_PLAYER_GRACE_MS = 15_000;

export type GraceReconciliationState = 'UNCHANGED' | 'STARTED' | 'CANCELLED';

export interface GraceReconciliation {
  room: RoomView | undefined;
  state: GraceReconciliationState;
}

interface GraceTimer {
  deadline: string;
  handle: ReturnType<typeof setTimeout>;
}

export interface MinimumPlayerGraceOptions {
  graceMs?: number;
  now?: () => number;
  onExpired: (roomId: string) => Promise<void>;
  onError?: (error: unknown, roomId: string) => void;
}

export class MinimumPlayerGraceController {
  private readonly timers = new Map<string, GraceTimer>();
  private readonly graceMs: number;
  private readonly now: () => number;

  constructor(
    private readonly roomManager: RoomManager,
    private readonly options: MinimumPlayerGraceOptions,
  ) {
    this.graceMs = options.graceMs ?? DEFAULT_MINIMUM_PLAYER_GRACE_MS;
    this.now = options.now ?? Date.now;
  }

  reconcile(roomId: string): GraceReconciliation {
    const room = this.roomManager.get(roomId);
    if (!room || room.status !== 'ACTIVE') return this.cancel(roomId, room);

    const requirementMet = room.playerRequirement.current >= room.playerRequirement.minimum;
    if (requirementMet) return this.cancel(roomId, room);

    const existing = this.timers.get(roomId);
    if (existing) return { room, state: 'UNCHANGED' };

    const deadline = new Date(this.now() + this.graceMs).toISOString();
    const handle = setTimeout(() => {
      void this.expire(roomId, deadline);
    }, this.graceMs);
    this.timers.set(roomId, { deadline, handle });

    return {
      room: this.roomManager.setGraceDeadline(roomId, deadline),
      state: 'STARTED',
    };
  }

  clear(roomId: string): RoomView | undefined {
    return this.cancel(roomId, this.roomManager.get(roomId)).room;
  }

  close(): void {
    for (const timer of this.timers.values()) clearTimeout(timer.handle);
    this.timers.clear();
  }

  private cancel(roomId: string, room: RoomView | undefined): GraceReconciliation {
    const timer = this.timers.get(roomId);
    const hadDeadline =
      room?.playerRequirement.graceDeadline !== null &&
      room?.playerRequirement.graceDeadline !== undefined;
    if (!timer && !hadDeadline) return { room, state: 'UNCHANGED' };

    if (timer) clearTimeout(timer.handle);
    this.timers.delete(roomId);
    return {
      room: this.roomManager.setGraceDeadline(roomId, null),
      state: 'CANCELLED',
    };
  }

  private async expire(roomId: string, deadline: string): Promise<void> {
    const timer = this.timers.get(roomId);
    if (!timer || timer.deadline !== deadline) return;
    this.timers.delete(roomId);

    const room = this.roomManager.get(roomId);
    if (!room || room.status !== 'ACTIVE') {
      this.roomManager.setGraceDeadline(roomId, null);
      return;
    }

    if (room.playerRequirement.current >= room.playerRequirement.minimum) {
      this.roomManager.setGraceDeadline(roomId, null);
      return;
    }

    try {
      await this.options.onExpired(roomId);
    } catch (error) {
      this.roomManager.setGraceDeadline(roomId, null);
      this.options.onError?.(error, roomId);
      this.reconcile(roomId);
    }
  }
}
