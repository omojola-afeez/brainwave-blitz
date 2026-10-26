# Known limitations

- Free hosting sleeps after about 15 minutes without traffic. The first visit afterwards takes up to a minute to wake the server. Wake it before a demo by opening the site a few minutes early.
- Rooms live in memory. A server restart or a new deployment ends all running games.
- One server process only. The game is not built to spread one room across machines.
- The free tier has limited CPU and memory. Tested player counts are listed in the acceptance report.
- The question bank is built in (no external question service) and has a limited size, so long sessions repeat questions after a while. The game avoids repeats within a room as far as the pool allows.
- Custom questions, teams, power-ups and accounts are not part of version 1.
- Questions are English only.
