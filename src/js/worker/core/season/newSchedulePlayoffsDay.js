// @flow

import setSchedule from "./setSchedule";
import { idb } from "../../db";
import { g, helpers, local, lock } from "../../util";

// Play 2 home (true) then 2 away (false) and repeat, but ensure that the better team always gets the last game.
const betterSeedHome = (numGamesPlayoffSeries: number, gameNum: number) => {
    // For series lengths like 3, 7, 11, 15, etc., special case last 3 games to ensure the home team always gets the last game
    const needsSpecialEnding = (numGamesPlayoffSeries + 1) % 4 === 0;
    if (needsSpecialEnding) {
        // Special case for last 3 games
        if (gameNum >= numGamesPlayoffSeries - 3) {
            return (
                gameNum === numGamesPlayoffSeries - 3 ||
                gameNum === numGamesPlayoffSeries - 1
            );
        }
    }

    const num = Math.floor(gameNum / 2);
    return num % 2 === 0;
};

/**
 * Create a single day's schedule for an in-progress playoffs.
 *
 * @memberOf core.season
 * @return {Promise.boolean} Resolves to true if the playoffs are over. Otherwise, false.
 */
const newSchedulePlayoffsDay = async (): Promise<boolean> => {
    const playoffSeries = await idb.cache.playoffSeries.get(g.season);

    const series = playoffSeries.series;
    const rnd = playoffSeries.currentRound;
    const tids = [];
    const numGamesToWin = helpers.numGamesToWinSeries(
        g.numGamesPlayoffSeries[rnd],
    );

    // Try to schedule games if there are active series
    for (let i = 0; i < series[rnd].length; i++) {
        if (
            series[rnd][i].home.won < numGamesToWin &&
            series[rnd][i].away.won < numGamesToWin
        ) {
            // Make sure to set home/away teams correctly! Home for the lower seed is 1st, 2nd, 5th, and 7th games.
            const gameNum = series[rnd][i].home.won + series[rnd][i].away.won;
            if (betterSeedHome(g.numGamesPlayoffSeries[rnd], gameNum)) {
                tids.push([series[rnd][i].home.tid, series[rnd][i].away.tid]);
            } else {
                tids.push([series[rnd][i].away.tid, series[rnd][i].home.tid]);
            }
        }
    }

    // If series are still in progress, write games and short circuit
    if (tids.length > 0) {
        await setSchedule(tids);
        return false;
    }

    // If playoffs are over, update winner and go to next phase
    if (rnd === g.numGamesPlayoffSeries.length - 1) {
        let key;
        if (series[rnd][0].home.won >= numGamesToWin) {
            key = series[rnd][0].home.tid;
        } else {
            key = series[rnd][0].away.tid;
        }

        const teamSeason = await idb.cache.teamSeasons.indexGet(
            "teamSeasonsBySeasonTid",
            [g.season, key],
        );
        teamSeason.playoffRoundsWon = g.numGamesPlayoffSeries.length;
        teamSeason.hype += 0.05;
        if (teamSeason.hype > 1) {
            teamSeason.hype = 1;
        }

        await idb.cache.teamSeasons.put(teamSeason);

        // Playoffs are over! Return true!
        return true;
    }

    // Playoffs are not over! Make another round

    // Handle "Play until end of round"
    if (local.playingUntilEndOfRound) {
        lock.set("stopGameSim", true);
        local.playingUntilEndOfRound = false;
    }

    // Set matchups for next round
    const tidsWon = [];
    for (let i = 0; i < series[rnd].length; i += 2) {
        // Find the two winning teams
        let team1;
        let team2;
        if (series[rnd][i].home.won >= numGamesToWin) {
            team1 = helpers.deepCopy(series[rnd][i].home);
            tidsWon.push(series[rnd][i].home.tid);
        } else {
            team1 = helpers.deepCopy(series[rnd][i].away);
            tidsWon.push(series[rnd][i].away.tid);
        }
        if (series[rnd][i + 1].home.won >= numGamesToWin) {
            team2 = helpers.deepCopy(series[rnd][i + 1].home);
            tidsWon.push(series[rnd][i + 1].home.tid);
        } else {
            team2 = helpers.deepCopy(series[rnd][i + 1].away);
            tidsWon.push(series[rnd][i + 1].away.tid);
        }

        // Set home/away in the next round
        let matchup;
        if (
            team1.seed < team2.seed ||
            (team1.seed === team2.seed && team1.winp > team2.winp)
        ) {
            matchup = { home: team1, away: team2 };
        } else {
            matchup = { home: team2, away: team1 };
        }

        matchup.home.won = 0;
        matchup.away.won = 0;
        series[rnd + 1][i / 2] = matchup;
    }

    playoffSeries.currentRound += 1;
    await idb.cache.playoffSeries.put(playoffSeries);

    // Update hype for winning a series
    await Promise.all(
        tidsWon.map(async tid => {
            const teamSeason = await idb.cache.teamSeasons.indexGet(
                "teamSeasonsBySeasonTid",
                [g.season, tid],
            );

            teamSeason.playoffRoundsWon = playoffSeries.currentRound;
            teamSeason.hype += 0.05;
            if (teamSeason.hype > 1) {
                teamSeason.hype = 1;
            }

            await idb.cache.teamSeasons.put(teamSeason);
        }),
    );

    // Next time, the schedule for the first day of the next round will be set
    return newSchedulePlayoffsDay();
};

export default newSchedulePlayoffsDay;
