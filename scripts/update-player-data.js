/**
 * =====================================================================
 * DUKE'S FF26 — LIVE PLAYER DATA CONTROLLER
 * Official Release: v1.1.1
 * File: scripts/update-player-data.js
 * =====================================================================
 *
 * PURPOSE
 * -------
 * 1. Retrieve current NFL player metadata from Sleeper.
 * 2. Load the previous data/live-player-data.json file.
 * 3. Preserve rankings, ADP, projections, bye weeks, news, movement,
 *    and Duke metrics already stored.
 * 4. Refresh teams, injuries, availability, and depth-chart information.
 * 5. Validate and safely write the merged database.
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

const CONTROLLER_VERSION = '1.1.1';

const OUTPUT_FILE = path.join(
  process.cwd(),
  'data',
  'live-player-data.json'
);

function isFiniteValue(value) {
  return (
    value !== null &&
    value !== undefined &&
    value !== '' &&
    Number.isFinite(Number(value))
  );
}

function createMatchKey(player = {}) {
  const name = normalizeName(player.name);

  const position = normalizePosition(
    player.position || player.pos
  );

  return `${name}|${position}`;
}

function getSleeperId(player = {}) {
  const externalId = player.externalIds?.sleeper;

  if (
    externalId !== null &&
    externalId !== undefined &&
    externalId !== ''
  ) {
    return String(externalId);
  }

  const playerId = String(player.playerId || '');

  return playerId.startsWith('sleeper:')
    ? playerId.slice('sleeper:'.length)
    : null;
}

async function readExistingData() {
  try {
    const text = await fs.readFile(
      OUTPUT_FILE,
      'utf8'
    );

    const data = JSON.parse(text);

    return {
      ...data,
      schemaVersion:
        Number(data.schemaVersion) || 1,

      players:
        Array.isArray(data.players)
          ? data.players
          : []
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return {
        schemaVersion: 1,
        season: 2026,
        scoring: 'PPR',
        sources: [],
        players: []
      };
    }

    if (error instanceof SyntaxError) {
      throw new Error(
        `Existing player JSON is invalid: ${error.message}`,
        { cause: error }
      );
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
      retrievedPlayer.playerId ||
      existingPlayer.playerId,

    externalIds: {
      ...(existingPlayer.externalIds || {}),
      ...(retrievedPlayer.externalIds || {}),

      sleeper:
        retrievedPlayer.externalIds?.sleeper ??
        existingPlayer.externalIds?.sleeper ??
        null
    },

    byeWeek:
      existingPlayer.byeWeek ??
      retrievedPlayer.byeWeek ??
      null,

    rankings: {
      ...(retrievedPlayer.rankings || {}),
      ...(existingPlayer.rankings || {})
    },

    adp: {
      ...(retrievedPlayer.adp || {}),
      ...(existingPlayer.adp || {})
    },

    projections: {
      ...(retrievedPlayer.projections || {}),
      ...(existingPlayer.projections || {})
    },

    news: {
      ...(retrievedPlayer.news || {}),
      ...(existingPlayer.news || {})
    },

    movement: {
      ...(retrievedPlayer.movement || {}),
      ...(existingPlayer.movement || {})
    },

    dukeMetrics: {
      ...(retrievedPlayer.dukeMetrics || {}),
      ...(existingPlayer.dukeMetrics || {})
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
        sleeperId,
        player
      );
    }

    const matchKey = createMatchKey(player);

    if (matchKey !== '|') {
      existingByNamePosition.set(
        matchKey,
        player
      );
    }
  }

  const mergedPlayers = [];
  const matchedExistingIds = new Set();

  for (const retrievedPlayer of retrievedPlayers) {
    const sleeperId =
      getSleeperId(retrievedPlayer);

    let existingPlayer =
      sleeperId
        ? existingBySleeperId.get(
            sleeperId
          ) || null
        : null;

    if (!existingPlayer) {
      existingPlayer =
        existingByNamePosition.get(
          createMatchKey(retrievedPlayer)
        ) || null;
    }

    if (existingPlayer?.playerId) {
      matchedExistingIds.add(
        String(existingPlayer.playerId)
      );
    }

    mergedPlayers.push(
      mergePlayerRecords(
        retrievedPlayer,
        existingPlayer
      )
    );
  }

  /*
   * Preserve manually maintained or spreadsheet-only records that Sleeper
   * does not currently return.
   */
  for (const existingPlayer of existingPlayers) {
    const existingId =
      String(existingPlayer.playerId || '');

    if (
      existingId &&
      matchedExistingIds.has(existingId)
    ) {
      continue;
    }

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

  return mergedPlayers.sort((a, b) => {
    const rankA =
      isFiniteValue(
        a.rankings?.overall
      )
        ? Number(a.rankings.overall)
        : 99999;

    const rankB =
      isFiniteValue(
        b.rankings?.overall
      )
        ? Number(b.rankings.overall)
        : 99999;

    return (
      rankA - rankB ||
      String(a.position || '')
        .localeCompare(
          String(b.position || '')
        ) ||
      String(a.name || '')
        .localeCompare(
          String(b.name || '')
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
    const playerId =
      String(player.playerId || '');

    const name =
      String(player.name || '');

    const position =
      String(player.position || '');

    if (!playerId) {
      errors.push(
        `Missing playerId: ${
          name || 'Unknown player'
        }`
      );
    }

    if (!name) {
      errors.push(
        `Missing player name: ${
          playerId || 'Unknown ID'
        }`
      );
    }

    if (!validPositions.has(position)) {
      errors.push(
        `Invalid position for ${
          name || playerId
        }: ${position || 'blank'}`
      );
    }

    if (
      playerId &&
      seenIds.has(playerId)
    ) {
      errors.push(
        `Duplicate playerId: ${playerId}`
      );
    }

    if (playerId) {
      seenIds.add(playerId);
    }

    if (errors.length >= 25) {
      break;
    }
  }

  if (errors.length > 0) {
    throw new Error(
      [
        'Player validation failed.',
        ...errors
      ].join('\n')
    );
  }

  return {
    valid: true,
    playerCount: players.length,
    uniquePlayerIds: seenIds.size
  };
}

function buildSummary(players) {
  const positionCounts = {};
  const injuryCounts = {};

  let activePlayers = 0;
  let freeAgents = 0;
  let rankedPlayers = 0;
  let playersWithAdp = 0;

  for (const player of players) {
    const position =
      player.position || 'UNKNOWN';

    positionCounts[position] =
      (positionCounts[position] || 0) + 1;

    const injuryStatus =
      player.injury?.status ||
      'Healthy';

    injuryCounts[injuryStatus] =
      (injuryCounts[injuryStatus] || 0) + 1;

    if (player.availability?.active) {
      activePlayers += 1;
    }

    if (player.availability?.freeAgent) {
      freeAgents += 1;
    }

    if (
      isFiniteValue(
        player.rankings?.overall
      )
    ) {
      rankedPlayers += 1;
    }

    if (
      isFiniteValue(
        player.adp?.consensus
      )
    ) {
      playersWithAdp += 1;
    }
  }

  return {
    totalPlayers: players.length,
    activePlayers,

    inactivePlayers:
      players.length - activePlayers,

    freeAgents,
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
    `${JSON.stringify(
      output,
      null,
      2
    )}\n`,
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
    `Existing players: ${
      existingData.players.length
    }`
  );

  console.log(
    'Retrieving current Sleeper NFL players...'
  );

  const retrieval =
    await retrievePlayers();

  console.log(
    `Retrieved players: ${
      retrieval.players.length
    }`
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
      name:
        "Duke's FF26 Live Engine",

      controllerVersion:
        CONTROLLER_VERSION,

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
        retrieval.source || 'Sleeper'
      ])
    ],

    retrieval: {
      source:
        retrieval.source,

      sourceUrl:
        retrieval.sourceUrl,

      retrievedAt:
        retrieval.updatedAt
    },

    validation,

    summary:
      buildSummary(mergedPlayers),

    players:
      mergedPlayers
  };

  await writeOutput(output);

  console.log(
    `Successfully saved ${
      mergedPlayers.length
    } players.`
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
    error.stack ||
    error.message ||
    error
  );

  process.exitCode = 1;
});
