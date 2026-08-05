/**
 * =====================================================================
 * DUKE'S FF26 — LIVE PLAYER DATA CONTROLLER
 * Official Release: v1.1.0
 * File: scripts/update-player-data.js
 * =====================================================================
 *
 * PURPOSE
 * -------
 * 1. Retrieve current NFL player metadata from Sleeper.
 * 2. Load the previous live-player-data.json file.
 * 3. Preserve rankings, ADP, projections, bye weeks, news, movement,
 *    and Duke metrics already stored.
 * 4. Update teams, injuries, availability, and depth-chart information.
 * 5. Write the merged results back to live-player-data.json.
 * =====================================================================
 */

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const {
  retrievePlayers,
  normalizeName,
  normalizePosition
} = require('./retrieve-players');

const CONTROLLER_VERSION = '1.1.0';

const OUTPUT_FILE = path.join(
  process.cwd(),
  'data',
  'live-player-data.json'
);

function createMatchKey(player = {}) {
  const name = normalizeName(player.name);

  const position = normalizePosition(
    player.position || player.pos
  );

  return `${name}|${position}`;
}

function getSleeperId(player = {}) {
  return (
    player.externalIds?.sleeper ||
    (
      String(player.playerId || '').startsWith('sleeper:')
        ? String(player.playerId).replace('sleeper:', '')
        : null
    )
  );
}

async function readExistingData() {
  try {
    const text = await fs.readFile(
      OUTPUT_FILE,
      'utf8'
    );

    const data = JSON.parse(text);

    if (!Array.isArray(data.players)) {
      return {
        schemaVersion: 1,
        players: []
      };
    }

    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schemaVersion: 1,
        players: []
      };
    }

    throw new Error(
      `Unable to read existing player data: ${error.message}`,
      { cause: error }
    );
  }
}

function mergePlayerRecords(
  retrievedPlayer,
  existingPlayer = null
) {
  if (!existingPlayer) {
    return retrievedPlayer;
  }

  return {
    ...retrievedPlayer,

    playerId:
      existingPlayer.playerId ||
      retrievedPlayer.playerId,

    externalIds: {
      ...retrievedPlayer.externalIds,
      ...existingPlayer.externalIds,

      sleeper:
        retrievedPlayer.externalIds?.sleeper ||
        existingPlayer.externalIds?.sleeper ||
        null
    },

    byeWeek:
      existingPlayer.byeWeek ??
      retrievedPlayer.byeWeek ??
      null,

    rankings: {
      ...retrievedPlayer.rankings,
      ...existingPlayer.rankings
    },

    adp: {
      ...retrievedPlayer.adp,
      ...existingPlayer.adp
    },

    projections: {
      ...retrievedPlayer.projections,
      ...existingPlayer.projections
    },

    news: {
      ...retrievedPlayer.news,
      ...existingPlayer.news
    },

    movement: {
      ...retrievedPlayer.movement,
      ...existingPlayer.movement
    },

    dukeMetrics: {
      ...retrievedPlayer.dukeMetrics,
      ...existingPlayer.dukeMetrics
    },

    sources: [
      ...new Set([
        ...(existingPlayer.sources || []),
        ...(retrievedPlayer.sources || [])
      ])
    ],

    updatedAt:
      retrievedPlayer.updatedAt ||
      existingPlayer.updatedAt ||
      null
  };
}

function mergePlayerCollections(
  retrievedPlayers,
  existingPlayers
) {
  const existingBySleeperId = new Map();
  const existingByNamePosition = new Map();

  for (const player of existingPlayers) {
    const sleeperId = getSleeperId(player);

    if (sleeperId) {
      existingBySleeperId.set(
        String(sleeperId),
        player
      );
    }

    existingByNamePosition.set(
      createMatchKey(player),
      player
    );
  }

  const mergedPlayers = [];
  const matchedExistingPlayers = new Set();

  for (const retrievedPlayer of retrievedPlayers) {
    const sleeperId = getSleeperId(retrievedPlayer);

    let existingPlayer = null;

    if (
      sleeperId &&
      existingBySleeperId.has(String(sleeperId))
    ) {
      existingPlayer =
        existingBySleeperId.get(String(sleeperId));
    }

    if (!existingPlayer) {
      existingPlayer =
        existingByNamePosition.get(
          createMatchKey(retrievedPlayer)
        ) || null;
    }

    if (existingPlayer) {
      matchedExistingPlayers.add(existingPlayer);
    }

    mergedPlayers.push(
      mergePlayerRecords(
        retrievedPlayer,
        existingPlayer
      )
    );
  }

  /*
   * Preserve unmatched existing records.
   *
   * This protects spreadsheet players or manually added players that
   * Sleeper does not currently return.
   */
  for (const existingPlayer of existingPlayers) {
    if (!matchedExistingPlayers.has(existingPlayer)) {
      mergedPlayers.push({
        ...existingPlayer,

        sources: [
          ...new Set([
            ...(existingPlayer.sources || []),
            'Existing database'
          ])
        ]
      });
    }
  }

  return mergedPlayers.sort((a, b) => {
    const rankA =
      Number(a.rankings?.overall) || 99999;

    const rankB =
      Number(b.rankings?.overall) || 99999;

    return (
      rankA - rankB ||
      String(a.position).localeCompare(
        String(b.position)
      ) ||
      String(a.name).localeCompare(
        String(b.name)
      )
    );
  });
}

