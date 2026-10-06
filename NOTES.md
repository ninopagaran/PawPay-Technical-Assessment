# Pulse Assessment Notes

## Phase 1 — Make it run

- `/api/poll` was updating `lastSeen` for every user when only one user polls
  so old dots never goes away. changed it to update only the current user
- early ICE candidates was added before remote description is ready so it fails
  and gets lost. remote description is set first now before adding the queue
- Fixed connection teardown availability: an `end` signal now clears the
  `busy` flag for both participants, allowing them to connect again without
  refreshing or waiting for their sessions to expire.
- Fixed peer-to-peer chat delivery: outgoing messages used a `msg` discriminator
  while receivers only handled `chat`, causing every remote message to be
  silently ignored. Both sides now use the same `chat` message type.
- `/api/join` errors wasnt checked and map still opens without a presence row
  now it stays on entry and shows a simple retry error
- failed WebRTC was only closing the local screen and both users stays busy on
  server. it sends `end` now before cleanup so they can try another connection
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
