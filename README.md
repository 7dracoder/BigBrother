# BigBrother

**Be here. We’ll remember.**

An ambient conversation companion that catches commitments, prepares calendar holds and message drafts, and lets you ask what you agreed to. Event creation and edits require approval; explicit deletion requests execute immediately. No wake word, no spoken assistant reply.

## Run locally

Requires Node.js **22.13+** (tested with Node 24) and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open **http://127.0.0.1:3000**. Click **Try a 10-second demo** to exercise capture → proposal → approval → recall without any API keys. Demo mode never opens the microphone or calls an external calendar. Its history is separate from live recordings.

## What works in this first build

- Single-screen interface: recording controls and waveform, live transcript, editable approval cards, recall, and activity log.
- OpenAI transcription-only WebRTC connection, with a server-created ephemeral token. Standard API keys stay on the server.
- Hard mute stops all microphone tracks and closes the peer connection; leaving the page also stops capture.
- Completed utterances are saved to local SQLite before inference. Repeated realtime item IDs are deduplicated.
- Mastra + OpenRouter structured commitment detection, recent conversation context, explicit date/time assumptions, and editable event details.
- Calendar approval endpoint with atomic execution claims. Duplicate approvals and approval/dismiss races cannot execute the same proposal twice.
- Ambiguous MCP adapter that calls exactly the configured calendar tool after approval. An uncertain result blocks automatic retries to avoid duplicate events.
- Message drafts are editable/copyable; nothing sends them.
- Recall answers from saved transcript records with links to source utterances. Live recall considers the most recent 150 utterances in this browser’s history.
- Deterministic sample conversation and simulated approval path for testing without credentials.

**Verification status:** TypeScript, production build, automated tests, and the browser demo flow have been exercised. Credentialed checks also passed for OpenAI token creation, OpenRouter structured detection of a commitment and a cancellation, and Ambiguous MCP schema/calendar discovery. Actual microphone audio and event creation still need end-to-end testing. Configured indicators mean a value is present, not that a provider connection has passed a health check.

## Add the live integrations

Put credentials in `.env.local` (ignored by Git), then refresh the browser. Restart `npm run dev` if environment changes aren’t picked up.

| Variable                     | Purpose                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `OPENAI_API_KEY`             | Live audio transcription                                                      |
| `OPENAI_TRANSCRIPTION_MODEL` | Defaults to `gpt-transcribe`; must be available to your account          |
| `OPENROUTER_API_KEY`         | Commitment detection and recall                                               |
| `OPENROUTER_MODEL`           | Defaults to `openai/gpt-5.6-luna`; use a model with structured output support |
| `AMBIGUOUS_MCP_URL`          | Workspace MCP endpoint; published endpoint is `https://app.ambiguous.ai/mcp`  |
| `AMBIGUOUS_API_KEY`          | Ambiguous workspace key; sent as a Bearer token                               |
| `AMBIGUOUS_CALENDAR_TOOL`    | Exact event-creation tool name from your server’s `tools/list`                |
| `AMBIGUOUS_CALENDAR_ARGS`    | JSON template matching that tool’s actual schema                              |

Run the integration check after adding keys:

```sh
npm run check:integrations
```

This makes a small OpenRouter model call and **read-only** MCP tool discovery. It prints calendar tool names and schemas, never key values. It does not create any event.

Set the calendar argument template from the returned schema. Supported values are `{{title}}`, `{{start}}`, `{{end}}`, `{{timezone}}`, and `{{description}}`. Example shape only:

```dotenv
AMBIGUOUS_CALENDAR_ARGS={"calendar_id":"YOUR_CALENDAR_ID","title":"{{title}}","start_at":"{{start}}","end_at":"{{end}}","description":"{{description}}","status":"tentative","visibility":"private","attendees":[],"auto_conference":false,"auto_meeting_notes":false}
```

Field names and any required calendar/workspace ID must match your actual tool. The adapter fills attendees from the reviewed proposal, overriding the template’s attendees value. Approving an event with participants may send calendar invitations according to Ambiguous’s settings. Message drafts are never sent.

