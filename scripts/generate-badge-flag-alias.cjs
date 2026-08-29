#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const repoRoot = path.resolve(__dirname, "..");
const outFile = path.join(repoRoot, "src", "api", "tools", "badgeFlagAlias.json");

function getArg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

const cacheRoot = path.resolve(getArg("--cache-root", "C:/Temp"));
const legacyFetchPath = getArg("--legacy-fetch", "");

function normalizeAlias(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toPosix(value) {
  return value.replace(/\\/g, "/");
}

function readExistingJson() {
  if (!fs.existsSync(outFile)) return {};
  return JSON.parse(fs.readFileSync(outFile, "utf8"));
}

function asFlatPathTable(category) {
  if (!category) return {};
  if (!category.canonical) return category;

  const flat = { ...category.canonical };
  for (const [alias, canonicalKey] of Object.entries(category.aliases || {})) {
    if (category.canonical[canonicalKey]) flat[alias] = category.canonical[canonicalKey];
  }
  return flat;
}

function asFlatFlagTable(category) {
  if (!category) return {};
  if (!category.canonical) return category;

  const flat = { ...category.canonical };
  for (const [alias, canonicalKey] of Object.entries(category.aliases || {})) {
    if (category.canonical[canonicalKey]) flat[alias] = category.canonical[canonicalKey];
  }
  return flat;
}

function scanFiles(relativeRoot, predicate) {
  const absoluteRoot = path.join(cacheRoot, ...relativeRoot.split("/"));
  if (!fs.existsSync(absoluteRoot)) return [];

  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolutePath);
      } else if (entry.isFile() && predicate(entry.name)) {
        files.push(toPosix(path.relative(cacheRoot, absolutePath)));
      }
    }
  }

  walk(absoluteRoot);
  return files;
}

function fileStem(relativePath) {
  return (relativePath.split("/").pop() || "").replace(/\.[^.]+$/, "");
}

const leaguePriority = [
  "eng-1", "esp-1", "ger-1", "ita-1", "fra-1", "ned-1", "por-1", "sco-1",
  "tur-1", "bel-1", "arg-1", "bra-1", "usa-1", "mex-1",
  "eng-2", "esp-2", "ger-2", "ita-2", "fra-2", "sco-2", "bra-2", "mex-2",
  "eng-3", "eng-4", "arg-2", "arg-3", "usa-2", "usa-3",
  "uru-1", "uru-2",
];

function priorityScore(relativePath) {
  const parts = relativePath.split("/");
  const leagueDir = parts.length > 2 ? parts[2] : "";
  const priority = leaguePriority.findIndex(prefix => leagueDir.startsWith(prefix));
  return priority === -1 ? 1000 : priority;
}

function comparePaths(a, b) {
  const scoreDiff = priorityScore(a) - priorityScore(b);
  if (scoreDiff !== 0) return scoreDiff;
  return a.localeCompare(b);
}

function addCanonical(canonical, pathToCanonicalKey, relativePath, canonicalKeyFromPath) {
  const key = canonicalKeyFromPath(relativePath);
  if (!key) return null;

  const existingPath = canonical[key];
  if (!existingPath || comparePaths(relativePath, existingPath) < 0) {
    canonical[key] = relativePath;
  }

  pathToCanonicalKey.set(relativePath, key);
  return key;
}

function setAlias(aliases, aliasKey, canonicalKey, overwrite = false) {
  if (!aliasKey || !canonicalKey || aliasKey === canonicalKey) return;
  if (!aliases[aliasKey] || overwrite) aliases[aliasKey] = canonicalKey;
}

function buildPathCategory(existingFlat, scannedPaths, canonicalKeyFromPath = relativePath => normalizeAlias(fileStem(relativePath))) {
  const canonical = {};
  const aliases = {};
  const pathToCanonicalKey = new Map();
  const allPaths = Array.from(new Set([...Object.values(existingFlat), ...scannedPaths])).filter(Boolean).sort(comparePaths);

  for (const relativePath of allPaths) {
    addCanonical(canonical, pathToCanonicalKey, relativePath, canonicalKeyFromPath);
  }

  for (const [alias, relativePath] of Object.entries(existingFlat)) {
    const aliasKey = normalizeAlias(alias);
    const canonicalKey = pathToCanonicalKey.get(relativePath) || canonicalKeyFromPath(relativePath);
    setAlias(aliases, aliasKey, canonicalKey);
  }

  return { canonical, aliases };
}

function addDefaultPathAliases(category, suffixes) {
  for (const canonicalKey of Object.keys(category.canonical)) {
    for (const suffix of suffixes) {
      setAlias(category.aliases, `${canonicalKey}${suffix}`, canonicalKey);
    }
  }
}

function extractObjectLiteral(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  const start = source.indexOf("{", markerIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        inString = false;
      }
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      inString = true;
      quote = char;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }

  return null;
}

function readLegacyBadgeAliases(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  const source = fs.readFileSync(filePath, "utf8");
  const literal = extractObjectLiteral(source, "const BADGE_ALIASES");
  if (!literal) return {};
  return vm.runInNewContext(`(${literal})`, {});
}

