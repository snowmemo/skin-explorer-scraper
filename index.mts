import isEqual from "lodash/isEqual.js";
import axios from "axios";
import { cache } from "./lib/cache.mts";
import { CDRAGON, SKIN_SCRAPE_INTERVAL } from "./constants.mts";
import { fetchSkinChanges } from "./lib/skin-changes.mts";
import { substitute } from "./lib/helpers.mts";
import { Champion, Skinline, Skins, Universe } from "./types";

const dataURL = (p: string, patch = "pbe") =>
  `${CDRAGON}/${patch}/plugins/rcp-be-lol-game-data/global/default${p}`;

async function getLatestChampions(patch = "pbe"): Promise<Champion[]> {
  const data: Champion[] = (await axios.get(dataURL("/v1/champion-summary.json", patch))).data;
  console.log(`[CDragon] [${patch}] Loaded champions.`);
  return data
    .filter((d) => d.id !== -1)
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((a) => ({ ...a, key: substitute(a.alias.toLowerCase()) }));
}

async function getLatestUniverses(patch = "pbe"): Promise<Universe[]> {
  const data: Universe[] = (await axios.get(dataURL("/v1/universes.json", patch))).data;
  console.log(`[CDragon] [${patch}] Loaded universes.`);

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkinlines(patch = "pbe"): Promise<Skinline[]> {
  const data: Skinline[] = (await axios.get(dataURL("/v1/skinlines.json", patch))).data;
  console.log(`[CDragon] [${patch}] Loaded skinlines.`);

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkins(patch = "pbe"): Promise<Skins> {
  const data: Skins = (await axios.get(dataURL("/v1/skins.json", patch))).data;
  console.log(`[CDragon] [${patch}] Loaded skins.`);

  Object.keys(data).map((id) => {
    const skin = data[id];
    if (skin.isBase) {
      skin.name = "Original " + skin.name;
    }
    if (skin.questSkinInfo) {
      // At the time of writing (12.1), only K/DA ALL OUT Seraphine (147001)
      const base = { ...skin };
      delete base.questSkinInfo;

      skin.questSkinInfo.tiers.map((tier) => {
        const s = { ...base, ...tier };
        data[s.id.toString()] = s;
      });
    }
  });
  return data;
}

async function getLatestPatchData(patch = "pbe"): Promise<[Champion[], Skinline[], Skins, Universe[]]> {
  return await Promise.all([
    getLatestChampions(patch),
    getLatestSkinlines(patch),
    getLatestSkins(patch),
    getLatestUniverses(patch),
  ]);
}

async function getAdded(champions: Champion[], skinlines: Skinline[], skins: Skins, universes: Universe[]) {
  const [oldC, oldSl, oldS, oldU] = await getLatestPatchData("latest");
  const oldSkinIds = new Set(Object.keys(oldS)),
    oldChampionIds = new Set(oldC.map((c) => c.id)),
    oldSkinlineIds = new Set(oldSl.map((l) => l.id)),
    oldUniverseIds = new Set(oldU.map((u) => u.id));

  return {
    skins: Object.keys(skins).filter((i) => !oldSkinIds.has(i)),
    champions: champions.map((c) => c.id).filter((i) => !oldChampionIds.has(i)),
    skinlines: skinlines.map((l) => l.id).filter((i) => !oldSkinlineIds.has(i)),
    universes: universes.map((u) => u.id).filter((i) => !oldUniverseIds.has(i)),
  };
}

async function scrape() {
  let shouldRebuild = false;
  const { lastUpdate, oldVersionString } = await cache.get("persistentVars", {
    lastUpdate: 0,
    oldVersionString: "",
  });
  const now = Date.now();

  let champions: Champion[] | null = null;
  let skinlines: Skinline[] | null = null;
  let skins: Skins | null = null;
  let universes: Universe[] | null = null;

  // Check to see if patch changed.
  const metadata = (await axios.get(CDRAGON + "/pbe/content-metadata.json"))
    .data;
  if (metadata.version === oldVersionString) {
    console.log(
      `[CDragon] Patch has not changed (${oldVersionString}). Skipping...`
    );
  } else {
    // Patch changed!
    [champions, skinlines, skins, universes] = await getLatestPatchData();
    const added = await getAdded(champions, skinlines, skins, universes);

    await Promise.all([
      cache.set("champions", champions),
      cache.set("skinlines", skinlines),
      cache.set("skins", skins),
      cache.set("universes", universes),
      cache.set("added", added),
    ]);
    console.log("[CDragon] Cache updated.");
    shouldRebuild = true;
  }

  if (now - lastUpdate < SKIN_SCRAPE_INTERVAL * 1000) {
    console.log(
      "[Skin Changes] Hasn't been 1 hour since last scrape. Exiting."
    );
    return shouldRebuild;
  }

  if (!champions || !skins) {
    [champions, skins] = await Promise.all([
      getLatestChampions(),
      getLatestSkins(),
    ]);
  }
  const oldChanges = await cache.get("changes", {});
  const changes = await fetchSkinChanges(champions, skins);
  const haveNewChanges = !isEqual(changes, oldChanges);
  shouldRebuild = shouldRebuild || haveNewChanges;

  if (haveNewChanges) {
    await cache.set("changes", changes);
    console.log("[Skin Changes] Cache updated.");
  } else {
    console.log("[Skin Changes] No new changes, exiting.");
  }
  await cache.set("persistentVars", {
    lastUpdate: now,
    oldVersionString: metadata.version,
  });

  return shouldRebuild;
}

async function main() {
  const shouldRebuild = await scrape();
  if (shouldRebuild) {
    if (!process.env.DEPLOY_HOOK)
      return console.log("[Deploy] Need rebuild but no DEPLOY_HOOK provided.");
    console.log("[Deploy] Triggering rebuild...");
    const { job } = (await axios.post(process.env.DEPLOY_HOOK)).data;
    console.log(`Job ${job.id}, State: ${job.state}`);
  } else {
    console.log("[Deploy] Rebuild unnecessary.");
  }
}

main().then(() => cache.destroy());
