# Game rules and scoring

## Match flow

Lobby, countdown (4 seconds), then for each question: question, reveal (4.5 seconds), standings (4 seconds). After the last question the final results screen appears. The host can start another match or return everyone to the lobby.

## Settings (host only, lobby only)

- Category: Mixed, General knowledge, Science, Technology, History, Sports, Entertainment, Geography
- Questions: 5, 10, 15 or 20
- Seconds per question: 10, 15, 20 or 30
- Maximum players: 2 to 12

## Starting

At least 2 connected players are needed. Every connected non-host player must press Ready. The host does not need to.

## Scoring

- Correct answer: 500 points.
- Speed bonus: up to 500 more, falling in a straight line from full at the start of the question to zero at the deadline.
- Streak bonus: starting with the third correct answer in a row, 100 points per step beyond two, capped at 300. The current answer counts toward the streak.
- Best possible score for one question: 1300.
- Wrong or missing answers score 0 and reset the streak.
- Only the first answer counts. Answers arriving more than 300 ms after the deadline are refused.

## Ranking

Players are ranked by total score, then number of correct answers, then lower average time on correct answers. Players tied on all three share a rank.

## Disconnects

A player who loses connection keeps their seat for 60 seconds and rejoins automatically. After that they are marked as left and their score stays on the board. If the host leaves, the earliest joined connected player becomes host. The old host does not take it back.

## Joining rules

A match in progress does not accept new players. A full room refuses new players. A room nobody touches for 30 minutes in the lobby or results screen is closed.
