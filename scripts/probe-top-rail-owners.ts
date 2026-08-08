#!/usr/bin/env node

/**
 * Which top rails escape the sub-element hold-back, and would the persisted
 * ownership relation catch them? For every Railing Top Rail record, prints
 * whether a railing plan-matches within 0.5 ft (the current rule), what the
 * persisted owner chain says, and the envelope that gets drawn on release.
 *
 *   node --experimental-strip-types scripts/probe-top-rail-owners.ts model.rvt
 */
import { convertModel } from "./audit-coverage.ts";

const TOP_RAIL_CATEGORY = -2_000_946;
const RAILING_CATEGORY = -2_000_126;
const TOLERANCE_FEET = 0.5;

const [rvtPath] = process.argv.slice(2);
if (!rvtPath) throw new Error("usage: probe-top-rail-owners.ts model.rvt");

const result = convertModel(rvtPath);
const records = result.elementBounds;
const byId = new Map(records.map((record) => [record.elementId, record]));
const ownerById = new Map(
  (result.elementOwnership?.relations ?? []).map((relation) => [
    relation.elementId,
    relation.ownerId,
  ]),
);
const railings = records.filter((record) => record.categoryId === RAILING_CATEGORY);
const topRails = records.filter((record) => record.categoryId === TOP_RAIL_CATEGORY);

const planMatches = (a: typeof records[number], b: typeof records[number]) =>
  Math.abs(a.boundsFeet.min.x - b.boundsFeet.min.x) <= TOLERANCE_FEET &&
  Math.abs(a.boundsFeet.min.y - b.boundsFeet.min.y) <= TOLERANCE_FEET &&
  Math.abs(a.boundsFeet.max.x - b.boundsFeet.max.x) <= TOLERANCE_FEET &&
  Math.abs(a.boundsFeet.max.y - b.boundsFeet.max.y) <= TOLERANCE_FEET;

console.log(`${topRails.length} top rails, ${railings.length} railings`);
let held = 0;
const released: string[] = [];
for (const rail of topRails) {
  const matched = railings.some((railing) => planMatches(rail, railing));
  if (matched) {
    held += 1;
    continue;
  }
  // Walk the persisted owner chain up to three hops looking for a railing.
  const chain: number[] = [];
  let cursor: number | undefined = rail.elementId;
  let owningRailing: number | null = null;
  for (let hop = 0; hop < 3 && cursor != null; hop += 1) {
    cursor = ownerById.get(cursor);
    if (cursor == null) break;
    chain.push(cursor);
    if (byId.get(cursor)?.categoryId === RAILING_CATEGORY) {
      owningRailing = cursor;
      break;
    }
  }
  const { min, max } = rail.boundsFeet;
  const chainDescription = chain.map((id) => {
    const entry = byId.get(id);
    return `${id}:${entry?.categoryName ?? entry?.categoryId ?? "absent"}`;
  });
  // The railing whose plan box agrees best with the top rail's, by the same
  // worst-corner measure the hold-back uses, plus how much of the top rail's
  // plan area that railing's plan box covers.
  let bestRailing: number | null = null;
  let bestDelta = Infinity;
  let bestOverlap = 0;
  const railArea = Math.max(1e-6,
    (rail.boundsFeet.max.x - rail.boundsFeet.min.x) *
    (rail.boundsFeet.max.y - rail.boundsFeet.min.y));
  for (const railing of railings) {
    const delta = Math.max(
      Math.abs(rail.boundsFeet.min.x - railing.boundsFeet.min.x),
      Math.abs(rail.boundsFeet.min.y - railing.boundsFeet.min.y),
      Math.abs(rail.boundsFeet.max.x - railing.boundsFeet.max.x),
      Math.abs(rail.boundsFeet.max.y - railing.boundsFeet.max.y),
    );
    const overlapX = Math.min(rail.boundsFeet.max.x, railing.boundsFeet.max.x) -
      Math.max(rail.boundsFeet.min.x, railing.boundsFeet.min.x);
    const overlapY = Math.min(rail.boundsFeet.max.y, railing.boundsFeet.max.y) -
      Math.max(rail.boundsFeet.min.y, railing.boundsFeet.min.y);
    const overlap = Math.max(0, overlapX) * Math.max(0, overlapY) / railArea;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestRailing = railing.elementId;
    }
    if (overlap > bestOverlap) bestOverlap = overlap;
  }
  released.push(
    `  ${rail.elementId} envelope ` +
    `${(max.x - min.x).toFixed(1)}x${(max.y - min.y).toFixed(1)}x${(max.z - min.z).toFixed(1)} ft` +
    ` z ${min.z.toFixed(1)}..${max.z.toFixed(1)}` +
    ` ownerChain=[${chainDescription.join(" -> ")}]` +
    ` bestRailing=${bestRailing} worstCornerDelta=${bestDelta.toFixed(2)} ft` +
    ` bestPlanOverlap=${(bestOverlap * 100).toFixed(0)}%`,
  );
}
console.log(`${held} held back by plan match, ${released.length} released:`);
for (const line of released) console.log(line);
