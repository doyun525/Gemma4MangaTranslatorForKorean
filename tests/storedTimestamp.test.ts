import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canUseSystemTimeZone,
  formatStoredTimestamp,
  formatStoredTimestampForPath
} from "../src/shared/storedTimestamp";

describe("storedTimestamp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("formats local time with offset when system timezone is available", () => {
    const date = new Date("2026-06-05T01:17:24.348Z");
    vi.spyOn(date, "getTimezoneOffset").mockReturnValue(-540);

    expect(formatStoredTimestamp(date)).toBe("2026-06-05T10:17:24.348+09:00");
  });

  it("falls back to UTC when timezone detection fails", () => {
    const date = new Date("2026-06-05T01:17:24.348Z");
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(() => {
      throw new Error("timezone unavailable");
    });

    expect(canUseSystemTimeZone(date)).toBe(false);
    expect(formatStoredTimestamp(date)).toBe("2026-06-05T01:17:24.348Z");
  });

  it("creates filesystem-safe path stamps", () => {
    const date = new Date("2026-06-05T01:17:24.348Z");
    vi.spyOn(date, "getTimezoneOffset").mockReturnValue(-540);

    expect(formatStoredTimestampForPath(date)).toBe("2026-06-05T10-17-24-348+09-00");
  });
});
