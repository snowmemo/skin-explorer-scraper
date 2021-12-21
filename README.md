# Skin Explorer Scraper/Cache

Reads data from CommunityDragon and the League of Legends Wiki to populate a
Redis cache. The cache is then read by the Next.js application during build and
regeneration time. Intended to be run once every 10 minutes.

## Game Data

Reads content-metadata.json from the PBE patch on CommunityDragon and compares
with last known patch string to determine if a full update is necessary. If
so, champions, skins, skinlines, and universes are all read and indexed in the
cache.

## Skin Art History

Scrape the patch notes for each legend from the League of Legends wiki every
hour to extract any new changes about a champion's splash art. If changed, write
the new copy to the cache.
