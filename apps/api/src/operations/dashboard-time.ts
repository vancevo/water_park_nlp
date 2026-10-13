import type { DashboardRanges } from './operations.models.js';

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface OperatingHours {
  opensAtHour: number;
  closesAtHour: number;
}

export function operatingHours(
  environment: NodeJS.ProcessEnv = process.env,
): OperatingHours {
  const opensAtHour = Number(environment.OPERATIONS_OPEN_HOUR ?? 8);
  const closesAtHour = Number(environment.OPERATIONS_CLOSE_HOUR ?? 18);
  if (
    !Number.isInteger(opensAtHour) ||
    !Number.isInteger(closesAtHour) ||
    opensAtHour < 0 ||
    closesAtHour > 24 ||
    opensAtHour >= closesAtHour
  ) {
    return { opensAtHour: 8, closesAtHour: 18 };
  }
  return { opensAtHour, closesAtHour };
}

export function isOperatingBucket(
  startsAt: number,
  hours: OperatingHours,
): boolean {
  const local = new Date(startsAt + VIETNAM_OFFSET_MS);
  const hour = local.getUTCHours();
  return hour >= hours.opensAtHour && hour < hours.closesAtHour;
}

/**
 * Builds half-open reporting windows in Asia/Ho_Chi_Minh. Vietnam has no DST,
 * so the fixed UTC+07 offset keeps boundaries deterministic in every runtime.
 */
export function dashboardRanges(now: Date): DashboardRanges {
  const local = new Date(now.getTime() + VIETNAM_OFFSET_MS);
  const todayLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const today = new Date(todayLocal - VIETNAM_OFFSET_MS);
  const tomorrow = new Date(today.getTime() + DAY_MS);
  const yesterday = new Date(today.getTime() - DAY_MS);
  const weekday = local.getUTCDay() || 7;
  const week = new Date(today.getTime() - (weekday - 1) * DAY_MS);
  const month = new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) -
      VIETNAM_OFFSET_MS,
  );

  return {
    today: { from: today, to: tomorrow },
    yesterday: { from: yesterday, to: today },
    week: { from: week, to: tomorrow },
    month: { from: month, to: tomorrow },
  };
}
