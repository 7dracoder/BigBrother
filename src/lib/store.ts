import { HttpError } from "./http";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Activity, Mode, Proposal, Snapshot, Transcript } from "./types";

let db: DatabaseSync;
function database() {
  if (db) return db;
  const directory = path.resolve(
    /* turbopackIgnore: true */ process.env.BIGBROTHER_DATA_DIR || "./data",
  );
  mkdirSync(directory, { recursive: true });
  db = new DatabaseSync(path.join(directory, "bigbrother.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS cleared_sessions (id TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY, session TEXT NOT NULL, mode TEXT NOT NULL,
      kind TEXT NOT NULL, timestamp TEXT NOT NULL, payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_session ON records(session, mode, kind, timestamp);`);
  return db;
}
type RecordValue = Transcript | Proposal | Activity;
export function save(
  value: RecordValue,
  session: string,
  mode: Mode,
  kind: string,
) {
  assertSessionActive(session);
  const timestamp = "createdAt" in value ? value.createdAt : value.timestamp;
  database()
    .prepare(
      "INSERT INTO records VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
    )
    .run(value.id, session, mode, kind, timestamp, JSON.stringify(value));
}
export function getProposal(
  id: string,
  session: string,
  mode: Mode,
): Proposal | undefined {
  const row = database()
    .prepare(
      "SELECT payload FROM records WHERE id=? AND session=? AND mode=? AND kind='proposal'",
    )
    .get(id, session, mode);
  return row ? JSON.parse(row.payload as string) : undefined;
}
export function getTranscript(
  id: string,
  session: string,
  mode: Mode,
): Transcript | undefined {
  const row = database()
    .prepare(
      "SELECT payload FROM records WHERE id=? AND session=? AND mode=? AND kind='transcript'",
    )
    .get(id, session, mode);
  return row ? JSON.parse(row.payload as string) : undefined;
}
export function snapshot(session: string, mode: Mode): Snapshot {
  const rows = database()
    .prepare(
      "SELECT kind,payload FROM records WHERE session=? AND mode=? ORDER BY timestamp ASC",
    )
    .all(session, mode);
  const read = <T>(kind: string): T[] =>
    rows
      .filter((r) => r.kind === kind)
      .map((r) => JSON.parse(r.payload as string));
  return {
    transcripts: read<Transcript>("transcript"),
    proposals: read<Proposal>("proposal"),
    activities: read<Activity>("activity").slice(-50),
  };
}
export function log(
  session: string,
  mode: Mode,
  text: string,
  kind: Activity["kind"] = "info",
) {
  save(
    {
      id: crypto.randomUUID(),
      text,
      timestamp: new Date().toISOString(),
      kind,
    },
    session,
    mode,
    "activity",
  );
}
export function replaceProposal(original: Proposal, next: Proposal): boolean {
  return (
    database()
      .prepare(
        "UPDATE records SET payload=? WHERE id=? AND session=? AND mode=? AND json_extract(payload, '$.status')=? AND coalesce(json_extract(payload, '$.version'),0)=?",
      )
      .run(
        JSON.stringify(next),
        original.id,
        original.sessionId,
        original.mode,
        original.status,
        original.version ?? 0,
      ).changes === 1
  );
}
export function claimProposal(proposal: Proposal) {
  return replaceProposal(proposal, { ...proposal, status: "executing" });
}
export function dismissProposal(proposal: Proposal) {
  return replaceProposal(proposal, { ...proposal, status: "dismissed" });
}

export function sessionCleared(session: string): boolean {
  return !!database()
    .prepare("SELECT 1 FROM cleared_sessions WHERE id=?")
    .get(session);
}
export function assertSessionActive(session: string) {
  if (sessionCleared(session))
    throw new HttpError(
      410,
      "This conversation was cleared. Start a new session.",
    );
}
export function clearSession(session: string) {
  const db = database();
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare(
          "SELECT 1 FROM records WHERE session=? AND json_extract(payload,'$.status')='executing'",
        )
        .get(session)
    )
      throw new HttpError(
        409,
        "A calendar action is still finishing. Try clearing again once it completes.",
      );
    db.prepare("INSERT OR IGNORE INTO cleared_sessions VALUES (?)").run(
      session,
    );
    db.prepare("DELETE FROM records WHERE session=?").run(session);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
