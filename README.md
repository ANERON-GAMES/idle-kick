# @aneron/idle-kick

## Purpose

`@aneron/idle-kick` classifies players from the time of each player's last meaningful input. Given that time, a caller-supplied current time, and warn-after and kick-after thresholds, it reports each player as active, warned, or kicked. A warned player includes the whole seconds left before kick.

The library applies per-player exemptions and a minimum player count below which nobody is kicked. It returns the state transitions since a previous evaluation so a caller can send a warning once.

Inputs and outputs are plain data. The library performs no network calls, no file I/O, and does not read a clock. It has no runtime dependencies.

## Install

```sh
npm install @aneron/idle-kick
```

The package is an ES module. It requires Node.js 20 or newer.

## Usage

```js
import { evaluate } from "@aneron/idle-kick";

const result = evaluate({
  now: 1000,
  warnAfter: 300,
  kickAfter: 600,
  minPlayers: 2,
  exempt: ["p0"],
  players: [
    { id: "p0", lastInputAt: 0 },
    { id: "p1", lastInputAt: 800 },
    { id: "p2", lastInputAt: 500 },
    { id: "p3", lastInputAt: 400 },
  ],
});
```

`result.players`:

```json
[
  { "id": "p0", "status": "active", "secondsLeft": null, "exempt": true },
  { "id": "p1", "status": "active", "secondsLeft": null, "exempt": false },
  { "id": "p2", "status": "warned", "secondsLeft": 1, "exempt": false },
  { "id": "p3", "status": "kicked", "secondsLeft": null, "exempt": false }
]
```

`result.transitions`:

```json
[
  { "id": "p2", "from": null, "to": "warned", "secondsLeft": 1 },
  { "id": "p3", "from": null, "to": "kicked", "secondsLeft": null }
]
```

Pass that result as `previous` on the next call. Players who are still warned or still kicked are omitted from `transitions`.

```js
const next = evaluate({
  now: 1100,
  warnAfter: 300,
  kickAfter: 600,
  minPlayers: 2,
  exempt: ["p0"],
  players: [
    { id: "p0", lastInputAt: 0 },
    { id: "p1", lastInputAt: 800 },
    { id: "p2", lastInputAt: 500 },
    { id: "p3", lastInputAt: 400 },
  ],
  previous: result,
});
```

`next.transitions`:

```json
[
  { "id": "p1", "from": "active", "to": "warned", "secondsLeft": 1 },
  { "id": "p2", "from": "warned", "to": "kicked", "secondsLeft": null }
]
```

## API

### `evaluate(input)`

Returns `{ players, transitions }`. Throws `TypeError` or `RangeError` when `input` is invalid. Does not mutate `input`.

`input` fields:

- `now` (number, required). Current time in milliseconds. The function does not supply a default.
- `warnAfter` (number, required). Idle duration in milliseconds at which a player becomes warned. Finite and greater than or equal to 0.
- `kickAfter` (number, required). Idle duration in milliseconds at which a player becomes kicked. Finite and greater than or equal to `warnAfter`.
- `players` (array, required). Each entry is an object `{ id, lastInputAt }`. `id` is a non-empty string. `lastInputAt` is a finite number of milliseconds on the same scale as `now`. Ids in `players` must be unique. Other fields on a player object are ignored.
- `exempt` (array of non-empty strings, optional). Ids that stay active at any idle time. Defaults to an empty array. Duplicate ids are ignored. Ids that are not in `players` are ignored.
- `minPlayers` (integer, optional). When `players.length` is below this value, no player is classified as kicked. Defaults to `0`. Greater than or equal to 0.
- `previous` (optional). The previous `evaluate` result, or an array of `{ id, status }`. `status` is `active`, `warned`, or `kicked`. Ids must be unique. Used only to build `transitions`. Omit it when there is no earlier evaluation.

Each item in the returned `players` array, in input order:

- `id` (string).
- `status` (`active`, `warned`, or `kicked`).
- `secondsLeft` (integer or `null`). Whole seconds left before kick when `status` is `warned`, rounded up to the next second. `0` when remaining time is not positive, which is the case when a kick is withheld because of `minPlayers`. `null` when `status` is `active` or `kicked`. Any positive remaining time reports at least `1`.
- `exempt` (boolean). `true` when the id is listed in `exempt`.

Each item in `transitions`, in player order:

- `id` (string).
- `from` (`active`, `warned`, `kicked`, or `null`). `null` means the id was absent from `previous`.
- `to` (`active`, `warned`, or `kicked`).
- `secondsLeft` (integer or `null`). The same value as on the player result.

A transition is recorded only when the status changed. A player who is `active` and absent from `previous` is omitted. A player present in `previous` but absent from `players` is omitted. A change in `secondsLeft` alone is not a transition.

## Design notes

Idle time is `max(0, now - lastInputAt)`. A last-input time later than `now` counts as zero idle time. Timestamps are not required to be Unix epoch times. `now`, `lastInputAt`, `warnAfter`, and `kickAfter` must use one millisecond scale.

Classification for a player who is not exempt:

- Idle below `warnAfter`: `active`.
- Idle greater than or equal to `warnAfter` and below `kickAfter`: `warned`.
- Idle greater than or equal to `kickAfter`: `kicked`.

The comparisons use the raw idle time. `warnAfter` of `0` warns a player whose idle time is `0`. Equal `warnAfter` and `kickAfter` leave no warned interval: idle below the shared value is `active`, and idle at or above it is `kicked`, unless kicks are withheld.

An exempt player is `active` at any idle time. Exempt players are still entries in `players`, so they count toward `players.length`.

`minPlayers` is compared with `players.length`, not with the number of players that would remain after removing kicked players. Below that count, a player who has reached `kickAfter` is `warned` with `secondsLeft` of `0`. At or above that count, the kick classification applies. The next call can move that player to `kicked`, or back to `warned`, because each call classifies from its own input only.

`secondsLeft` is the remaining milliseconds converted to seconds and rounded up. Partial seconds count as one second. The value can change while the status stays `warned`. That change is not a transition. Read `players` for the current seconds left. Use `transitions` to send a warning or apply a kick once per status change.

The function does not invent intermediate statuses. A player who moves from `active` to past `kickAfter` between two calls produces one transition, to `kicked`.

`previous` does not change classification. Omitting `previous` is the same as an empty history. Passing the previous return value is equivalent to passing its `players` array.

Callers that remove a kicked player should omit that id from the next `players` array. The omitted id produces no further transition. The player count is the length of the array the caller passes.

The module keeps no data between calls. It does not read `Date`, `performance`, or any other clock.

## License

MIT. Copyright (c) 2026 Vadim Gubin.
