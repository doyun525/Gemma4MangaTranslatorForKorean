function pad(value: number, length = 2): string {
  return String(value).padStart(length, "0");
}

/** 시스템 시간대를 해석해 로컬 ISO 8601 타임스탬프를 쓸 수 있는지 확인합니다. */
export function canUseSystemTimeZone(date: Date = new Date()): boolean {
  try {
    if (Number.isNaN(date.getTime())) {
      return false;
    }
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone?.trim();
    if (!timeZone) {
      return false;
    }
    const offsetMinutes = -date.getTimezoneOffset();
    return Number.isFinite(offsetMinutes);
  } catch {
    return false;
  }
}

/**
 * 저장용 타임스탬프.
 * 시스템 시간대가 유효하면 로컬 시각+오프셋(예: +09:00), 아니면 UTC(Z)로 저장합니다.
 */
export function formatStoredTimestamp(date: Date = new Date()): string {
  if (!canUseSystemTimeZone(date)) {
    return date.toISOString();
  }

  try {
    const offsetMinutes = -date.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absoluteOffsetMinutes / 60));
    const offsetMins = pad(absoluteOffsetMinutes % 60);

    return (
      `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
      `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}` +
      `${sign}${offsetHours}:${offsetMins}`
    );
  } catch {
    return date.toISOString();
  }
}

/** 파일/폴더 이름에 쓸 수 있는 저장용 타임스탬프. */
export function formatStoredTimestampForPath(date: Date = new Date()): string {
  return formatStoredTimestamp(date).replace(/[:.]/g, "-");
}
