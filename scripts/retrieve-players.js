/**
 * =====================================================================
 * DUKE'S FF26 — PLAYER RETRIEVAL MODULE
 * Official Release: v1.0.0
 * File: scripts/retrieve-players.js
 * =====================================================================
 */

'use strict';

const SLEEPER_NFL_PLAYERS_URL =
  'https://api.sleeper.app/v1/players/nfl';

const MODULE_VERSION = '1.0.0';

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 3;

const ALLOWED_POSITIONS = new Set([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF'
]);

function sleep(milliseconds) {
  return new Promise(resolve => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizePosition(position) {
  const value = String(position ?? '')
    .trim()
    .toUpperCase();

  if (
    value === 'DST' ||
    value === 'D/ST' ||
    value === 'DEFENSE'
  ) {
    return 'DEF';
  }

  return value;
}

function normalizeName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function createFallbackPlayerId(name, position) {
  const cleanName =
    normalizeName(name) || 'unknown-player';

  const cleanPosition =
    normalizePosition(position).toLowerCase() || 'unknown';

  return `${cleanName}-${cleanPosition}`;
}

function isDefenseRecord(playerId, player = {}) {
  const position = normalizePosition(player.position);

  if (position === 'DEF') return true;

  const id = String(playerId ?? '').toUpperCase();
  const fullName = String(player.full_name ?? '')
    .trim()
    .toLowerCase();

  return (
    id.startsWith('DEF_') ||
    fullName.endsWith(' defense') ||
    fullName.endsWith(' dst')
  );
}

function resolvePlayerName(playerId, player = {}) {
  const fullName = String(player.full_name ?? '').trim();

  if (fullName) return fullName;

  const firstName = String(player.first_name ?? '').trim();
  const lastName = String(player.last_name ?? '').trim();
  const combinedName = `${firstName} ${lastName}`.trim();

  if (combinedName) return combinedName;

  if (isDefenseRecord(playerId, player)) {
    const team = String(
      player.team ?? playerId ?? 'Unknown'
    ).toUpperCase();

    return `${team} Defense`;
  }

  return String(playerId ?? 'Unknown Player');
}

function normalizeInjuryStatus(status) {
  const value = String(status ?? '').trim();

  if (!value) return 'Healthy';

  const upper = value.toUpperCase();

  const labels = {
    Q: 'Questionable',
    D: 'Doubtful',
    O: 'Out',
    IR: 'Injured Reserve',
    PUP: 'PUP',
    SUS: 'Suspended'
  };

  return labels[upper] ?? value;
}

function nullableFiniteNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function shouldIncludePlayer(playerId, rawPlayer = {}) {
  const position = isDefenseRecord(playerId, rawPlayer)
    ? 'DEF'
    : normalizePosition(rawPlayer.position);

  if (!ALLOWED_POSITIONS.has(position)) {
    return false;
  }

  const name = resolvePlayerName(playerId, rawPlayer);

  return Boolean(name && position);
}

function mapSleeperPlayer(
  playerId,
  rawPlayer = {},
  updatedAt
) {
  const position = isDefenseRecord(playerId, rawPlayer)
    ? 'DEF'
    : normalizePosition(rawPlayer.position);

  const name = resolvePlayerName(playerId, rawPlayer);
  const sleeperId = String(playerId ?? '').trim();

  const rawInjuryStatus = String(
    rawPlayer.injury_status ?? ''
  ).trim();

  const normalizedInjuryCode =
    rawInjuryStatus.toUpperCase();

  const team = rawPlayer.team
    ? String(rawPlayer.team).toUpperCase()
    : null;

  return {
    playerId: sleeperId
      ? `sleeper:${sleeperId}`
      : createFallbackPlayerId(name, position),

    externalIds: {
      sleeper: sleeperId || null,
      fantasyPros: null,
      espn: null,
      yahoo: null
    },

    name,
    position,
    team,
    byeWeek: null,

    rankings: {
      overall: null,
      position: null,
      tier: null,
      fantasyPros: null,
      espn: null,
      yahoo: null,
      sleeper: null
    },

    adp: {
      consensus: null,
      fantasyPros: null,
      espn: null,
      yahoo: null,
      sleeper: null
    },

    projections: {
      seasonPoints: null,
      weeklyPoints: null,
      receptions: null,
      passingYards: null,
      passingTouchdowns: null,
      rushingYards: null,
      rushingTouchdowns: null,
      receivingYards: null,
      receivingTouchdowns: null
    },

    injury: {
      status: normalizeInjuryStatus(rawInjuryStatus),

      bodyPart: String(
        rawPlayer.injury_body_part ?? ''
      ),

      practiceStatus: String(
        rawPlayer.practice_participation ?? ''
      ),

      notes: String(
        rawPlayer.injury_notes ?? ''
      ),

      updatedAt
    },

    availability: {
      active: rawPlayer.active !== false,
      freeAgent: !team,
      suspended: normalizedInjuryCode === 'SUS',
      injuredReserve: normalizedInjuryCode === 'IR',
      physicallyUnableToPerform:
        normalizedInjuryCode === 'PUP'
    },

    depthChart: {
      position:
        rawPlayer.depth_chart_position ?? null,

      order: nullableFiniteNumber(
        rawPlayer.depth_chart_order
      )
    },

    news: {
      headline: '',
      summary: '',
      source: '',
      publishedAt: null
    },

    movement: {
      previousRank: null,
      rankChange: 0,
      previousAdp: null,
      adpChange: 0,
      trend: 'neutral'
    },

    dukeMetrics: {
      draftScore: null,
      valueScore: null,
      injuryRisk: null,
      roleRisk: null,
      upsideScore: null,
      floorScore: null,
      scarcityScore: null,
      confidenceScore: null,
      sleeperScore: null,
      bustRisk: null
    },

    sources: ['Sleeper'],
    updatedAt
  };
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

async function fetchJsonWithRetry(
  url,
  {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES
  } = {}
) {
  if (
    !Number.isInteger(retries) ||
    retries < 1
  ) {
    throw new TypeError(
      'retries must be a positive integer.'
    );
  }

  if (
    !Number.isFinite(timeoutMs) ||
    timeoutMs <= 0
  ) {
    throw new TypeError(
      'timeoutMs must be a positive number.'
    );
  }

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= retries;
    attempt += 1
  ) {
    const controller = new AbortController();

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',

        headers: {
          Accept: 'application/json',
          'User-Agent':
            `Dukes-FF26-Data-Updater/${MODULE_VERSION}`
        },

        signal: controller.signal
      });

      if (!response.ok) {
        const error = new Error(
          `HTTP ${response.status} ${response.statusText}`
        );

        error.status = response.status;

        if (!isRetryableStatus(response.status)) {
          throw error;
        }

        lastError = error;
      } else {
        const contentType = String(
          response.headers.get('content-type') ?? ''
        ).toLowerCase();

        if (!contentType.includes('application/json')) {
          throw new TypeError(
            `Expected JSON but received: ` +
            `${contentType || 'unknown content type'}`
          );
        }

        return await response.json();
      }
    } catch (error) {
      lastError = error;

      const status = Number(error?.status);

      const retryable =
        error?.name === 'AbortError' ||
        !Number.isFinite(status) ||
        isRetryableStatus(status);

      if (!retryable || attempt >= retries) {
        throw new Error(
          `Unable to retrieve ${url}: ` +
          `${error?.message || String(error)}`,
          { cause: error }
        );
      }
    } finally {
      clearTimeout(timeout);
    }

    if (attempt < retries) {
      const backoffMs = 1000 * (2 ** (attempt - 1));
      await sleep(backoffMs);
    }
  }

  throw new Error(
    `Unable to retrieve ${url} after ` +
    `${retries} attempts: ` +
    `${lastError?.message || String(lastError)}`
  );
}

