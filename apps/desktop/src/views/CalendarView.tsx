import { useEffect, useRef, useState } from "react";
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight, Plus, X, RefreshCw, Link } from "lucide-react";

interface CalEvent { id: string; title: string; date: string; }
interface ExtEvent  { uid: string; title: string; date: string; source_id: string; }
interface IcsSource { id: string; label: string; url: string; last_synced: number | null; }

let db: Awaited<ReturnType<typeof Database.load>> | null = null;
async function getDb() {
  if (!db) {
    db = await Database.load("sqlite:daemon.db");
    await db.execute(`CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, date TEXT NOT NULL, created_at INTEGER NOT NULL
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS ics_sources (
      id TEXT PRIMARY KEY, label TEXT NOT NULL, url TEXT NOT NULL, last_synced INTEGER
    )`);
    await db.execute(`CREATE TABLE IF NOT EXISTS external_events (
      uid TEXT NOT NULL, source_id TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL,
      PRIMARY KEY (uid, source_id)
    )`);
  }
  return db;
}

const MONTHS = ["January","February","March","April","May","June",
                "July","August","September","October","November","December"];
const DAYS_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DAY_NAMES  = ["SU","MO","TU","WE","TH","FR","SA"];

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function dateFromStr(s: string): Date {
  return new Date(s + "T00:00:00");
}

interface RawIcsEvent {
  uid: string;
  title: string;
  date: string;       // YYYY-MM-DD of first occurrence
  rrule: string;      // e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
  exdates: string[];  // excluded dates YYYY-MM-DD
}

/** Expand a single ICS event into all occurrences within ±1 year of today. */
function expandEvent(ev: RawIcsEvent): { uid: string; title: string; date: string }[] {
  const exSet = new Set(ev.exdates);
  const now = new Date();
  const windowStart = new Date(now); windowStart.setFullYear(now.getFullYear() - 1);
  const windowEnd   = new Date(now); windowEnd.setFullYear(now.getFullYear() + 1);

  // Non-recurring — just return the single date
  if (!ev.rrule) {
    if (!ev.date) return [];
    const d = dateFromStr(ev.date);
    if (d < windowStart || d > windowEnd) return [];
    return [{ uid: ev.uid, title: ev.title, date: ev.date }];
  }

  // Parse RRULE params
  const params: Record<string, string> = {};
  for (const part of ev.rrule.split(";")) {
    const eq = part.indexOf("=");
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1);
  }

  const freq     = params["FREQ"] ?? "";
  const interval = parseInt(params["INTERVAL"] ?? "1", 10) || 1;
  const maxCount = params["COUNT"] ? parseInt(params["COUNT"], 10) : 2000;
  const untilRaw = params["UNTIL"] ? params["UNTIL"].slice(0, 8) : null;
  const untilDate = untilRaw
    ? new Date(`${untilRaw.slice(0,4)}-${untilRaw.slice(4,6)}-${untilRaw.slice(6,8)}T00:00:00`)
    : windowEnd;
  const effectiveEnd = untilDate < windowEnd ? untilDate : windowEnd;

  const byDay: number[] = (params["BYDAY"] ?? "")
    .split(",").map(d => DAY_NAMES.indexOf(d.replace(/[+-\d]/g, ""))).filter(d => d >= 0);

  const results: { uid: string; title: string; date: string }[] = [];
  let count = 0;

  const addIfInWindow = (d: Date) => {
    if (d < windowStart || d > effectiveEnd) return;
    const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    if (exSet.has(ds)) return;
    results.push({ uid: `${ev.uid}_${ds}`, title: ev.title, date: ds });
  };

  const start = ev.date ? dateFromStr(ev.date) : new Date();

  if (freq === "DAILY") {
    const cur = new Date(start);
    while (cur <= effectiveEnd && count++ < maxCount) {
      addIfInWindow(cur);
      cur.setDate(cur.getDate() + interval);
    }
  } else if (freq === "WEEKLY") {
    // Go back to the Sunday of the start week, then advance week by week
    const weekAnchor = new Date(start);
    weekAnchor.setDate(weekAnchor.getDate() - weekAnchor.getDay()); // Sunday
    const cur = new Date(weekAnchor);
    while (cur <= effectiveEnd && count < maxCount) {
      const activeDays = byDay.length > 0 ? byDay : [start.getDay()];
      for (const wd of activeDays) {
        const day = new Date(cur);
        day.setDate(cur.getDate() + wd);
        if (day < start) continue;
        if (day > effectiveEnd) break;
        addIfInWindow(day);
        count++;
      }
      cur.setDate(cur.getDate() + 7 * interval);
    }
  } else if (freq === "MONTHLY") {
    const cur = new Date(start);
    while (cur <= effectiveEnd && count++ < maxCount) {
      addIfInWindow(cur);
      cur.setMonth(cur.getMonth() + interval);
    }
  } else if (freq === "YEARLY") {
    const cur = new Date(start);
    while (cur <= effectiveEnd && count++ < maxCount) {
      addIfInWindow(cur);
      cur.setFullYear(cur.getFullYear() + interval);
    }
  }

  return results;
}