function applyLegacyBadgeAliases(category, legacyAliases) {
  const legacySeen = new Set();

  for (const [canonicalName, aliases] of Object.entries(legacyAliases)) {
    const canonicalKey = normalizeAlias(canonicalName);
    if (!category.canonical[canonicalKey]) continue;

    for (const alias of aliases || []) {
      const aliasKey = normalizeAlias(alias);
      if (legacySeen.has(aliasKey)) continue;
      legacySeen.add(aliasKey);
      setAlias(category.aliases, aliasKey, canonicalKey, true);
    }
  }
}

function inheritCompatibleAliases(category, sourceCategory) {
  for (const [alias, canonicalKey] of Object.entries(sourceCategory.aliases || {})) {
    if (category.canonical[canonicalKey]) setAlias(category.aliases, alias, canonicalKey);
  }
}

function squareClubBadgeCanonicalKeyFromPath(relativePath) {
  return normalizeAlias(fileStem(relativePath).replace(/-square$/i, ""));
}

function flagCanonicalKeyFromPath(relativePath) {
  return normalizeAlias(
    fileStem(relativePath)
      .replace(/-flag-square$/i, "")
      .replace(/-flag$/i, "")
  );
}

function addFlagTarget(canonical, relativePath, kind) {
  const key = flagCanonicalKeyFromPath(relativePath);
  if (!key) return null;

  const target = canonical[key] || { rect: null, square: null };
  target[kind] = relativePath;
  canonical[key] = target;
  return key;
}

function targetSignature(target) {
  return `${target.rect || ""}|${target.square || ""}`;
}

function canonicalKeyForFlagTarget(target) {
  if (target.rect) return flagCanonicalKeyFromPath(target.rect);
  if (target.square) return flagCanonicalKeyFromPath(target.square);
  return "";
}

function buildFlagCategory(existingFlat, rectPaths, squarePaths) {
  const canonical = {};
  const aliases = {};
  const targetToCanonicalKey = new Map();

  for (const relativePath of rectPaths.sort()) addFlagTarget(canonical, relativePath, "rect");
  for (const relativePath of squarePaths.sort()) addFlagTarget(canonical, relativePath, "square");

  for (const target of Object.values(existingFlat)) {
    const canonicalKey = canonicalKeyForFlagTarget(target);
    if (!canonicalKey) continue;
    canonical[canonicalKey] = {
      rect: canonical[canonicalKey]?.rect ?? target.rect ?? null,
      square: canonical[canonicalKey]?.square ?? target.square ?? null,
    };
  }

  for (const [key, target] of Object.entries(canonical)) {
    targetToCanonicalKey.set(targetSignature(target), key);
  }

  for (const [alias, target] of Object.entries(existingFlat)) {
    const aliasKey = normalizeAlias(alias);
    const canonicalKey = targetToCanonicalKey.get(targetSignature(target)) || canonicalKeyForFlagTarget(target);
    setAlias(aliases, aliasKey, canonicalKey);
  }

  return { canonical, aliases };
}

const existing = readExistingJson();
const legacyBadgeAliases = readLegacyBadgeAliases(legacyFetchPath);

const clubBadges = buildPathCategory(
  asFlatPathTable(existing.clubBadges),
  scanFiles("badges/club-badges", name => /\.png$/i.test(name))
);
addDefaultPathAliases(clubBadges, ["fc", "badge"]);
applyLegacyBadgeAliases(clubBadges, legacyBadgeAliases);

const squareClubBadges = buildPathCategory(
  asFlatPathTable(existing.squareClubBadges),
  scanFiles("badges/square-badges", name => /\.png$/i.test(name)),
  squareClubBadgeCanonicalKeyFromPath
);
addDefaultPathAliases(squareClubBadges, ["fc", "badge"]);
inheritCompatibleAliases(squareClubBadges, clubBadges);
applyLegacyBadgeAliases(squareClubBadges, legacyBadgeAliases);

const nationalBadges = buildPathCategory(
  asFlatPathTable(existing.nationalBadges),
  scanFiles("badges/national-badges", name => /\.png$/i.test(name))
);
addDefaultPathAliases(nationalBadges, ["badge", "footballbadge"]);

const flags = buildFlagCategory(
  asFlatFlagTable(existing.flags),
  scanFiles("flags/flags-rectangle", name => /\.png$/i.test(name)),
  scanFiles("flags/flags-square", name => /\.png$/i.test(name))
);

const output = {
  version: 2,
  generatedFrom: toPosix(cacheRoot),
  clubBadges,
  squareClubBadges,
  nationalBadges,
  flags,
};

fs.writeFileSync(outFile, `${JSON.stringify(output)}\n`);

console.log(`Wrote ${toPosix(path.relative(process.cwd(), outFile))}`);
console.log(`Club badges: ${Object.keys(clubBadges.canonical).length} canonical, ${Object.keys(clubBadges.aliases).length} aliases`);
console.log(`Square club badges: ${Object.keys(squareClubBadges.canonical).length} canonical, ${Object.keys(squareClubBadges.aliases).length} aliases`);
console.log(`National badges: ${Object.keys(nationalBadges.canonical).length} canonical, ${Object.keys(nationalBadges.aliases).length} aliases`);
console.log(`Flags: ${Object.keys(flags.canonical).length} canonical, ${Object.keys(flags.aliases).length} aliases`);
