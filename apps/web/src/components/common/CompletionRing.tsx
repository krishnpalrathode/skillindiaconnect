import React from 'react';
import { cn } from '@/lib/utils';

interface CompletionRingProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  label?: string;
  /**
   * Opt-in brand look: gradient arc + larger centered percentage.
   * Defaults to false so existing usages (profile hero, resume hub) are unchanged.
   */
  gradient?: boolean;
  /** Gradient stops when `gradient` is on. Defaults to the brand blue pair. */
  gradientColors?: [string, string];
  /** Soft glow behind the progress arc (premium widget look). Default off. */
  glow?: boolean;
  /** Small milestone dots at 25/50/75/100% around the ring. Default off. */
  milestones?: boolean;
}

const MILESTONES = [25, 50, 75, 100];

/**
 * SVG circular progress ring.
 * pct is clamped to [0, 100].
 * Value is read from the server via GET /candidates/me/completion — never computed client-side.
 */
export function CompletionRing({
  pct,
  size = 120,
  strokeWidth = 10,
  className,
  label,
  gradient = false,
  gradientColors = ['#0F3D91', '#2E67B1'],
  glow = false,
  milestones = false,
}: CompletionRingProps) {
  const clamped = Math.min(100, Math.max(0, pct));
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (clamped / 100) * circumference;
  const center = size / 2;
  const gradientId = React.useId();

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? `Profile ${clamped}% complete`}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        className="-rotate-90"
      >
        {gradient && (
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor={gradientColors[0]} />
              <stop offset="100%" stopColor={gradientColors[1]} />
            </linearGradient>
          </defs>
        )}
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-neutral-200"
        />
        {/* Progress arc */}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={gradient ? `url(#${gradientId})` : 'currentColor'}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={
            glow
              ? { filter: `drop-shadow(0 0 ${strokeWidth / 2}px ${gradientColors[0]}59)` }
              : undefined
          }
          className={cn(
            'transition-all duration-700',
            !gradient &&
              (clamped >= 70
                ? 'text-success-fg'
                : clamped >= 40
                  ? 'text-accent-500'
                  : 'text-primary-500'),
          )}
        />
        {/* Milestone dots — purely decorative markers at 25/50/75/100% */}
        {milestones &&
          MILESTONES.map((m) => {
            const theta = (m / 100) * 2 * Math.PI;
            const cx = center + r * Math.cos(theta);
            const cy = center + r * Math.sin(theta);
            const reached = clamped >= m;
            return (
              <circle
                key={m}
                cx={cx}
                cy={cy}
                r={strokeWidth / 4 + 1}
                fill={reached ? '#ffffff' : '#ffffff'}
                stroke={reached ? gradientColors[1] : '#d4d4d4'}
                strokeWidth={1.5}
                className="transition-colors duration-500"
              />
            );
          })}
      </svg>

      {/* Central label */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={cn(
            'font-bold text-neutral-900 leading-none',
            gradient ? 'text-3xl' : 'text-2xl',
          )}
        >
          {clamped}%
        </span>
        <span className="mt-1 text-xs text-neutral-600">complete</span>
      </div>
    </div>
  );
}
