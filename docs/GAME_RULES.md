# Game rules and scoring

## Match flow

Lobby, countdown (4 seconds), then for each question: question, reveal (4.5 seconds), standings (4 seconds). After the last question the final results screen appears. The host can start another match or return everyone to the lobby.

## Settings (host only, lobby only)

- Play mode: Solo, or Team A vs Team B
- Category: Mixed, one of seven topics (General knowledge, Science, Technology, History, Sports, Entertainment, Geography) or one of five regions (Nigeria, Africa, Europe, Asia, The Americas)
- Questions: 5, 10, 15 or 20
- Seconds per question: 10, 15, 20 or 30
- Maximum players: 2 to 12

## Region sets

Each region has 24 questions at three difficulty levels. A region match asks only that region. Mixed uses the seven topic sets only, so a group outside Nigeria is never surprised by Nigeria questions. The full list is in `docs/REGION_QUESTIONS.md`.

## Team mode

- The host turns on Team A vs Team B in the lobby. Players are split evenly in join order. Later joiners go to the smaller team.
- Any player can switch team while still in the lobby. Teams are locked once the match starts.
- The match needs at least one connected player on each team.
- Everyone answers and scores individually as in solo play.
- A team's score is the average of its players' scores. Averages keep uneven teams fair, for example 3 against 2.
- Teams are ranked by that average, then by correct answers per player. A tie on both shares first place.
- A player who leaves mid match stays in their team's average with the score they had.
- Play again and Back to lobby keep the teams. Scores reset.

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
