import { SUBSTITUTIONS } from "../constants.mjs";

export function parsePatch(s) {
  return s.split(".").map((s) => parseInt(s, 10));
}

export function comparePatches(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] > b[i]) return 1;
    else if (a[i] < b[i]) return -1;
  }
  return 0;
}

export function splitId(id) {
  return [Math.floor(id / 1000), id % 1000];
}

export function substitute(thing, sets=SUBSTITUTIONS) {
  return sets[thing] ?? thing;
}