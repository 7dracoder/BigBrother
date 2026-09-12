export type Mode = "live" | "demo";
export type Transcript = {
  id: string;
  sessionId: string;
  text: string;
  speaker: string;
  timestamp: string;
  mode: Mode;
  detected: boolean;
};
export type Proposal = {
  id: string;
  sessionId: string;
  transcriptId: string;
  title: string;
  who: string;
  when: string;
  start: string | null;
  end: string | null;
  timezone: string;
  draft: string;
  evidence: string;
  assumptions: string[];
  status:
    | "pending"
    | "executing"
    | "approved"
    | "dismissed"
    | "uncertain"
    | "applied"
    | "deleted";
  mode: Mode;
  createdAt: string;
  result?: string;
  version?: number;
  kind?: "event" | "reminder";
  operation?: "create" | "update";
  targetProposalId?: string;
  targetVersion?: number;
  eventId?: string;
  attendees?: string[];
  before?: { title: string; start: string | null; end: string | null };
};
export type Activity = {
  id: string;
  text: string;
  timestamp: string;
  kind: "info" | "success" | "error";
};
export type Snapshot = {
  transcripts: Transcript[];
  proposals: Proposal[];
  activities: Activity[];
};
export type Configuration = {
  transcription: boolean;
  detection: boolean;
  calendar: boolean;
};
