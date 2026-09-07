"use client";

import { useState, type CSSProperties } from "react";

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

interface DateParts {
  year: number;
  month: number; // 0-11
  day: number;
  time: string; // "HH:mm"
}

// Parses a datetime-local string ("YYYY-MM-DDTHH:mm") into its parts —
// falls back to today + noon when empty/unparsed, so the calendar
// always has something sensible to show before the user picks a real
// date.
function parseValue(value: string): DateParts {
  const [datePart, timePart] = value.split("T");
  if (datePart) {
    const [y, m, d] = datePart.split("-").map(Number);
    if (y && m && d) {
      return { year: y, month: m - 1, day: d, time: timePart || "12:00" };
    }
  }
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth(),
    day: now.getDate(),
    time: "12:00",
  };
}

function toValue(
  year: number,
  month: number,
  day: number,
  time: string,
): string {
  return `${year}-${pad2(month + 1)}-${pad2(day)}T${time}`;
}

function dateNum(year: number, month: number, day: number): number {
  return year * 10000 + (month + 1) * 100 + day;
}

/**
 * A real calendar-grid date picker (month dropdown + prev/next arrows,
 * a day grid) with a time field underneath — replaces the native
 * `<input type="datetime-local">`, which showed as a single narrow,
 * unstyled field and didn't leave room to browse other dates. Still
 * produces the same "YYYY-MM-DDTHH:mm" value the rest of the Scheduler
 * form already expects (handlePublish just wraps it in `new Date()`),
 * so this is a drop-in swap, not a new value format.
 */
export function CalendarPicker({
  value,
  onChange,
  min,
  style,
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  style?: CSSProperties;
}) {
  const parsed = parseValue(value);
  const [viewYear, setViewYear] = useState(parsed.year);
  const [viewMonth, setViewMonth] = useState(parsed.month);

  const minParsed = min ? parseValue(min) : null;
  const minDateNum = minParsed
    ? dateNum(minParsed.year, minParsed.month, minParsed.day)
    : null;

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(viewYear - 1);
    } else {
      setViewMonth(viewMonth - 1);
    }
  }

  function goNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(viewYear + 1);
    } else {
      setViewMonth(viewMonth + 1);
    }
  }

  function selectDay(day: number) {
    onChange(toValue(viewYear, viewMonth, day, parsed.time));
  }

  function changeTime(time: string) {
    onChange(toValue(parsed.year, parsed.month, parsed.day, time));
  }

  const isSelected = (day: number) =>
    day === parsed.day &&
    viewMonth === parsed.month &&
    viewYear === parsed.year;
  const isDisabled = (day: number) =>
    minDateNum != null && dateNum(viewYear, viewMonth, day) < minDateNum;

  return (
    <div
      style={{
        border: "1.5px solid var(--accent-text)",
        borderRadius: 8,
        padding: "1rem",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          marginBottom: "0.75rem",
        }}
      >
        <button
          type="button"
          onClick={goPrevMonth}
          aria-label="Previous month"
          style={{ padding: "0.2rem 0.6rem" }}
        >
          &larr;
        </button>
        <select
          value={viewMonth}
          onChange={(e) => setViewMonth(Number(e.target.value))}
          className="field-input"
          aria-label="Month"
          style={{ width: "auto", flex: 1, padding: "0.35rem 0.5rem" }}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <select
          value={viewYear}
          onChange={(e) => setViewYear(Number(e.target.value))}
          className="field-input"
          aria-label="Year"
          style={{ width: "auto", padding: "0.35rem 0.5rem" }}
        >
          {Array.from({ length: 6 }, (_, i) => parsed.year - 1 + i).map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={goNextMonth}
          aria-label="Next month"
          style={{ padding: "0.2rem 0.6rem" }}
        >
          &rarr;
        </button>
      </div>

      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          gridTemplateRows: `auto repeat(${cells.length / 7}, 1fr)`,
          gap: "4px",
          fontSize: "1em",
          textAlign: "center",
        }}
      >
        {DAY_LABELS.map((label) => (
          <div key={label} style={{ opacity: 0.6, padding: "0.35rem 0" }}>
            {label}
          </div>
        ))}
        {cells.map((day, i) =>
          day == null ? (
            <div key={`empty-${i}`} />
          ) : (
            <button
              key={day}
              type="button"
              disabled={isDisabled(day)}
              onClick={() => selectDay(day)}
              style={{
                borderRadius: 6,
                border: isSelected(day)
                  ? "1.5px solid var(--accent-text)"
                  : "1px solid transparent",
                background: isSelected(day) ? "var(--accent)" : "transparent",
                color: isSelected(day)
                  ? "#0a1628"
                  : isDisabled(day)
                    ? "var(--muted)"
                    : "var(--text)",
                cursor: isDisabled(day) ? "not-allowed" : "pointer",
                fontSize: "1.05em",
              }}
            >
              {day}
            </button>
          ),
        )}
      </div>

      <label style={{ display: "block", marginTop: "1rem", fontSize: "0.9em" }}>
        Time
        <input
          type="time"
          value={parsed.time}
          onChange={(e) => changeTime(e.target.value)}
          className="field-input"
          style={{ marginTop: "0.35rem" }}
        />
      </label>
    </div>
  );
}