function summarizePlayers(players) {
  if (!Array.isArray(players)) {
    throw new TypeError(
      'summarizePlayers requires an array.'
    );
  }

  const positionCounts = {};
  const injuryCounts = {};

  let activePlayers = 0;
  let freeAgents = 0;

  for (const player of players) {
    positionCounts[player.position] =
      (positionCounts[player.position] ?? 0) + 1;

    const injuryStatus =
      player.injury?.status || 'Healthy';

    injuryCounts[injuryStatus] =
      (injuryCounts[injuryStatus] ?? 0) + 1;

    if (player.availability?.active) {
      activePlayers += 1;
    }

    if (player.availability?.freeAgent) {
      freeAgents += 1;
    }
  }

  return {
    totalPlayers: players.length,
    activePlayers,

    inactivePlayers:
      players.length - activePlayers,

    freeAgents,
    positionCounts,
    injuryCounts
  };
}

async function retrievePlayers(options = {}) {
  const updatedAt = new Date().toISOString();

  const rawPlayers = await fetchJsonWithRetry(
    SLEEPER_NFL_PLAYERS_URL,
    options
  );

  if (
    rawPlayers === null ||
    typeof rawPlayers !== 'object' ||
    Array.isArray(rawPlayers)
  ) {
    throw new TypeError(
      'Sleeper returned an unexpected player-data format.'
    );
  }

  const players = Object.entries(rawPlayers)
    .filter(([playerId, rawPlayer]) => {
      return shouldIncludePlayer(
        playerId,
        rawPlayer
      );
    })
    .map(([playerId, rawPlayer]) => {
      return mapSleeperPlayer(
        playerId,
        rawPlayer,
        updatedAt
      );
    })
    .sort((a, b) => {
      return (
        a.position.localeCompare(b.position) ||
        a.name.localeCompare(b.name)
      );
    });

  if (players.length === 0) {
    throw new Error(
      'Sleeper retrieval returned no usable fantasy players.'
    );
  }

  return {
    schemaVersion: 1,
    moduleVersion: MODULE_VERSION,
    source: 'Sleeper',
    sourceUrl: SLEEPER_NFL_PLAYERS_URL,
    updatedAt,
    players,
    summary: summarizePlayers(players)
  };
}

module.exports = {
  MODULE_VERSION,
  SLEEPER_NFL_PLAYERS_URL,
  normalizePosition,
  normalizeName,
  createFallbackPlayerId,
  isDefenseRecord,
  resolvePlayerName,
  normalizeInjuryStatus,
  nullableFiniteNumber,
  shouldIncludePlayer,
  mapSleeperPlayer,
  fetchJsonWithRetry,
  summarizePlayers,
  retrievePlayers
};
