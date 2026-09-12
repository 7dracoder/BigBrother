"use client";
import {
  CalendarDays,
  Trash2,
  Check,
  ChevronDown,
  Copy,
  MessageSquare,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useState, useEffect } from "react";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Proposal } from "@/lib/types";
export type ApprovalEdits = {
  title: string;
  start?: string;
  end?: string;
  draft: string;
  attendees?: string[];
};
export function ProposalCard({
  proposal: p,
  busy,
  onAction,
  onEdit,
  onReview,
  onEditingChange,
}: {
  proposal: Proposal;
  busy: boolean;
  onEdit: () => void;
  onReview?: () => void;
  onEditingChange?: (editing: boolean) => void;
  onAction: (
    action: "approve" | "dismiss" | "delete",
    edits: ApprovalEdits,
  ) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    onEditingChange?.(editing);
    return () => onEditingChange?.(false);
  }, [editing, onEditingChange]);
  const [title, setTitle] = useState(p.title);
  const [draft, setDraft] = useState(p.draft);
  const [participantText, setParticipantText] = useState(
    (p.attendees ?? []).join(", "),
  );
  const [start, setStart] = useState(
    p.start ? formatInTimeZone(p.start, p.timezone, "yyyy-MM-dd'T'HH:mm") : "",
  );
  const [end, setEnd] = useState(
    p.end ? formatInTimeZone(p.end, p.timezone, "yyyy-MM-dd'T'HH:mm") : "",
  );
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const pending = p.status === "pending";
  const edits = () => ({
    title,
    draft,
    attendees: participantText
      .split(/[;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
    ...(start ? { start: fromZonedTime(start, p.timezone).toISOString() } : {}),
    ...(end ? { end: fromZonedTime(end, p.timezone).toISOString() } : {}),
  });
  return (
    <article id={`proposal-${p.id}`} className={`proposal-card ${p.status}`}>
      <div className="proposal-eyebrow">
        <span>
          <Sparkles size={13} />
          {p.operation === "update"
            ? "PROPOSED EDIT"
            : p.kind === "reminder"
              ? "REMINDER"
              : p.mode === "demo"
                ? "SAMPLE COMMITMENT"
                : "CALENDAR PROPOSAL"}
        </span>
        <span className="status-label">
          {pending ? "Needs your approval" : p.status}
        </span>
      </div>
      <div className="proposal-title">
        <div className="calendar-icon">
          <CalendarDays size={23} />
        </div>
        <div>
          <h3>{p.title}</h3>
          <p>
            <UserRound size={12} />
            {p.who}
            <span>·</span>
            {p.attendees?.length ? "Calendar event" : "Personal calendar hold"}
          </p>
        </div>
      </div>
      <div className="event-time">
        <CalendarDays size={16} />
        <div>
          <strong>
            {p.start
              ? formatInTimeZone(p.start, p.timezone, "EEEE, MMM d · h:mm a")
              : p.when}
          </strong>
          <span>
            {p.timezone}
            {p.start && p.end
              ? ` · ${(Date.parse(p.end) - Date.parse(p.start)) / 60000} minutes`
              : ""}
          </span>
        </div>
      </div>
      <div className="participant-list">
        <strong>
          <Users size={14} /> Participants
        </strong>
        {p.attendees?.length ? (
          <p>{p.attendees.join(", ")}</p>
        ) : (
          <p>No participants added.</p>
        )}
        <small>
          {pending
            ? "Say an email or add one in details. Approval adds the listed people to the event."
            : "Say ‘add Tan to this event’ or give an email to prepare an edit."}
        </small>
      </div>
      {p.kind === "reminder" && (
        <p className="edit-before">
          Calendar reminder
          {p.mode === "demo"
            ? " (simulated)"
            : pending
              ? " after approval"
              : ""}
          . Alerts depend on your calendar settings.
        </p>
      )}
      {p.before && (
        <p className="edit-before">
          Previously: {p.before.title}
          {p.before.start
            ? ` · ${formatInTimeZone(p.before.start, p.timezone, "MMM d, h:mm a")}`
            : ""}
        </p>
      )}
      {["pending", "approved"].includes(p.status) && !p.targetProposalId && (
        <button className="edit-toggle" disabled={busy} onClick={onEdit}>
          Edit with text or voice <Sparkles size={14} />
        </button>
      )}
      <blockquote>
        “{p.evidence}”<span>Source</span>
      </blockquote>
      <div className="draft">
        <div className="draft-label">
          <span>
            <MessageSquare size={13} /> MESSAGE DRAFT
          </span>
          <button
            className="icon-button"
            aria-label="Copy message draft"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(draft);
                setCopied(true);
                setCopyError(false);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
        <p>{draft || "No message drafted."}</p>
        <small>
          {copyError
            ? "Couldn’t copy. Select and copy the draft text."
            : copied
              ? "Copied. Ready to paste."
              : "Stays a draft. Nothing is sent automatically."}
        </small>
      </div>
      {pending && onReview && (
        <button className="edit-toggle" disabled={busy} onClick={onReview}>
          Review this action <Sparkles size={14} />
        </button>
      )}
      {pending && (
        <>
          <button
            className="edit-toggle"
            onClick={() => setEditing(!editing)}
            aria-expanded={editing}
          >
            Review details & assumptions <ChevronDown size={14} />
          </button>
          {editing && (
            <div className="edit-fields">
              <label>
                Event title
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={200}
                />
              </label>
              <div className="date-fields">
                <label>
                  Starts ({p.timezone})
                  <input
                    aria-label="Event start"
                    type="datetime-local"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                  />
                </label>
                <label>
                  Ends
                  <input
                    aria-label="Event end"
                    type="datetime-local"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                  />
                </label>
              </div>
              <label>
                Participant emails (comma separated)
                <input
                  aria-label="Participant emails"
                  value={participantText}
                  onChange={(e) => setParticipantText(e.target.value)}
                  placeholder="ts5789@nyu.edu"
                  maxLength={4000}
                />
              </label>
              <small>
                Existing calendar participants are preserved. Approval may send
                calendar invitations.
              </small>
              <label>
                Message draft
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  maxLength={2000}
                />
              </label>
              {p.assumptions.map((a) => (
                <small key={a}>{a}</small>
              ))}
            </div>
          )}
          {!editing && p.assumptions.some((a) => a.startsWith("Time wasn")) && (
            <small className="assumption">
              Time is a suggestion. Review before approving.
            </small>
          )}
          <div className="proposal-actions">
            <button
              className="primary"
              disabled={busy || !start || !end || !title.trim()}
              onClick={() => onAction("approve", edits())}
            >
              <Check size={16} />
              {busy
                ? "Working…"
                : p.mode === "demo"
                  ? "Approve demo hold"
                  : p.operation === "update"
                    ? "Approve calendar edit"
                    : "Approve calendar hold"}
            </button>
            <button
              className="dismiss"
              disabled={busy}
              onClick={() => onAction("dismiss", { title, draft })}
            >
              <X size={14} />
              Dismiss
            </button>
          </div>
          {(!start || !end) && (
            <small className="assumption">
              Open details to choose a date and time.
            </small>
          )}
        </>
      )}
      {p.status === "approved" && (
        <button
          className="delete-event"
          disabled={busy}
          title="Deletes this calendar event immediately"
          onClick={() => onAction("delete", { title: p.title, draft: p.draft })}
        >
          <Trash2 size={14} />
          {busy
            ? "Working…"
            : p.mode === "demo"
              ? "Delete demo event"
              : "Delete calendar event"}
        </button>
      )}
      {p.result && (
        <p className={`result ${p.status === "approved" ? "success" : ""}`}>
          {p.status === "approved" && <Check size={14} />} {p.result}
        </p>
      )}
    </article>
  );
}
