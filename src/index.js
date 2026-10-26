const ACTIVE = "active";
const WARNED = "warned";
const KICKED = "kicked";

const STATUSES = new Set([ACTIVE, WARNED, KICKED]);

export function evaluate(input) {
  const options = validate(input);
  const suppressKicks = options.players.length < options.minPlayers;
  const players = options.players.map((player) =>
    classify(player, options, suppressKicks),
  );
  return {
    players,
    transitions: diff(players, options.previous),
  };
}

function validate(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object");
  }

  assertFiniteNumber(input.now, "now");
  assertDuration(input.warnAfter, "warnAfter");
  assertDuration(input.kickAfter, "kickAfter");
  if (input.kickAfter < input.warnAfter) {
    throw new RangeError(
      "kickAfter must be greater than or equal to warnAfter",
    );
  }

  const minPlayers = input.minPlayers === undefined ? 0 : input.minPlayers;
  if (typeof minPlayers !== "number" || !Number.isInteger(minPlayers)) {
    throw new TypeError("minPlayers must be an integer");
  }
  if (minPlayers < 0) {
    throw new RangeError("minPlayers must be greater than or equal to 0");
  }

  return {
    now: input.now,
    warnAfter: input.warnAfter,
    kickAfter: input.kickAfter,
    minPlayers,
    exempt: readExempt(input.exempt),
    players: readPlayers(input.players),
    previous: readPrevious(input.previous),
  };
}

function assertFiniteNumber(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

function assertDuration(value, name) {
  assertFiniteNumber(value, name);
  if (value < 0) {
    throw new RangeError(`${name} must be greater than or equal to 0`);
  }
}

function readExempt(exempt) {
  if (exempt === undefined) {
    return new Set();
  }
  if (!Array.isArray(exempt)) {
    throw new TypeError("exempt must be an array");
  }
  const ids = new Set();
  for (const id of exempt) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("exempt id must be a non-empty string");
    }
    ids.add(id);
  }
  return ids;
}

function readPlayers(players) {
  if (!Array.isArray(players)) {
    throw new TypeError("players must be an array");
  }
  const seen = new Set();
  const result = [];
  for (const player of players) {
    if (player == null || typeof player !== "object" || Array.isArray(player)) {
      throw new TypeError("player must be an object");
    }
    if (typeof player.id !== "string" || player.id.length === 0) {
      throw new TypeError("player id must be a non-empty string");
    }
    assertFiniteNumber(player.lastInputAt, "lastInputAt");
    if (seen.has(player.id)) {
      throw new TypeError(`duplicate player id ${player.id}`);
    }
    seen.add(player.id);
    result.push({ id: player.id, lastInputAt: player.lastInputAt });
  }
  return result;
}

function readPrevious(previous) {
  if (previous === undefined) {
    return new Map();
  }
  let list;
  if (Array.isArray(previous)) {
    list = previous;
  } else if (
    previous != null &&
    typeof previous === "object" &&
    Array.isArray(previous.players)
  ) {
    list = previous.players;
  } else {
    throw new TypeError(
      "previous must be an array or an object with a players array",
    );
  }

  const statuses = new Map();
  for (const entry of list) {
    if (entry == null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new TypeError("previous player must be an object");
    }
    if (typeof entry.id !== "string" || entry.id.length === 0) {
      throw new TypeError("previous player id must be a non-empty string");
    }
    if (!STATUSES.has(entry.status)) {
      throw new TypeError(
        "previous player status must be active, warned, or kicked",
      );
    }
    if (statuses.has(entry.id)) {
      throw new TypeError(`duplicate previous player id ${entry.id}`);
    }
    statuses.set(entry.id, entry.status);
  }
  return statuses;
}

function classify(player, options, suppressKicks) {
  const exempt = options.exempt.has(player.id);
  const idle = Math.max(0, options.now - player.lastInputAt);
  if (exempt || idle < options.warnAfter) {
    return row(player.id, ACTIVE, null, exempt);
  }
  if (suppressKicks || idle < options.kickAfter) {
    return row(player.id, WARNED, secondsLeft(idle, options.kickAfter), false);
  }
  return row(player.id, KICKED, null, false);
}

function secondsLeft(idle, kickAfter) {
  const remaining = kickAfter - idle;
  if (!(remaining > 0)) {
    return 0;
  }
  const seconds = Math.ceil(remaining / 1000);
  return seconds < 1 ? 1 : seconds;
}

function row(id, status, secondsLeftValue, exempt) {
  return {
    id,
    status,
    secondsLeft: secondsLeftValue,
    exempt,
  };
}

function diff(players, previous) {
  const transitions = [];
  for (const player of players) {
    const known = previous.has(player.id);
    const from = known ? previous.get(player.id) : null;
    if (!known && player.status === ACTIVE) {
      continue;
    }
    if (from === player.status) {
      continue;
    }
    transitions.push({
      id: player.id,
      from,
      to: player.status,
      secondsLeft: player.secondsLeft,
    });
  }
  return transitions;
}