export default function CalendarView() {
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  const [year, setYear]     = useState(today.getFullYear());
  const [month, setMonth]   = useState(today.getMonth());
  const [events, setEvents] = useState<Record<string, CalEvent[]>>({});
  const [extEvents, setExtEvents] = useState<Record<string, ExtEvent[]>>({});
  const [sources, setSources] = useState<IcsSource[]>([]);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayStr);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [syncing, setSyncing] = useState<string | null>(null); // source id being synced
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectLabel, setConnectLabel] = useState("");
  const [connectUrl, setConnectUrl]     = useState("");
  const [connectError, setConnectError] = useState("");
  const inputRef        = useRef<HTMLInputElement>(null);
  const connectUrlRef   = useRef<HTMLInputElement>(null);

  useEffect(() => { if (addingTo)      inputRef.current?.focus(); },      [addingTo]);
  useEffect(() => { if (connectOpen)   connectUrlRef.current?.focus(); }, [connectOpen]);

  useEffect(() => { loadSources(); }, []);
  useEffect(() => { loadMonthEvents(year, month); loadExtMonthEvents(year, month); }, [year, month]);

  async function loadSources() {
    const db = await getDb();
    const rows = await db.select<IcsSource[]>("SELECT id, label, url, last_synced FROM ics_sources ORDER BY rowid ASC");
    setSources(rows);
  }

  async function loadMonthEvents(y: number, m: number) {
    const db = await getDb();
    const prefix = `${y}-${String(m + 1).padStart(2,"0")}`;
    const rows = await db.select<CalEvent[]>(
      "SELECT id, title, date FROM calendar_events WHERE date LIKE ? ORDER BY rowid ASC", [`${prefix}%`]
    );
    const map: Record<string, CalEvent[]> = {};
    for (const ev of rows) { (map[ev.date] ??= []).push(ev); }
    setEvents(map);
  }

  async function loadExtMonthEvents(y: number, m: number) {
    const db = await getDb();
    const prefix = `${y}-${String(m + 1).padStart(2,"0")}`;
    const rows = await db.select<ExtEvent[]>(
      "SELECT uid, source_id, title, date FROM external_events WHERE date LIKE ? ORDER BY date ASC", [`${prefix}%`]
    );
    const map: Record<string, ExtEvent[]> = {};
    for (const ev of rows) { (map[ev.date] ??= []).push(ev); }
    setExtEvents(map);
  }

  async function addEvent(date: string, title: string) {
    const t = title.trim();
    setAddingTo(null);
    if (!t) return;
    const db = await getDb();
    await db.execute(
      "INSERT INTO calendar_events (id, title, date, created_at) VALUES (?, ?, ?, ?)",
      [crypto.randomUUID(), t, date, Date.now()]
    );
    loadMonthEvents(year, month);
  }

  async function deleteEvent(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM calendar_events WHERE id = ?", [id]);
    loadMonthEvents(year, month);
  }

  async function addSource() {
    const label = connectLabel.trim() || "Google Calendar";
    const url   = connectUrl.trim();
    if (!url) { setConnectError("Paste an ICS URL first."); return; }
    setConnectError("");
    const db = await getDb();
    const id = crypto.randomUUID();
    await db.execute("INSERT INTO ics_sources (id, label, url) VALUES (?, ?, ?)", [id, label, url]);
    setConnectOpen(false); setConnectLabel(""); setConnectUrl("");
    await loadSources();
    await syncSource({ id, label, url, last_synced: null });
  }

  async function removeSource(id: string) {
    const db = await getDb();
    await db.execute("DELETE FROM ics_sources WHERE id = ?", [id]);
    await db.execute("DELETE FROM external_events WHERE source_id = ?", [id]);
    loadSources();
    loadExtMonthEvents(year, month);
  }

  async function syncSource(source: IcsSource) {
    setSyncing(source.id);
    try {
      const raw = await invoke<RawIcsEvent[]>("fetch_and_parse_ics", { url: source.url });

      // Expand recurring events into individual occurrences
      const expanded = raw.flatMap(ev => expandEvent(ev));

      const db = await getDb();
      await db.execute("DELETE FROM external_events WHERE source_id = ?", [source.id]);
      for (const ev of expanded) {
        if (!ev.date) continue;
        await db.execute(
          "INSERT OR REPLACE INTO external_events (uid, source_id, title, date) VALUES (?, ?, ?, ?)",
          [ev.uid || crypto.randomUUID(), source.id, ev.title, ev.date]
        );
      }
      await db.execute("UPDATE ics_sources SET last_synced = ? WHERE id = ?", [Date.now(), source.id]);
      loadSources();
      loadExtMonthEvents(year, month);
    } catch (e) {
      console.error("ICS sync failed:", e);
    } finally {
      setSyncing(null);
    }
  }

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1);
  }

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const selLocal = selectedDate ? (events[selectedDate]    ?? []) : [];
  const selExt   = selectedDate ? (extEvents[selectedDate] ?? []) : [];
  const selectedDayLabel = selectedDate
    ? new Date(selectedDate + "T00:00:00").toLocaleDateString(undefined,
        { weekday: "long", month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="cal-view">
      {/* ── Header ── */}
      <div className="cal-view-header">
        <button className="cal-view-nav-btn" onClick={prevMonth}><ChevronLeft size={18} /></button>
        <h2 className="cal-view-title">{MONTHS[month]} {year}</h2>
        <button className="cal-view-nav-btn" onClick={nextMonth}><ChevronRight size={18} /></button>
        <button className="cal-view-today-btn"
          onClick={() => { setYear(today.getFullYear()); setMonth(today.getMonth()); setSelectedDate(todayStr); }}>
          Today
        </button>

        <div className="cal-view-header-gap" />

        {/* Connected sources chips */}
        {sources.map(s => (
          <div key={s.id} className="cal-source-chip">
            <span className="cal-source-dot" />
            <span className="cal-source-label">{s.label}</span>
            <button className="cal-source-sync" title="Sync now"
              onClick={() => syncSource(s)}
              disabled={syncing === s.id}>
              <RefreshCw size={11} className={syncing === s.id ? "spinning" : ""} />
            </button>
            <button className="cal-source-remove" title="Remove" onClick={() => removeSource(s.id)}>
              <X size={11} />
            </button>
          </div>
        ))}

        <button className="cal-view-connect-btn" onClick={() => setConnectOpen(true)}>
          <Link size={14} />
          Connect Calendar
        </button>
      </div>

      <div className="cal-view-body">
        {/* ── Grid ── */}
        <div className="cal-view-grid">
          <div className="cal-view-dow-row">
            {DAYS_SHORT.map(d => <div key={d} className="cal-view-dow">{d}</div>)}
          </div>
          {weeks.map((week, wi) => (
            <div key={wi} className="cal-view-week">
              {week.map((day, di) => {
                if (!day) return <div key={di} className="cal-view-cell cal-view-cell-empty" />;
                const dateStr  = toDateStr(year, month, day);
                const isToday  = dateStr === todayStr;
                const isSel    = dateStr === selectedDate;
                const local    = events[dateStr]    ?? [];
                const external = extEvents[dateStr] ?? [];
                return (
                  <div key={dateStr}
                    className={`cal-view-cell${isToday ? " is-today" : ""}${isSel ? " is-selected" : ""}`}
                    onClick={() => { setSelectedDate(d => d === dateStr ? null : dateStr); setAddingTo(null); }}
                  >
                    <div className="cal-view-day-num">{day}</div>
                    <div className="cal-view-events-list">
                      {[...local.map(e => ({ ...e, ext: false })),
                         ...external.map(e => ({ id: e.uid + e.source_id, title: e.title, date: e.date, ext: true }))]
                        .slice(0, 3)
                        .map(ev => (
                          <div key={ev.id}
                            className={`cal-view-event-pill${ev.ext ? " ext" : ""}`}
                            title={ev.title}>
                            {ev.title}
                          </div>
                        ))}
                      {local.length + external.length > 3 && (
                        <div className="cal-view-event-more">+{local.length + external.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* ── Side panel ── */}
        {selectedDate && (
          <div className="cal-view-side">
            <div className="cal-view-side-hdr">
              <span className="cal-view-side-date">{selectedDayLabel}</span>
              <button className="cal-view-side-add" onClick={() => setAddingTo(selectedDate)} title="Add event">
                <Plus size={15} />
              </button>
            </div>

            <div className="cal-view-side-events">
              {/* Google / external events */}
              {selExt.map(ev => (
                <div key={ev.uid + ev.source_id} className="cal-view-side-event ext">
                  <span className="cal-view-side-event-dot ext" />
                  <span className="cal-view-side-event-title">{ev.title}</span>
                  <span className="cal-view-side-event-src">
                    {sources.find(s => s.id === ev.source_id)?.label ?? ""}
                  </span>
                </div>
              ))}

              {/* Local events */}
              {selLocal.map(ev => (
                <div key={ev.id} className="cal-view-side-event">
                  <span className="cal-view-side-event-dot" />
                  <span className="cal-view-side-event-title">{ev.title}</span>
                  <button className="cal-view-side-event-del" onClick={() => deleteEvent(ev.id)}>
                    <X size={12} />
                  </button>
                </div>
              ))}

              {addingTo === selectedDate && (
                <div className="cal-view-side-addinput">
                  <input ref={inputRef} className="cal-view-add-input" placeholder="Event title…"
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === "Enter") addEvent(selectedDate, e.currentTarget.value);
                      if (e.key === "Escape") setAddingTo(null);
                    }}
                    onBlur={e => addEvent(selectedDate, e.target.value)} />
                </div>
              )}

              {selLocal.length === 0 && selExt.length === 0 && !addingTo && (
                <p className="cal-view-side-empty">No events — click + to add one</p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Connect modal ── */}
      {connectOpen && (
        <div className="search-backdrop" onClick={() => setConnectOpen(false)}>
          <div className="arxiv-modal" style={{ width: 440 }}
            onClick={e => e.stopPropagation()}
            onKeyDown={e => e.key === "Escape" && setConnectOpen(false)}>
            <div className="arxiv-modal-header">
              <span className="arxiv-modal-title">Connect Google Calendar</span>
            </div>

            <div style={{ padding: "16px 20px 0", display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ fontSize: "0.82rem", color: "var(--text-2)", lineHeight: 1.6 }}>
                In <strong style={{color:"var(--text-1)"}}>Google Calendar</strong>, go to <em>Settings → [calendar name] → Integrate calendar</em>
                {" "}and copy the <strong style={{color:"var(--text-1)"}}>Secret address in iCal format</strong>.
              </p>
              <input className="arxiv-url-input" placeholder="Calendar name (e.g. Work, Personal)"
                value={connectLabel} onChange={e => setConnectLabel(e.target.value)}
                onKeyDown={e => e.stopPropagation()} />
              <input ref={connectUrlRef} className="arxiv-url-input"
                placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                value={connectUrl} onChange={e => { setConnectUrl(e.target.value); setConnectError(""); }}
                onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") addSource(); }} />
              {connectError && <p className="arxiv-error">{connectError}</p>}
            </div>

            <div className="arxiv-modal-actions">
              <button className="btn-ghost" onClick={() => setConnectOpen(false)}>Cancel</button>
              <button className="arxiv-import-btn" onClick={addSource}>Connect & Sync</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