If the MCP connection fails before dispatch, the proposal stays retryable. If dispatch succeeds but the response is missing or reports an error, the proposal is marked **uncertain**. Inspect Ambiguous before creating another hold. A process crash during a call can leave it **executing**, which likewise requires checking the calendar before manual recovery.

## Architecture

```text
Browser microphone ──WebRTC──> OpenAI transcription
       │ completed utterance
       ▼
POST /api/transcript ──> SQLite ──> Mastra / OpenRouter
       │                              │
       └──────── transcript + proposal┘
                           │
                  Human edits / approves
                           │
                 POST /api/proposals
                           │ atomic approval claim
                           ▼
                 Ambiguous calendar MCP

Question ──> POST /api/recall ──> saved transcript + Mastra ──> answer with sources
```

This first build uses direct WebRTC instead of the voice Agents SDK, a custom approval UI instead of CopilotKit, and explicit SQLite transcript retrieval instead of Mastra Memory. **CopilotKit/AG-UI is not integrated yet**, so this version should not claim that sponsor integration. Mastra is embedded in Next route handlers; there is no separate `mastra dev` process yet. These are the next integration milestones after the live capture/calendar path is verified. Exa briefing, real messaging, auth, and public deployment are out of this first increment.

## Data and recording

- Recording starts only after an explicit click and browser microphone permission. Get everyone’s consent before starting.
- Audio goes to OpenAI for transcription. The app saves **text, not audio**, in `data/bigbrother.sqlite`. Live transcript context and recall questions go to OpenRouter and the selected model provider.
- A random browser ID in localStorage scopes history. Demo and live data are separate. There is no speaker diarization; live utterances are labeled “Conversation.”
- History survives reloads and server restarts. There is no automatic expiration or cross-device sync. Clearing browser storage loses the local history identifier but does not delete server records.
- This is a **single-user local MVP**, bound to loopback. Authentication and deployment hardening are required before exposing it publicly. SQLite needs a persistent writable disk; do not deploy unchanged to an ephemeral serverless filesystem.
- Only completed audio turns are saved. Hard mute drops an in-progress turn. Wait for “Saving & finding commitments…” to finish before closing the tab so queued utterances can be persisted.

## Checks

```sh
npm run typecheck
npm test
npm run build
```

Tests cover timezone resolution, missing-date handling, duplicate approvals, concurrent approve/dismiss protection, session isolation, safe MCP JSON templating, same-origin requests, and the full demo API flow.

## Live demo script (~40 seconds)

1. Show the empty live view and explain: “It’s listening to the conversation, not waiting for a command.”
2. With everyone’s consent, click **Start listening**.
3. Say: “Yeah Jamie, let’s grab lunch Thursday at twelve thirty.”
4. Pause for the transcript and proposal. Review the date and suggested duration.
5. Click **Approve calendar hold**. Show the actual event in Ambiguous once the integration has been configured and tested.
6. Ask: “What did I agree to in this conversation?” Show the source quote.
7. Click **Hard mute**. “It catches the plan. I make the call.”

Record a real conversation before the final demo if you want to demonstrate earlier recall. The sample demo is explicitly labeled and is not evidence of live model performance.

## Integration references

