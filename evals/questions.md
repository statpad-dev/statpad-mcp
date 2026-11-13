# Agent evals

Questions a person might ask an agent that has the Statpad MCP server. Each has the tool calls a good agent makes and what a correct answer must contain or must decline. Running them is manual; [CONTRIBUTING.md](../CONTRIBUTING.md#evals) says how.

Calls are written as `tool(arguments)`. "Then" means the second call needs an id from the first. An agent may take a different route if it reaches the same answer within the same number of calls or fewer. A question marked live needs a game in progress when you run it.

Every answer must also avoid these misses: inventing data the tools didn't return, citing a league that `list_leagues` didn't return, and passing on a `warning` field without telling the user.

## Coverage

1. **Which sports can you get data for?**
   - Calls: `list_leagues()`.
   - Must contain: each league `list_leagues` returns, today NFL, NCAA FBS football and the Premier League. Must not claim the NBA, MLB or NHL.

2. **What was the score of last night's Lakers game?**
   - Calls: `list_leagues()`, or none if the agent already has it.
   - Must decline: Statpad doesn't cover the NBA on this key. Must not guess a score.

3. **Show me the NFL standings.**
   - Calls: none.
   - Must decline: standings aren't available. May offer recent results from `find_games` instead.

4. **Is Josh Allen on the injury report?**
   - Calls: none.
   - Must decline: injury reports aren't available. Must not infer an injury from play-by-play.

5. **Did the Vikings make any trades this week?**
   - Calls: none.
   - Must decline: transactions aren't available.

6. **What's the spread on the Bills game?**
   - Calls: none, or `find_games` to name the game.
   - Must decline: odds aren't available.

7. **Who leads the NFL in passing yards this season?**
   - Calls: none.
   - Must decline: season stats and leaders aren't available. May offer one game's box score instead.

8. **How tall is Justin Jefferson, and where did he go to college?**
   - Calls: none.
   - Must decline: player profiles and player search aren't available.

9. **Who won the Bills and Vikings game in 2024?**
   - Calls: none, or one `find_games` range that comes back empty.
   - Must decline: Statpad's history starts in November 2026.

## Schedules

10. **What NFL games are on today?**
    - Calls: `find_games(league: nfl, date: today)`.
    - Must contain: each game's teams and start time in the user's time zone, from `local_time` or a correct conversion of `scheduled_at`. If the list is empty, must say that games appear about 10 minutes before kickoff, not that there are no games.

11. **What Premier League matches are on tomorrow? I'm in London.**
    - Calls: `find_games(league: epl, date: tomorrow, tz: Europe/London)`.
    - Must contain: the resolved date. If the list is empty, the same 10-minute caveat as question 10.

12. **When do the Bills play next?**
    - Calls: `find_games(league: nfl, team: Bills, from: now, to: now plus up to 31 days)`.
    - Must contain: the next game if one is listed. If none is, must say the schedule shows games only shortly before kickoff, not that the Bills have no games.

13. **What college football games are live right now?**
    - Calls: `find_games(league: ncaaf, live: true)`.
    - Must contain: each live game's teams, score and status, or a plain statement that none is in progress. Live.

14. **Did any NFL game from last night go past midnight and is it still going?**
    - Calls: `find_games(league: nfl, live: true)`.
    - Must contain: games still in progress that started yesterday. Must not need a second call for yesterday's date.

15. **List every NFL game from November 1 to November 30.**
    - Calls: `find_games(league: nfl, from: 2026-11-01T00:00:00Z, to: 2026-12-01T00:00:00Z)`.
    - Must contain: the games returned. If the result is truncated, must say so and offer to narrow by team.

16. **Show me all NCAAF games from September through December.**
    - Calls: none that succeed, or two or more `find_games` ranges of at most 31 days each.
    - Must contain: either the split into ranges or a statement that one call covers at most 31 days.

## Games

17. **What's the score of the Bills game?**
    - Calls: `find_games(league: nfl, date: today, team: Bills)`, then `get_game` if the game is live.
    - Must contain: both teams and the score, and the status, such as final or the period and clock.

18. **Where was Bills at Vikings played?**
    - Calls: `find_games`, then `get_game`.
    - Must contain: U.S. Bank Stadium in Minneapolis.

19. **What's the situation in the Bills game right now? Down and distance?**
    - Calls: `find_games(league: nfl, live: true, team: Bills)`, then `get_game`.
    - Must contain: period, clock, possession, down, distance and yard line from `live_state`, and the time from `live_state.updated_at`. Live.

20. **What was the score at halftime of Bills at Vikings?**
    - Calls: `find_games`, then `get_plays(mode: scoring)`.
    - Must contain: 10 to 6 Bills, from the score after the last scoring play of the second quarter. Must not claim a period score table exists.

21. **What's the minute and are there any red cards in the Man United match?**
    - Calls: `find_games(league: epl, ...)`, then `get_game`.
    - Must contain: the minute and stoppage time from `live_state.soccer`, and each side's red cards. Live.

## Plays and drives

22. **What just happened in the Bills game?**
    - Calls: `find_games`, then `get_plays(mode: recent)`.
    - Must contain: the last few plays in order with clock and score after each.

23. **How were all the points scored in Bills at Vikings?**
    - Calls: `find_games`, then `get_plays(mode: scoring)`.
    - Must contain: the seven scoring plays in the sample game. The Bills kicked three field goals and scored two touchdowns, a 25-yard J.Allen pass to K.Latu and a 5-yard J.Cook run. The Vikings kicked two field goals. The final was 23 to 6.

24. **Who scored the goals in Aston Villa at Manchester United?**
    - Calls: `find_games(league: epl, ...)`, then `get_plays(mode: scoring)`.
    - Must contain: each goal's minute and scorer from the play descriptions, and the final 4 to 4.

25. **How did the Bills' drives end?**
    - Calls: `find_games`, then `get_plays(mode: drives)`.
    - Must contain: each Bills drive's result, such as punt, interception or field goal, with yards.

26. **Keep me posted on the Bills game. What's changed since you last checked?**
    - Calls: `get_plays(after_seq: <seq from the previous result>)`, repeated with each new `seq`.
    - Must contain: only plays after the earlier seq. If the result has `resync_required`, must say it re-read the game. Live.

## Box scores

27. **How did Josh Allen do?**
    - Calls: `find_games`, then `get_box_score(player: allen)`.
    - Must contain: his passing line, 21 of 31 for 234 yards, 1 touchdown and 1 interception in the sample game. Must tell him apart from Kyle Allen.

28. **Who led the Vikings in tackles?**
    - Calls: `find_games`, then `get_box_score(team: MIN, category: defensive)`.
    - Must contain: Blake Cashman with 12 tackles.

29. **How many total rushing yards did the Bills have?**
    - Calls: `find_games`, then `get_box_score(team: BUF, category: rushing)`.
    - Must contain: the sum of the Bills' player rushing lines, and a statement that it is summed from player lines because Statpad doesn't provide team totals.

30. **Give me the full box score for Bills at Vikings.**
    - Calls: `find_games`, then `get_box_score`, then more `get_box_score` calls by team or category if the agent wants every line.
    - Must contain: the top lines per category. If the result is truncated, must say it shows top lines and offer the rest by team or category.

31. **Did Victor Lindelof play for Aston Villa?**
    - Calls: `find_games(league: epl, ...)`, then `get_box_score(player: lindelof)`.
    - Must contain: yes, with his line, found without the accent in the query.

## Errors

32. **Run with a revoked key: what NFL games are on today?**
    - Calls: `find_games`, which returns `unauthorized`.
    - Must contain: the key isn't accepted and the user should check `STATPAD_API_KEY`. Must not retry in a loop.

33. **Run near the end of the allowance: what's the Bills score?**
    - Calls: as question 17.
    - Must contain: the answer and the allowance warning in plain words.
