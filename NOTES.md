# Pulse Assessment Notes

## Phase 1 — Make it run

- Fixed stale presence heartbeats: `/api/poll` previously refreshed every
  presence record whenever any user polled. The heartbeat now updates only the
  caller, allowing inactive sessions to expire after the configured 15-second
  stale window.
- Fixed queued WebRTC ICE handling: candidates that arrived before an SDP
  offer or answer were incorrectly applied before the remote description and
  then discarded on failure. The remote description is now installed before
  queued candidates are flushed, preserving viable connection paths.
- Fixed connection teardown availability: an `end` signal now clears the
  `busy` flag for both participants, allowing them to connect again without
  refreshing or waiting for their sessions to expire.
- Fixed peer-to-peer chat delivery: outgoing messages used a `msg` discriminator
  while receivers only handled `chat`, causing every remote message to be
  silently ignored. Both sides now use the same `chat` message type.
- Decision: kept the existing heartbeat and cleanup design, limiting this change
  to the faulty update scope so subsequent reliability issues can be diagnosed
  and committed independently.
- Testing: verified with lint and a production build. End-to-end two-user testing
  remains pending valid PostgreSQL and Mapbox credentials.

## Phase 2 — Make it good

Not started.

## Phase 3 — Make it secure

Not started.

## Phase 4 — Make it better

Not started.