- [OpenAI realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI WebRTC and ephemeral tokens](https://developers.openai.com/api/docs/guides/voice-webrtc?api=realtime)
- [Mastra structured output](https://mastra.ai/docs/agents/structured-output)
- [Ambiguous MCP setup](https://www.ambiguous.ai/agents/mcp)
- [CopilotKit Mastra human-in-the-loop integration — next milestone](https://docs.copilotkit.ai/integrations/mastra/human-in-the-loop/tool-based)


### Ask with text or voice

The **A thought away** panel above the transcript handles explicit requests:
- “Remind me what Jamie said” answers from saved memory with source quotes.
- “Remind me in three days to follow up with Jamie” prepares a 15-minute calendar reminder for review. When no clock time is given, 9 AM is visibly suggested. Calendar notification delivery depends on the connected calendar settings; this app does not provide background push notifications.
- “Remind me about Jamie” asks whether you mean recall now or scheduling later.
- Select **Edit with text or voice** on a card, then say or type “Move it to 3 PM.” Time-only edits preserve the original date and duration. Pending cards are revised locally; an approved event gets a separate review card that updates the original event on approval.

Use **Start listening** once. The same microphone continuously captures conversation, answers direct spoken questions, prepares requested reminders/edits, and accepts “approve it” for the current displayed action. It stays on after each response. New action cards appear in the combined listening panel. **Hard mute** stops capture.

Voice approval requires an explicit phrase (“approve it,” “confirm that,” or “go ahead and add it”). Generic “yes,” negated commands, quoted phrases, and conditional approval do not execute. Approval is bound to the card/version shown when the utterance starts arriving, so queued speech cannot approve a later card. Already-handled, stale, or missing card context asks for review instead. Select **Review this action** to make an older card current. Manual form edits use the approval button to include the edited fields.

Demo mode never opens the microphone or writes to the calendar. **Test with a typed utterance** simulates the shared microphone pipeline, including displaying and approving a demo action. The main text input remains available alongside continuous listening.

Calendar creations retain the provider event ID. Updates verify the existing event first, call Ambiguous `update_event`, then read the event back. Older events without a saved ID are matched by calendar, title, and exact time; missing/ambiguous matches block edits. Proposal versions reject stale approvals and concurrent edits. An uncertain provider response blocks automatic retry to avoid duplicate actions.

Validation for this flow: automated routing, reminder/edit/approval lifecycle, stale approvals, session isolation, Eastern DST, and mocked MCP update/readback checks. Live model intent checks use synthetic text. The browser text flow is tested; spoken capture requires a manual microphone test on the user's device. No live calendar writes are performed by the test suite.


**Clear history** stops recording and clears this browser session’s live/demo transcripts, proposals, and activity, then starts a new empty session. Already-created calendar events remain in Ambiguous. A cleared-session marker rejects late writes from queued requests so old text cannot reappear. If a calendar action is already executing, clearing waits until it finishes. History is retained across ordinary microphone restarts and page reloads until explicitly cleared.

### Delete calendar events

Approved event cards have **Delete calendar event**. Clicking it deletes immediately, without a confirmation dialog. With continuous listening on, say **“Delete my meeting with Jamie tomorrow”**, or select an existing event and say **“Delete it.”** The text input accepts the same commands. Named requests match the title/person and date against calendar events saved in this browser session. If several events match, specify the title and date; there is no extra approval step once one event matches.

Deletion verifies the existing provider event, calls Ambiguous `delete_event` with its ID, and checks the event list afterward. It marks the local card deleted, invalidates pending edits to that event, and blocks duplicate requests. An uncertain response requires checking Ambiguous before retrying. Recurring events and events no longer in local app history must currently be managed directly in Ambiguous; bulk deletion is not supported. Demo deletion is local and simulated.

Deletion was verified with demo browser actions and automated tests for direct commands, date matching, ambiguity, stale versions, duplicate requests, recurring-event guards, and mocked provider deletion/readback. Tests never delete real calendar events.

## Participants and contact edits

Say “Add Tan to this event” to look up a unique person in Ambiguous contacts, or provide an email such as “My email is alex at example dot com.” A selected event or single pending proposal supplies the target; ambiguous matches ask which event or email. The proposal displays participant emails, which can also be edited under event details. Approve by voice or button to create the event or apply a revision to an existing event. Existing remote attendees are preserved during additions, and the adapter verifies the requested emails on readback. Invitation delivery itself depends on Ambiguous.

Model settings use a direct OpenAI ID for transcription (`gpt-transcribe`) and an OpenRouter ID for the agent (`openai/gpt-5.6-luna`). Restart the dev server and reconnect the microphone after changing them.
