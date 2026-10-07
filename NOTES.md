# Pulse Assessment Notes

## Phase 1 — Make it run (complete)

- `/api/poll` was updating `lastSeen` for every user when only one user polls
  so old dots never goes away. changed it to update only the current user
- early ICE candidates was added before remote description is ready so it fails
  and gets lost. remote description is set first now before adding the queue
- ending a chat didnt clear `busy` for both users so they cant connect again
  added `end` to the same reset used when a request gets declined
- chat sender used `msg` but receiver only checks for `chat`, it looks sent on
  your side but other user gets nothing. both sides uses `chat` now
- `/api/join` errors wasnt checked and map still opens without a presence row
  now it stays on entry and shows a simple retry error
- failed WebRTC was only closing the local screen and both users stays busy on
  server. it sends `end` now before cleanup so they can try another connection
- closing the tab only removed that user and leaves the other side stuck busy
  leave now releases the known peer and puts a final `end` in their mailbox
- after accept there was no timeout while WebRTC connects, both sides can stay
  on connecting forever. added 30 second timer then sends `end` and resets
- video request can wait forever and late camera permission can turn video back
  on after it was cancelled. added request timeout and cancels pending media too
- if polling stops long enough the presence row can be deleted, after polling
  comes back the user stays invisible. client now rejoins and shows offline state
- chat channel can close but ui still says connected and failed messages still
  shows as sent. channel close ends the chat now and unsent draft stays in input
- chat messages is capped at 2000 chars on sender and receiver so one huge send
  cant overload the data channel
- fake map token was always used when env is missing so config warning never
  shows and map just stays blank. token and map load errors has a clear state now
- busy dots is disabled, marker positions refresh and online count includes me
  so map doesnt show clickable or wrong state
- signaling api errors was treated like success and failed SDP work can reject
  in background. they now end the broken flow and shows a useful error
- started with small fixes while finding each broken flow. related changes like
  video lifecycle is grouped together once the whole behavior can be checked
- phase 1 got a real two browser test after credentials was added. both browsers
  found each other, connected, sent p2p chat and started then ended video

## Phase 2 — Make it good (complete)

- picked a Night Signal direction, dark and warm instead of neon tech style
  first pass adds the type, color system, entry screen and map framing
- kept the map as main focus and used ember colors for people so it still feels
  alive but not like a dating app or game
- carried the same look into incoming requests, chat and video instead of them
  feeling like default widgets. mobile chat is full screen and the waiting,
  empty and privacy states is clearer now too
- map feels more like the actual product now, it has a proper quiet state while
  nobody else is around, bigger signal targets, busy labels and controls to get
  back to your spot or see the full world
- finished the small screen pass, entry and request screens changes shape in
  landscape instead of just shrinking. inputs dont zoom the phone now and
  dialog focus stays inside so keyboard use isnt forgotten

## Phase 3 — Make it secure (in progress)

- highest issue was the public peer id also worked like a password, anyone who
  sees it could read signals, pretend to be that user or delete them. each tab
  has a separate random token now and only its sha256 hash goes in postgres
- all join, poll, signal and leave calls checks that token now. adding the column
  clears old presence rows on deploy which is ok here since those rows is meant
  to disappear anyway
- next high issue was a real session could send signals in the wrong order or at
  unrelated users. postgres owns the pending/connected pair now and changes the
  state plus mailbox together so even two requests at once cant half claim them
- leave doesnt trust a peer id from the browser anymore either, it only releases
  whoever the server already paired
- api bodies has a real byte limit now and ids, object keys and webrtc payloads
  gets checked before touching postgres. weird extra fields is rejected too
- request limits is stored in postgres so it works across vercel instances. the
  key uses a sha256 of the ip instead of keeping the raw address, with enough
  room for normal polling and ice bursts

## Phase 4 — Make it better

Not started.
