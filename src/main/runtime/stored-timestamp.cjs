function pad(value, length = 2) {
  return String(value).padStart(length, "0");
}

function canUseSystemTimeZone(date = new Date()) {
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

function formatStoredTimestamp(date = new Date()) {
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

function formatStoredTimestampForPath(date = new Date()) {
  return formatStoredTimestamp(date).replace(/[:.]/g, "-");
}

module.exports = {
  canUseSystemTimeZone,
  formatStoredTimestamp,
  formatStoredTimestampForPath
};
