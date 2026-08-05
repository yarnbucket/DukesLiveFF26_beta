/**
 * =====================================================================
 * DUKE'S FF26 — PLAYER RETRIEVAL MODULE
 * Official Release: v1.0.1
 * File: scripts/retrieve-players.js
 * =====================================================================
 */

'use strict';

const MODULE_VERSION = '1.0.1';

const SLEEPER_NFL_PLAYERS_URL =
  'https://api.sleeper.app/v1/players/nfl';

const ALLOWED_POSITIONS = new Set([
  'QB',
  'RB',
  'WR',
  'TE',
  'K',
  'DEF'
]);

function normalizePosition(position) {
  const value = String(position || '')
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
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function isDefenseRecord(playerId, player = {}) {
  const position = normalizePosition(player.position);

  if (position === 'DEF') {
    return true;
  }

  const id = String(playerId || '').toUpperCase();

  return (
    id.startsWith('DEF_') ||
    String(player.full_name || '')
      .toLowerCase()
      .endsWith(' defense')
  );
}

function resolvePlayerName(playerId, player = {}) {
  if (player.full_name) {
    return String(player.full_name).trim();
  }

  const name = [
    player.first_name,
    player.last_name
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (name) {
    return name;
  }

  if (isDefenseRecord(playerId, player)) {
    return `${
      String(player.team || playerId).toUpperCase()
    } Defense`;
  }

  return String(playerId || 'Unknown Player');
}

function normalizeInjuryStatus(status) {
  const value = String(status || '').trim();

  if (!value) {
    return 'Healthy';
  }

  const labels = {
    Q: 'Questionable',
    D: 'Doubtful',
    O: 'Out',
    IR: 'Injured Reserve',
    PUP: 'PUP',
    SUS: 'Suspended'
  };

  return labels[value.toUpperCase()] || value;
}

function nullableNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function shouldIncludePlayer(playerId, player = {}) {
  const position = isDefenseRecord(playerId, player)
    ? 'DEF'
    : normalizePosition(player.position);

  return (
    ALLOWED_POSITIONS.has(position) &&
    Boolean(resolvePlayerName(playerId, player))
  );
}

function mapSleeperPlayer(
  playerId,
  player = {},
  updatedAt
) {
  const position = isDefenseRecord(playerId, player)
    ? 'DEF'
    : normalizePosition(player.position);

  const sleeperId = String(playerId);
  const team = player.team
    ? String(player.team).toUpperCase()
    : null;

  const rawInjuryStatus =
    String(player.injury_status || '');

  const injuryCode =
    rawInjuryStatus.toUpperCase();

  return {
    playerId: `sleeper:${sleeperId}`,

    externalIds: {
      sleeper: sleeperId,
      fantasyPros: null,
      espn: null,
      yahoo: null
    },

    name: resolvePlayerName(playerId, player),
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
      weeklyPoints: null
    },

    injury: {
      status: normalizeInjuryStatus(
        rawInjuryStatus
      ),

      bodyPart: String(
        player.injury_body_part || ''
      ),

      practiceStatus: String(
        player.practice_participation || ''
      ),

      notes: String(
        player.injury_notes || ''
      ),

      updatedAt
    },

    availability: {
      active: player.active !== false,
      freeAgent: !team,
      suspended: injuryCode === 'SUS',
      injuredReserve: injuryCode === 'IR',

      physicallyUnableToPerform:
        injuryCode === 'PUP'
    },

    depthChart: {
      position:
        player.depth_chart_position || null,

      order: nullableNumber(
        player.depth_chart_order
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

async function fetchSleeperPlayers() {
  const controller = new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    30000
  );

  try {
    const response = await fetch(
      SLEEPER_NFL_PLAYERS_URL,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent':
            `Dukes-FF26/${MODULE_VERSION}`
        },

        signal: controller.signal
      }
    );

    if (!response.ok) {
      throw new Error(
        `Sleeper request failed: ` +
        `${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function summarizePlayers(players) {
  const positionCounts = {};
  const injuryCounts = {};

  for (const player of players) {
    positionCounts[player.position] =
      (positionCounts[player.position] || 0) + 1;

    const injuryStatus =
      player.injury.status || 'Healthy';

    injuryCounts[injuryStatus] =
      (injuryCounts[injuryStatus] || 0) + 1;
  }

  return {
    totalPlayers: players.length,
    positionCounts,
    injuryCounts
  };
}

async function retrievePlayers() {
  const updatedAt = new Date().toISOString();

  const rawPlayers =
    await fetchSleeperPlayers();

  if (
    !rawPlayers ||
    typeof rawPlayers !== 'object' ||
    Array.isArray(rawPlayers)
  ) {
    throw new Error(
      'Sleeper returned invalid player data.'
    );
  }

  const players = Object.entries(rawPlayers)
    .filter(([playerId, player]) =>
      shouldIncludePlayer(playerId, player)
    )
    .map(([playerId, player]) =>
      mapSleeperPlayer(
        playerId,
        player,
        updatedAt
      )
    )
    .sort((a, b) =>
      a.position.localeCompare(b.position) ||
      a.name.localeCompare(b.name)
    );

  if (!players.length) {
    throw new Error(
      'No usable Sleeper players were retrieved.'
    );
  }

  return {
    schemaVersion: 1,
    moduleVersion: MODULE_VERSION,
    source: 'Sleeper',
    sourceUrl: SLEEPER_NFL_PLAYERS_URL,
    updatedAt,
    summary: summarizePlayers(players),
    players
  };
}

module.exports = {
  MODULE_VERSION,
  SLEEPER_NFL_PLAYERS_URL,
  normalizePosition,
  normalizeName,
  retrievePlayers
};
