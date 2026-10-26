import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import * as idleKick from "../src/index.js";
import { evaluate } from "../src/index.js";

function base(overrides = {}) {
  return {
    now: 1000,
    warnAfter: 300,
    kickAfter: 600,
    players: [{ id: "p1", lastInputAt: 1000 }],
    ...overrides,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("evaluate", () => {
  it("exports only evaluate", () => {
    assert.deepEqual(Object.keys(idleKick).sort(), ["evaluate"]);
  });

  it("matches the readme example", () => {
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

    assert.deepEqual(result.players, [
      { id: "p0", status: "active", secondsLeft: null, exempt: true },
      { id: "p1", status: "active", secondsLeft: null, exempt: false },
      { id: "p2", status: "warned", secondsLeft: 1, exempt: false },
      { id: "p3", status: "kicked", secondsLeft: null, exempt: false },
    ]);
    assert.deepEqual(result.transitions, [
      { id: "p2", from: null, to: "warned", secondsLeft: 1 },
      { id: "p3", from: null, to: "kicked", secondsLeft: null },
    ]);

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

    assert.deepEqual(next.players, [
      { id: "p0", status: "active", secondsLeft: null, exempt: true },
      { id: "p1", status: "warned", secondsLeft: 1, exempt: false },
      { id: "p2", status: "kicked", secondsLeft: null, exempt: false },
      { id: "p3", status: "kicked", secondsLeft: null, exempt: false },
    ]);
    assert.deepEqual(next.transitions, [
      { id: "p1", from: "active", to: "warned", secondsLeft: 1 },
      { id: "p2", from: "warned", to: "kicked", secondsLeft: null },
    ]);
  });

  describe("classification", () => {
    it("classifies boundaries against warnAfter and kickAfter", () => {
      const now = 1_000_000;
      const warnAfter = 60_000;
      const kickAfter = 180_000;
      const cases = [
        { idle: 0, status: "active", secondsLeft: null },
        { idle: 59_999, status: "active", secondsLeft: null },
        { idle: 60_000, status: "warned", secondsLeft: 120 },
        { idle: 120_000, status: "warned", secondsLeft: 60 },
        { idle: 178_999, status: "warned", secondsLeft: 2 },
        { idle: 179_000, status: "warned", secondsLeft: 1 },
        { idle: 179_001, status: "warned", secondsLeft: 1 },
        { idle: 179_999, status: "warned", secondsLeft: 1 },
        { idle: 180_000, status: "kicked", secondsLeft: null },
        { idle: 180_001, status: "kicked", secondsLeft: null },
      ];

      const result = evaluate({
        now,
        warnAfter,
        kickAfter,
        players: cases.map((entry, index) => ({
          id: `p${index}`,
          lastInputAt: now - entry.idle,
        })),
      });

      assert.deepEqual(
        result.players.map(({ status, secondsLeft }) => ({
          status,
          secondsLeft,
        })),
        cases.map(({ status, secondsLeft }) => ({ status, secondsLeft })),
      );
    });

    it("treats a future last input as zero idle", () => {
      const result = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 5_000 }],
        }),
      );
      assert.deepEqual(result.players[0], {
        id: "p1",
        status: "active",
        secondsLeft: null,
        exempt: false,
      });
      assert.deepEqual(result.transitions, []);
    });

    it("uses fractional milliseconds without rounding idle first", () => {
      const active = evaluate(
        base({
          now: 300,
          players: [{ id: "p1", lastInputAt: 0.1 }],
        }),
      );
      const warned = evaluate(
        base({
          now: 300,
          players: [{ id: "p1", lastInputAt: 0 }],
        }),
      );
      assert.equal(active.players[0].status, "active");
      assert.equal(warned.players[0].status, "warned");
      assert.equal(warned.players[0].secondsLeft, 1);
    });

    it("accepts negative timestamps on one scale", () => {
      const result = evaluate({
        now: -1000,
        warnAfter: 100,
        kickAfter: 200,
        players: [
          { id: "fresh", lastInputAt: -1000 },
          { id: "idle", lastInputAt: -1300 },
        ],
      });
      assert.deepEqual(result.players, [
        { id: "fresh", status: "active", secondsLeft: null, exempt: false },
        { id: "idle", status: "kicked", secondsLeft: null, exempt: false },
      ]);
    });

    it("classifies large safe integer timestamps", () => {
      const now = Number.MAX_SAFE_INTEGER;
      const result = evaluate({
        now,
        warnAfter: 100,
        kickAfter: 500,
        players: [{ id: "p1", lastInputAt: now - 1000 }],
      });
      assert.equal(result.players[0].status, "kicked");
    });

    it("warns immediately when warnAfter is 0 and kickAfter is later", () => {
      const result = evaluate({
        now: 10,
        warnAfter: 0,
        kickAfter: 5000,
        players: [{ id: "p1", lastInputAt: 10 }],
      });
      assert.deepEqual(result.players[0], {
        id: "p1",
        status: "warned",
        secondsLeft: 5,
        exempt: false,
      });
    });

    it("kicks at a shared zero threshold", () => {
      const result = evaluate({
        now: 50,
        warnAfter: 0,
        kickAfter: 0,
        players: [
          { id: "a", lastInputAt: 50 },
          { id: "b", lastInputAt: 0 },
        ],
      });
      assert.deepEqual(
        result.players.map((player) => player.status),
        ["kicked", "kicked"],
      );
    });

    it("skips the warned interval when the thresholds are equal", () => {
      const result = evaluate({
        now: 1000,
        warnAfter: 500,
        kickAfter: 500,
        players: [
          { id: "early", lastInputAt: 600 },
          { id: "exact", lastInputAt: 500 },
        ],
      });
      assert.deepEqual(result.players, [
        { id: "early", status: "active", secondsLeft: null, exempt: false },
        { id: "exact", status: "kicked", secondsLeft: null, exempt: false },
      ]);
      assert.deepEqual(result.transitions, [
        { id: "exact", from: null, to: "kicked", secondsLeft: null },
      ]);
    });

    it("reports at least one second for a tiny positive remainder", () => {
      const result = evaluate({
        now: 0,
        warnAfter: 0,
        kickAfter: Number.MIN_VALUE,
        players: [{ id: "p1", lastInputAt: 0 }],
      });
      assert.equal(result.players[0].status, "warned");
      assert.equal(result.players[0].secondsLeft, 1);
    });

    it("preserves player order and does not sort transition ids", () => {
      const result = evaluate(
        base({
          players: [
            { id: "z", lastInputAt: 0 },
            { id: "a", lastInputAt: 1000 },
            { id: "m", lastInputAt: 500 },
          ],
        }),
      );
      assert.deepEqual(
        result.players.map((player) => player.id),
        ["z", "a", "m"],
      );
      assert.deepEqual(
        result.transitions.map((transition) => transition.id),
        ["z", "m"],
      );
    });

    it("keeps only id, status, secondsLeft, and exempt on each player", () => {
      const result = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 1000, name: "unused" }],
          note: "unused",
        }),
      );
      assert.deepEqual(Object.keys(result), ["players", "transitions"]);
      assert.deepEqual(Object.keys(result.players[0]), [
        "id",
        "status",
        "secondsLeft",
        "exempt",
      ]);
      assert.equal(result.players[0].name, undefined);
    });

    it("returns an empty plan for an empty roster", () => {
      assert.deepEqual(evaluate(base({ players: [] })), {
        players: [],
        transitions: [],
      });
      assert.deepEqual(evaluate(base({ players: [], minPlayers: 1 })), {
        players: [],
        transitions: [],
      });
    });

    it("accepts a non-empty id that is only whitespace", () => {
      const result = evaluate(
        base({
          players: [{ id: " ", lastInputAt: 1000 }],
        }),
      );
      assert.equal(result.players[0].id, " ");
    });
  });

  describe("exemptions", () => {
    it("keeps an exempt player active past the kick threshold", () => {
      const result = evaluate(
        base({
          exempt: ["p1"],
          players: [{ id: "p1", lastInputAt: 0 }],
        }),
      );
      assert.deepEqual(result.players[0], {
        id: "p1",
        status: "active",
        secondsLeft: null,
        exempt: true,
      });
      assert.deepEqual(result.transitions, []);
    });

    it("ignores exempt ids that are not in the roster", () => {
      const result = evaluate(
        base({
          exempt: ["missing", "p1"],
          players: [{ id: "p1", lastInputAt: 0 }],
        }),
      );
      assert.equal(result.players.length, 1);
      assert.equal(result.players[0].exempt, true);
      assert.equal(result.players[0].status, "active");
    });

    it("treats duplicate exempt ids as one exemption", () => {
      const once = evaluate(base({ exempt: ["p1"] }));
      const twice = evaluate(base({ exempt: ["p1", "p1"] }));
      assert.deepEqual(once, twice);
    });

    it("counts exempt players toward minPlayers", () => {
      const kicked = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 2,
        exempt: ["p0"],
        players: [
          { id: "p0", lastInputAt: 0 },
          { id: "p1", lastInputAt: 0 },
        ],
      });
      assert.equal(kicked.players[0].status, "active");
      assert.equal(kicked.players[0].exempt, true);
      assert.equal(kicked.players[1].status, "kicked");

      const withheld = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 3,
        exempt: ["p0"],
        players: [
          { id: "p0", lastInputAt: 0 },
          { id: "p1", lastInputAt: 0 },
        ],
      });
      assert.equal(withheld.players[1].status, "warned");
      assert.equal(withheld.players[1].secondsLeft, 0);
    });

    it("transitions to active when a player becomes exempt", () => {
      const result = evaluate(
        base({
          exempt: ["p1"],
          players: [{ id: "p1", lastInputAt: 0 }],
          previous: [{ id: "p1", status: "warned" }],
        }),
      );
      assert.deepEqual(result.transitions, [
        { id: "p1", from: "warned", to: "active", secondsLeft: null },
      ]);
    });

    it("emits no transition when an exempt player was already active", () => {
      const result = evaluate(
        base({
          exempt: ["p1"],
          players: [{ id: "p1", lastInputAt: 0 }],
          previous: [{ id: "p1", status: "active" }],
        }),
      );
      assert.deepEqual(result.transitions, []);
    });
  });

  describe("minPlayers", () => {
    it("kicks when the roster length equals minPlayers", () => {
      const result = evaluate(
        base({
          minPlayers: 1,
          players: [{ id: "p1", lastInputAt: 0 }],
        }),
      );
      assert.equal(result.players[0].status, "kicked");
    });

    it("withholds every kick when the roster is below minPlayers", () => {
      const result = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 3,
        players: [
          { id: "past", lastInputAt: 0 },
          { id: "inside", lastInputAt: 850 },
        ],
      });
      assert.deepEqual(result.players, [
        { id: "past", status: "warned", secondsLeft: 0, exempt: false },
        { id: "inside", status: "warned", secondsLeft: 1, exempt: false },
      ]);
      assert.deepEqual(result.transitions, [
        { id: "past", from: null, to: "warned", secondsLeft: 0 },
        { id: "inside", from: null, to: "warned", secondsLeft: 1 },
      ]);
    });

    it("defaults minPlayers to 0", () => {
      const implicit = evaluate(
        base({ players: [{ id: "p1", lastInputAt: 0 }] }),
      );
      const explicit = evaluate(
        base({ minPlayers: 0, players: [{ id: "p1", lastInputAt: 0 }] }),
      );
      assert.deepEqual(implicit, explicit);
      assert.equal(implicit.players[0].status, "kicked");
    });

    it("moves a withheld player to kicked once the roster is large enough", () => {
      const below = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 2,
        players: [{ id: "p1", lastInputAt: 0 }],
      });
      assert.equal(below.players[0].status, "warned");
      assert.equal(below.players[0].secondsLeft, 0);

      const atMinimum = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 2,
        players: [
          { id: "p1", lastInputAt: 0 },
          { id: "p2", lastInputAt: 1000 },
        ],
        previous: below,
      });
      assert.equal(atMinimum.players[0].status, "kicked");
      assert.equal(atMinimum.players[1].status, "active");
      assert.deepEqual(atMinimum.transitions, [
        { id: "p1", from: "warned", to: "kicked", secondsLeft: null },
      ]);

      const dropped = evaluate({
        now: 1000,
        warnAfter: 100,
        kickAfter: 200,
        minPlayers: 2,
        players: [{ id: "p1", lastInputAt: 0 }],
        previous: atMinimum,
      });
      assert.equal(dropped.players[0].status, "warned");
      assert.deepEqual(dropped.transitions, [
        { id: "p1", from: "kicked", to: "warned", secondsLeft: 0 },
      ]);
    });

    it("withholds kicks when equal thresholds meet a short roster", () => {
      const result = evaluate({
        now: 1000,
        warnAfter: 500,
        kickAfter: 500,
        minPlayers: 5,
        players: [{ id: "exact", lastInputAt: 500 }],
      });
      assert.deepEqual(result.players[0], {
        id: "exact",
        status: "warned",
        secondsLeft: 0,
        exempt: false,
      });
    });
  });

  describe("transitions", () => {
    it("omits a new active player and includes a new warned or kicked player", () => {
      const result = evaluate(
        base({
          players: [
            { id: "active", lastInputAt: 1000 },
            { id: "warned", lastInputAt: 500 },
            { id: "kicked", lastInputAt: 0 },
          ],
        }),
      );
      assert.deepEqual(result.transitions, [
        { id: "warned", from: null, to: "warned", secondsLeft: 1 },
        { id: "kicked", from: null, to: "kicked", secondsLeft: null },
      ]);
    });

    it("does not repeat a warning while secondsLeft changes", () => {
      let previous;
      let transitionCount = 0;
      for (let i = 0; i < 5; i += 1) {
        const result = evaluate({
          now: 1000 + i * 1000,
          warnAfter: 100,
          kickAfter: 100_000,
          players: [{ id: "p", lastInputAt: 0 }],
          previous,
        });
        transitionCount += result.transitions.length;
        assert.equal(result.players[0].status, "warned");
        previous = result;
      }
      assert.equal(transitionCount, 1);
      assert.equal(previous.players[0].secondsLeft, 95);

      const kicked = evaluate({
        now: 100_000,
        warnAfter: 100,
        kickAfter: 100_000,
        players: [{ id: "p", lastInputAt: 0 }],
        previous,
      });
      assert.deepEqual(kicked.transitions, [
        { id: "p", from: "warned", to: "kicked", secondsLeft: null },
      ]);
    });

    it("jumps from active to kicked without a synthetic warning", () => {
      const result = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 0 }],
          previous: [{ id: "p1", status: "active" }],
        }),
      );
      assert.deepEqual(result.transitions, [
        { id: "p1", from: "active", to: "kicked", secondsLeft: null },
      ]);
    });

    it("returns to active after a later input", () => {
      const fromWarned = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 1000 }],
          previous: [{ id: "p1", status: "warned" }],
        }),
      );
      const fromKicked = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 1000 }],
          previous: [{ id: "p1", status: "kicked" }],
        }),
      );
      assert.deepEqual(fromWarned.transitions, [
        { id: "p1", from: "warned", to: "active", secondsLeft: null },
      ]);
      assert.deepEqual(fromKicked.transitions, [
        { id: "p1", from: "kicked", to: "active", secondsLeft: null },
      ]);
    });

    it("omits players that stay kicked or stay warned", () => {
      const result = evaluate(
        base({
          players: [
            { id: "still", lastInputAt: 0 },
            { id: "holding", lastInputAt: 500 },
          ],
          previous: [
            { id: "still", status: "kicked" },
            { id: "holding", status: "warned" },
          ],
        }),
      );
      assert.deepEqual(result.transitions, []);
    });

    it("ignores previous ids that are absent from the current roster", () => {
      const result = evaluate(
        base({
          players: [{ id: "a", lastInputAt: 1000 }],
          previous: [
            { id: "a", status: "warned" },
            { id: "b", status: "kicked" },
          ],
        }),
      );
      assert.deepEqual(result.transitions, [
        { id: "a", from: "warned", to: "active", secondsLeft: null },
      ]);
    });

    it("accepts a previous result and an array of statuses equally", () => {
      const first = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 500 }],
        }),
      );
      const fromResult = evaluate(
        base({
          now: 1200,
          players: [{ id: "p1", lastInputAt: 500 }],
          previous: first,
        }),
      );
      const fromArray = evaluate(
        base({
          now: 1200,
          players: [{ id: "p1", lastInputAt: 500 }],
          previous: [{ id: "p1", status: "warned" }],
        }),
      );
      assert.deepEqual(fromResult, fromArray);
      assert.equal(fromResult.players[0].status, "kicked");
    });

    it("treats an omitted previous and an empty players history equally", () => {
      const players = [{ id: "p1", lastInputAt: 500 }];
      const omitted = evaluate(base({ players }));
      const emptyResult = evaluate(
        base({ players, previous: { players: [], transitions: [] } }),
      );
      const emptyArray = evaluate(base({ players, previous: [] }));
      assert.deepEqual(omitted, emptyResult);
      assert.deepEqual(omitted, emptyArray);
    });

    it("copies secondsLeft onto the transition", () => {
      const result = evaluate(
        base({
          now: 1_000_000,
          warnAfter: 60_000,
          kickAfter: 180_000,
          players: [{ id: "p1", lastInputAt: 1_000_000 - 60_000 }],
        }),
      );
      assert.equal(result.transitions[0].secondsLeft, 120);
      assert.equal(
        result.transitions[0].secondsLeft,
        result.players[0].secondsLeft,
      );
      assert.deepEqual(Object.keys(result.transitions[0]), [
        "id",
        "from",
        "to",
        "secondsLeft",
      ]);
    });
  });

  describe("purity", () => {
    it("does not mutate input or previous", () => {
      const input = base({
        exempt: ["other"],
        players: [
          { id: "p1", lastInputAt: 500, extra: true },
          { id: "p2", lastInputAt: 1000 },
        ],
        previous: [{ id: "p1", status: "active" }],
      });
      const snapshot = clone(input);
      evaluate(input);
      assert.deepEqual(input, snapshot);
    });

    it("does not mutate input when validation throws", () => {
      const input = base({
        players: [
          { id: "a", lastInputAt: 1 },
          { id: "a", lastInputAt: 2 },
        ],
      });
      const snapshot = clone(input);
      assert.throws(() => evaluate(input), TypeError);
      assert.deepEqual(input, snapshot);
    });

    it("returns new objects and keeps no state between calls", () => {
      const activeInput = base();
      const kickedInput = base({
        players: [{ id: "p1", lastInputAt: 0 }],
      });
      const first = evaluate(activeInput);
      const kicked = evaluate(kickedInput);
      const second = evaluate(activeInput);
      first.players[0].status = "kicked";
      first.transitions.push({
        id: "x",
        from: null,
        to: "active",
        secondsLeft: null,
      });
      assert.deepEqual(second, evaluate(activeInput));
      assert.notStrictEqual(second.players, first.players);
      assert.notStrictEqual(
        second.players[0],
        evaluate(activeInput).players[0],
      );
      assert.equal(kicked.players[0].status, "kicked");
      assert.equal(second.players[0].status, "active");
    });

    it("round-trips the result through JSON", () => {
      const result = evaluate(
        base({
          players: [{ id: "p1", lastInputAt: 500 }],
        }),
      );
      assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
    });

    it("does not read the clock", () => {
      const originalNow = Date.now;
      const OriginalDate = Date;
      Date.now = () => {
        throw new Error("clock read");
      };
      try {
        const result = evaluate(base());
        assert.equal(result.players[0].status, "active");
      } finally {
        Date.now = originalNow;
        globalThis.Date = OriginalDate;
      }
    });
  });

  describe("validation", () => {
    it("rejects a non-object input", () => {
      for (const value of [undefined, null, 1, "x", []]) {
        assert.throws(() => evaluate(value), {
          name: "TypeError",
          message: /input must be an object/,
        });
      }
    });

    it("rejects a non-finite now", () => {
      for (const now of [
        undefined,
        null,
        "1000",
        Number.NaN,
        Infinity,
        -Infinity,
      ]) {
        assert.throws(() => evaluate(base({ now })), {
          name: "TypeError",
          message: /now must be a finite number/,
        });
      }
    });

    it("rejects a bad duration", () => {
      for (const warnAfter of [undefined, "1", Number.NaN, Infinity]) {
        assert.throws(() => evaluate(base({ warnAfter })), {
          name: "TypeError",
          message: /warnAfter must be a finite number/,
        });
      }
      assert.throws(() => evaluate(base({ warnAfter: -1 })), {
        name: "RangeError",
        message: /warnAfter must be greater than or equal to 0/,
      });
      assert.throws(() => evaluate(base({ kickAfter: -1 })), {
        name: "RangeError",
        message: /kickAfter must be greater than or equal to 0/,
      });
      assert.throws(() => evaluate(base({ warnAfter: 20, kickAfter: 10 })), {
        name: "RangeError",
        message: /kickAfter must be greater than or equal to warnAfter/,
      });
    });

    it("rejects a bad minPlayers", () => {
      for (const minPlayers of [null, 1.5, "2", Number.NaN, Infinity]) {
        assert.throws(() => evaluate(base({ minPlayers })), {
          name: "TypeError",
          message: /minPlayers must be an integer/,
        });
      }
      assert.throws(() => evaluate(base({ minPlayers: -1 })), {
        name: "RangeError",
        message: /minPlayers must be greater than or equal to 0/,
      });
    });

    it("rejects a bad players array", () => {
      assert.throws(() => evaluate(base({ players: null })), {
        name: "TypeError",
        message: /players must be an array/,
      });
      assert.throws(() => evaluate(base({ players: {} })), TypeError);
      for (const player of [null, undefined, [], "p1"]) {
        assert.throws(() => evaluate(base({ players: [player] })), {
          name: "TypeError",
          message: /player must be an object/,
        });
      }
      assert.throws(() => evaluate(base({ players: [{ lastInputAt: 0 }] })), {
        name: "TypeError",
        message: /player id must be a non-empty string/,
      });
      for (const id of ["", 1, null]) {
        assert.throws(
          () => evaluate(base({ players: [{ id, lastInputAt: 0 }] })),
          TypeError,
        );
      }
      assert.throws(
        () =>
          evaluate(
            base({
              players: [{ id: "p1" }],
            }),
          ),
        {
          name: "TypeError",
          message: /lastInputAt must be a finite number/,
        },
      );
      assert.throws(
        () =>
          evaluate(
            base({
              players: [{ id: "p1", lastInputAt: Number.NaN }],
            }),
          ),
        TypeError,
      );
      assert.throws(
        () =>
          evaluate(
            base({
              players: [
                { id: "a", lastInputAt: 1 },
                { id: "a", lastInputAt: 2 },
              ],
            }),
          ),
        {
          name: "TypeError",
          message: /duplicate player id a/,
        },
      );
    });

    it("rejects a bad exempt list", () => {
      for (const exempt of [null, "p1", new Set(["p1"])]) {
        assert.throws(() => evaluate(base({ exempt })), {
          name: "TypeError",
          message: /exempt must be an array/,
        });
      }
      for (const exempt of [[""], [1], ["ok", ""]]) {
        assert.throws(() => evaluate(base({ exempt })), {
          name: "TypeError",
          message: /exempt id must be a non-empty string/,
        });
      }
    });

    it("rejects a bad previous value", () => {
      for (const previous of [null, "no", { id: "p1", status: "active" }, 1]) {
        assert.throws(() => evaluate(base({ previous })), {
          name: "TypeError",
          message:
            /previous must be an array or an object with a players array/,
        });
      }
      assert.throws(
        () => evaluate(base({ previous: { players: "no" } })),
        TypeError,
      );
      assert.throws(() => evaluate(base({ previous: [null] })), {
        name: "TypeError",
        message: /previous player must be an object/,
      });
      assert.throws(() => evaluate(base({ previous: [[{ id: "a" }]] })), {
        name: "TypeError",
        message: /previous player must be an object/,
      });
      assert.throws(
        () => evaluate(base({ previous: [{ id: "", status: "active" }] })),
        {
          name: "TypeError",
          message: /previous player id must be a non-empty string/,
        },
      );
      assert.throws(
        () => evaluate(base({ previous: [{ status: "active" }] })),
        TypeError,
      );
      assert.throws(
        () => evaluate(base({ previous: [{ id: "a", status: "idle" }] })),
        {
          name: "TypeError",
          message: /previous player status must be active, warned, or kicked/,
        },
      );
      assert.throws(
        () =>
          evaluate(
            base({
              previous: [
                { id: "a", status: "active" },
                { id: "a", status: "warned" },
              ],
            }),
          ),
        {
          name: "TypeError",
          message: /duplicate previous player id a/,
        },
      );
      assert.throws(
        () => evaluate(base({ previous: [{ id: "a", status: "Active" }] })),
        TypeError,
      );
    });
  });

  it("keeps platform calls out of the implementation", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/index.js", import.meta.url)),
      "utf8",
    );
    assert.equal(source.includes("//"), false);
    assert.equal(source.includes("/*"), false);
    assert.equal(/\bimport\b/.test(source), false);
    assert.equal(
      /\b(Date|performance|fetch|setTimeout|setInterval|process|require|fs|http|https|net|child_process)\b/.test(
        source,
      ),
      false,
    );
  });
});
