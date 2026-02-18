import { createHash } from "node:crypto";

export type SchedulingArgs = {
  runAt?: string;
  delaySeconds?: number;
  cron?: string;
};

type CronFields = {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
};

const MINUTE_VALUES = range(0, 59);
const HOUR_VALUES = range(0, 23);
const DAY_OF_MONTH_VALUES = range(1, 31);
const MONTH_VALUES = range(1, 12);
const DAY_OF_WEEK_VALUES = range(0, 6);

export function resolveScheduleTimeUtc(args: SchedulingArgs, now = new Date()): Date {
  const configured = [args.runAt !== undefined, args.delaySeconds !== undefined, args.cron !== undefined].filter(
    Boolean
  ).length;
  if (configured !== 1) {
    throw new Error("Exactly one of runAt, delaySeconds, or cron must be provided");
  }

  if (args.runAt !== undefined) {
    const parsed = new Date(args.runAt);
    if (Number.isNaN(parsed.getTime())) {
      throw new Error("runAt must be a valid ISO-8601 datetime");
    }
    return parsed;
  }

  if (args.delaySeconds !== undefined) {
    if (!Number.isFinite(args.delaySeconds) || args.delaySeconds < 0) {
      throw new Error("delaySeconds must be a non-negative number");
    }
    return new Date(now.getTime() + args.delaySeconds * 1_000);
  }

  return nextCronOccurrenceUtc(args.cron as string, now);
}

export function nextCronOccurrenceUtc(expression: string, now = new Date()): Date {
  const fields = parseCronFields(expression);
  const cursor = new Date(now.getTime());
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);

  for (let i = 0; i < 525_600; i += 1) {
    if (matchesCron(fields, cursor)) {
      return cursor;
    }
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }

  throw new Error(`Unable to find next cron occurrence within one year for expression: ${expression}`);
}

export function buildDeterministicRequestId(input: {
  namespace: string;
  workflowId: string;
  stepNumber?: number;
  scheduleAtIso: string;
  objectivePrompt: string;
}): string {
  const payload = [
    input.namespace,
    input.workflowId,
    String(input.stepNumber ?? -1),
    input.scheduleAtIso,
    input.objectivePrompt
  ].join("|");
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return `${input.namespace}_${digest}`;
}

function parseCronFields(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("cron must have exactly 5 fields: minute hour day-of-month month day-of-week");
  }

  return {
    minute: parseField(parts[0], MINUTE_VALUES),
    hour: parseField(parts[1], HOUR_VALUES),
    dayOfMonth: parseField(parts[2], DAY_OF_MONTH_VALUES),
    month: parseField(parts[3], MONTH_VALUES),
    dayOfWeek: parseField(parts[4], DAY_OF_WEEK_VALUES)
  };
}

function parseField(value: string, allowed: number[]): Set<number> {
  const result = new Set<number>();
  const segments = value.split(",");
  for (const segment of segments) {
    parseSegment(segment.trim(), allowed).forEach((item) => result.add(item));
  }
  if (result.size === 0) {
    throw new Error(`Invalid cron field: ${value}`);
  }
  return result;
}

function parseSegment(segment: string, allowed: number[]): number[] {
  if (segment === "*") {
    return [...allowed];
  }

  const [rangePart, stepPart] = segment.split("/");
  const step = stepPart ? Number.parseInt(stepPart, 10) : 1;
  if (!Number.isInteger(step) || step <= 0) {
    throw new Error(`Invalid cron step: ${segment}`);
  }

  let source: number[];
  if (rangePart === "*") {
    source = [...allowed];
  } else if (rangePart.includes("-")) {
    const [startRaw, endRaw] = rangePart.split("-");
    const start = Number.parseInt(startRaw, 10);
    const end = Number.parseInt(endRaw, 10);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error(`Invalid cron range: ${segment}`);
    }
    source = range(start, end);
  } else {
    const value = Number.parseInt(rangePart, 10);
    if (!Number.isInteger(value)) {
      throw new Error(`Invalid cron value: ${segment}`);
    }
    source = [value];
  }

  const allowedSet = new Set(allowed);
  const filtered = source.filter((item) => allowedSet.has(item));
  if (filtered.length === 0) {
    throw new Error(`Cron value out of bounds: ${segment}`);
  }

  if (step === 1) {
    return filtered;
  }
  return filtered.filter((_, index) => index % step === 0);
}

function matchesCron(fields: CronFields, at: Date): boolean {
  return (
    fields.minute.has(at.getUTCMinutes()) &&
    fields.hour.has(at.getUTCHours()) &&
    fields.dayOfMonth.has(at.getUTCDate()) &&
    fields.month.has(at.getUTCMonth() + 1) &&
    fields.dayOfWeek.has(at.getUTCDay())
  );
}

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i += 1) {
    out.push(i);
  }
  return out;
}