function validatePlayers(players) {
  if (!Array.isArray(players)) {
    throw new TypeError(
      'Merged player data must be an array.'
    );
  }

  if (players.length === 0) {
    throw new Error(
      'Merged player data contains no players.'
    );
  }

  const validPositions = new Set([
    'QB',
    'RB',
    'WR',
    'TE',
    'K',
    'DEF'
  ]);

  const seenIds = new Set();
  const errors = [];

  for (const player of players) {
    if (!player.playerId) {
      errors.push(
        `Missing playerId: ${player.name || 'Unknown'}`
      );
    }

    if (!player.name) {
      errors.push(
        `Missing player name: ${player.playerId || 'Unknown'}`
      );
    }

    if (!validPositions.has(player.position)) {
      errors.push(
        `Invalid position for ${player.name}: ${player.position}`
      );
    }

    if (seenIds.has(player.playerId)) {
      errors.push(
        `Duplicate playerId: ${player.playerId}`
      );
    }

    seenIds.add(player.playerId);
  }

  if (errors.length > 0) {
    throw new Error(
      [
        'Player validation failed.',
        ...errors.slice(0, 20)
      ].join('\n')
    );
  }

  return {
    valid: true,
    playerCount: players.length
  };
}

function buildSummary(players) {
  const positionCounts = {};
  const injuryCounts = {};

  let activePlayers = 0;
  let rankedPlayers = 0;
  let playersWithAdp = 0;

  for (const player of players) {
    positionCounts[player.position] =
      (positionCounts[player.position] || 0) + 1;

    const injuryStatus =
      player.injury?.status || 'Healthy';

    injuryCounts[injuryStatus] =
      (injuryCounts[injuryStatus] || 0) + 1;

    if (player.availability?.active) {
      activePlayers += 1;
    }

    if (
      Number.isFinite(
        Number(player.rankings?.overall)
      )
    ) {
      rankedPlayers += 1;
    }

    if (
      Number.isFinite(
        Number(player.adp?.consensus)
      )
    ) {
      playersWithAdp += 1;
    }
  }

  return {
    totalPlayers: players.length,
    activePlayers,
    rankedPlayers,
    playersWithAdp,
    positionCounts,
    injuryCounts
  };
}

async function writeOutput(output) {
  await fs.mkdir(
    path.dirname(OUTPUT_FILE),
    { recursive: true }
  );

  const temporaryFile =
    `${OUTPUT_FILE}.temporary`;

  await fs.writeFile(
    temporaryFile,
    JSON.stringify(output, null, 2),
    'utf8'
  );

  await fs.rename(
    temporaryFile,
    OUTPUT_FILE
  );
}

async function main() {
  console.log(
    `Duke's FF26 controller v${CONTROLLER_VERSION}`
  );

  console.log(
    'Reading existing player database...'
  );

  const existingData =
    await readExistingData();

  console.log(
    `Existing players: ${existingData.players.length}`
  );

  console.log(
    'Retrieving current Sleeper NFL players...'
  );

  const retrieval =
    await retrievePlayers({
      timeoutMs: 30000,
      retries: 3
    });

  console.log(
    `Retrieved players: ${retrieval.players.length}`
  );

  console.log(
    'Merging retrieved data with existing data...'
  );

  const mergedPlayers =
    mergePlayerCollections(
      retrieval.players,
      existingData.players
    );

  const validation =
    validatePlayers(mergedPlayers);

  const updatedAt =
    new Date().toISOString();

  const output = {
    schemaVersion: 1,

    engine: {
      name: "Duke's FF26 Live Engine",
      controllerVersion: CONTROLLER_VERSION,
      retrievalVersion:
        retrieval.moduleVersion
    },

    season:
      existingData.season || 2026,

    scoring:
      existingData.scoring || 'PPR',

    updatedAt,

    sources: [
      ...new Set([
        ...(existingData.sources || []),
        'Sleeper'
      ])
    ],

    retrieval: {
      source: retrieval.source,
      sourceUrl: retrieval.sourceUrl,
      retrievedAt: retrieval.updatedAt
    },

    validation,

    summary:
      buildSummary(mergedPlayers),

    players:
      mergedPlayers
  };

  await writeOutput(output);

  console.log(
    `Successfully saved ${mergedPlayers.length} players.`
  );

  console.log(
    `Output: ${OUTPUT_FILE}`
  );
}

main().catch(error => {
  console.error(
    "Duke's FF26 update failed."
  );

  console.error(
    error.stack || error.message || error
  );

  process.exitCode = 1;
});
