import axios from "axios";
import { cache } from "./lib/cache.mjs";
import { CDRAGON, SKIN_SCRAPE_INTERVAL } from "./constants.mjs";
import { fetchSkinChanges } from "./lib/skin-changes.mjs";

const dataURL = (p) =>
  `${CDRAGON}/pbe/plugins/rcp-be-lol-game-data/global/default${p}`;

async function getLatestChampions() {
  const { data } = await axios.get(dataURL("/v1/champion-summary.json"));
  console.log("[PBE] Loaded champions.");
  return data
    .filter((d) => d.id !== -1)
    .sort((a, b) => (a.name > b.name ? 1 : -1))
    .map((a) => ({ ...a, key: a.alias.toLowerCase() }));
}

async function getLatestUniverses() {
  const { data } = await axios.get(dataURL("/v1/universes.json"));
  console.log("[PBE] Loaded universes.");

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkinlines() {
  const { data } = await axios.get(dataURL("/v1/skinlines.json"));
  console.log("[PBE] Loaded skinlines.");

  return data
    .filter((d) => d.id !== 0)
    .sort((a, b) => (a.name > b.name ? 1 : -1));
}

async function getLatestSkins() {
  const { data } = await axios.get(dataURL("/v1/skins.json"));
  console.log("[PBE] Loaded skins.");

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

async function main() {
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
      `[Game] Patch has not changed (${oldVersionString}). Skipping...`
    );
  } else {
    // Patch changed!
    [champions, skinlines, skins, universes] = await getLatestPatchData();
    await Promise.all([
      cache.set("champions", champions),
      cache.set("skinlines", skinlines),
      cache.set("skins", skins),
      cache.set("universes", universes),
      cache.set("persistentVars", {
        lastUpdate: now,
        oldVersionString: metadata.version,
      }),
    ]);
    console.log("[Game] Cache updated.");
  }

  if (now - lastUpdate < SKIN_SCRAPE_INTERVAL * 1000)
    return console.log(
      "[Skin Changes] Hasn't been 1 hour since last scrape. Exiting."
    );

  if (!champions) {
    [champions, skins] = await Promise.all([
      getLatestChampions(),
      getLatestSkins(),
    ]);
  }

  const changes = await fetchSkinChanges(champions, skins);
  cache.set("changes", changes);
  console.log("[Skin Changes] Cache updated.");
}

main().then(() => cache.destroy());
