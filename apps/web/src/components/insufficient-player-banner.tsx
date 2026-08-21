'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlayerRequirementView } from '@yoppi/protocol';

interface InsufficientPlayerBannerProps {
  requirement: PlayerRequirementView;
}

export function InsufficientPlayerBanner({ requirement }: InsufficientPlayerBannerProps) {
  const previousDeadline = useRef<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);
  const [resumed, setResumed] = useState(false);

  useEffect(() => {
    const deadline = requirement.graceDeadline;
    const previous = previousDeadline.current;
    previousDeadline.current = deadline;

    if (!deadline) {
      setRemainingSeconds(null);
      if (previous) {
        setResumed(true);
        const resumedTimer = window.setTimeout(() => setResumed(false), 3000);
        return () => window.clearTimeout(resumedTimer);
      }
      return;
    }

    setResumed(false);
    const update = () => {
      setRemainingSeconds(Math.max(0, Math.ceil((Date.parse(deadline) - Date.now()) / 1000)));
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [requirement.graceDeadline]);

  if (requirement.graceDeadline && remainingSeconds !== null) {
    return (
      <div
        data-testid="insufficient-player-countdown"
        className="mt-8 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-5 py-4 text-amber-50"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">Insufficient players</p>
            <p className="mt-1 text-sm text-amber-100/80">
              {requirement.current}/{requirement.minimum} required players are currently available.
              The active game will return to the lobby unless enough players reconnect or join.
            </p>
          </div>
          <div className="min-w-20 text-right">
            <p className="text-3xl font-semibold tabular-nums">{remainingSeconds}s</p>
            <p className="text-xs uppercase tracking-[0.16em] text-amber-100/60">remaining</p>
          </div>
        </div>
      </div>
    );
  }

  if (resumed) {
    return (
      <div
        data-testid="player-requirement-restored"
        className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 px-5 py-4 text-sm text-emerald-100"
      >
        Player requirement restored. The active game will continue.
      </div>
    );
  }

  return null;
}
