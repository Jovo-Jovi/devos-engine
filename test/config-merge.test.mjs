import test from "node:test";
import assert from "node:assert/strict";
import { GENERATED, merge } from "../payload/files/scripts/devos/config.mjs";

test("config-merge.test.mjs merges plain objects recursively", () => {
  const merged = merge(
    { reviewer: { deep_paths: ["a"], note: "n" } },
    { reviewer: { deep_paths_extra: ["b"] } },
  );
  assert.equal(merged.reviewer.note, "n");
  assert.deepEqual(merged.reviewer.deep_paths, ["a", "b"]);
  assert.equal(Object.hasOwn(merged.reviewer, "deep_paths_extra"), false);
});

test("config-merge.test.mjs replaces scalars and arrays", () => {
  const merged = merge({ n: 1, pages: ["old"], nest: { x: 1 } }, { n: 9, pages: ["new"] });
  assert.equal(merged.n, 9);
  assert.deepEqual(merged.pages, ["new"]);
  assert.equal(merged.nest.x, 1);
});

test("config-merge.test.mjs appends _extra arrays", () => {
  const merged = merge({ items: ["a"] }, { items_extra: ["b", "c"] });
  assert.deepEqual(merged.items, ["a", "b", "c"]);
  assert.equal(Object.hasOwn(merged, "items_extra"), false);
});

test("config-merge.test.mjs throws when _extra has no array target", () => {
  assert.throws(
    () => merge({ a: 1 }, { a_extra: [2] }),
    (error) => error.message === "config: a_extra needs an array a",
  );
});

test("config-merge.test.mjs null removes a key", () => {
  const merged = merge({ keep: 1, drop: 2 }, { drop: null });
  assert.equal(merged.keep, 1);
  assert.equal(Object.hasOwn(merged, "drop"), false);
});

test("config-merge.test.mjs skips project keys that start with $", () => {
  const merged = merge({ a: 1 }, { $comment: "no", b: 2 });
  assert.equal(Object.hasOwn(merged, "$comment"), false);
  assert.equal(merged.b, 2);
  assert.equal(merged.$generated, GENERATED);
});

test("config-merge.test.mjs orders $generated, then defaults, then project-only keys", () => {
  const merged = merge({ b: 1, a: { z: 1 } }, { a: { y: 2 }, c: 3 });
  assert.deepEqual(Object.keys(merged), ["$generated", "b", "a", "c"]);
  assert.deepEqual(Object.keys(merged.a), ["z", "y"]);
});
