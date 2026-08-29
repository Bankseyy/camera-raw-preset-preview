import aliasMap from './badgeFlagAlias.json';

export interface FlagTarget {
  rect: string | null;
  square: string | null;
}

interface PathAliasCategory {
  canonical: Record<string, string>;
  aliases: Record<string, string>;
}

interface FlagAliasCategory {
  canonical: Record<string, FlagTarget>;
  aliases: Record<string, string>;
}

export function normalizeAlias(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const clubBadgeAliases = aliasMap.clubBadges as Record<string, string> | PathAliasCategory;
const squareClubBadgeAliases = (aliasMap as any).squareClubBadges as
  | Record<string, string>
  | PathAliasCategory
  | undefined;
const nationalBadgeAliases = aliasMap.nationalBadges as Record<string, string> | PathAliasCategory;
const flagAliases = aliasMap.flags as Record<string, FlagTarget> | FlagAliasCategory;

function fileStem(relativePath: string): string {
  return (relativePath.split('/').pop() ?? '').replace(/\.[^.]+$/, '');
}

function isPathAliasCategory(category: Record<string, string> | PathAliasCategory): category is PathAliasCategory {
  return "canonical" in category && "aliases" in category;
}

function isFlagAliasCategory(category: Record<string, FlagTarget> | FlagAliasCategory): category is FlagAliasCategory {
  return "canonical" in category && "aliases" in category;
}

function resolvePathFromCategory(category: Record<string, string> | PathAliasCategory, name: string): string | null {
  const key = normalizeAlias(name);

  if (isPathAliasCategory(category)) {
    const canonicalKey = category.aliases[key];
    return category.canonical[key] ?? (canonicalKey ? category.canonical[canonicalKey] : null) ?? null;
  }

  const direct = category[key];
  if (direct) return direct;

  const canonicalPath = Object.values(category).find(relativePath => normalizeAlias(fileStem(relativePath)) === key);
  return canonicalPath ?? null;
}

export function resolveClubBadge(name: string): string | null {
  return resolvePathFromCategory(clubBadgeAliases, name);
}

export function resolveSquareClubBadge(name: string): string | null {
  return squareClubBadgeAliases ? resolvePathFromCategory(squareClubBadgeAliases, name) : null;
}

export function resolveNationalBadge(name: string): string | null {
  return resolvePathFromCategory(nationalBadgeAliases, name);
}

export function resolveFlag(name: string): FlagTarget | null {
  const key = normalizeAlias(name);

  if (isFlagAliasCategory(flagAliases)) {
    const canonicalKey = flagAliases.aliases[key];
    return flagAliases.canonical[key] ?? (canonicalKey ? flagAliases.canonical[canonicalKey] : null) ?? null;
  }

  return flagAliases[key] ?? null;
}
