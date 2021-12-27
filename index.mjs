import axios from "axios";
import { cache } from "./lib/cache.mjs";
import { CDRAGON, SKIN_SCRAPE_INTERVAL, SUBSTITUTIONS } from "./constants.mjs";
import { fetchSkinChanges } from "./lib/skin-changes.mjs";

const dataURL = (p) =>
  `${CDRAGON}/pbe/plugins/rcp-be-lol-game-data/global/default${p}`;

const substitute = (thing) => SUBSTITUTIONS[thing] ?? thing;

async function getLatestChampions() {
  const { data } = await axios.get(dataURL("/v1/champion-summary.json"));
  console.log("[CDragon] Loaded champions.");
  return data
    .filter((d) => d.id !== -1)
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((a) => ({ ...a, key: substitute(a.alias.toLowerCase()) }));
}

async function getLatestUniverses() {
  const { data } = await axios.get(dataURL("/v1/universes.json"));
  console.log("[CDragon] Loaded universes.");

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkinlines() {
  const { data } = await axios.get(dataURL("/v1/skinlines.json"));
  console.log("[CDragon] Loaded skinlines.");

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkins() {
  const { data } = await axios.get(dataURL("/v1/skins.json"));
  console.log("[CDragon] Loaded skins.");

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

async function getLatestPatchData() {
  return await Promise.all([
    getLatestChampions(),
    getLatestSkinlines(),
    getLatestSkins(),
    getLatestUniverses(),
  ]);
}

async function scrape() {
  let shouldRebuild = false;
  const { lastUpdate, oldVersionString } = await cache.get("persistentVars", {
    lastUpdate: 0,
    oldVersionString: "",
  });
  const now = Date.now();

  let champions, skinlines, skins, universes;

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
    await Promise.all([
      cache.set("champions", champions),
      cache.set("skinlines", skinlines),
      cache.set("skins", skins),
      cache.set("universes", universes),
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

  if (!champions) {
    [champions, skins] = await Promise.all([
      getLatestChampions(),
      getLatestSkins(),
    ]);
  }

  const changes = await fetchSkinChanges(champions, skins);
  await Promise.all([
    cache.set("changes", changes),
    cache.set("persistentVars", {
      lastUpdate: now,
      oldVersionString: metadata.version,
    }),
  ]);
  console.log("[Skin Changes] Cache updated.");
  shouldRebuild = true;

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
