export interface FetchedPlTableCsv {
  csvText: string;
  rowCount: number;
  season: string;
  source: string;
}

interface FetchedPlTableRow {
  position: string;
  club: string;
  played: string;
  won: string;
  drawn: string;
  lost: string;
  gd: string;
  pts: string;
  badge: string;
}

const ESPN_PL_STANDINGS_SOURCES = [
  {
    url: "https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
    accept: "application/json",
  },
  {
    url: "https://api.github.com/repos/Bankseyy/bankseytoolbox-data/contents/pl-standings.json?ref=main",
    accept: "application/vnd.github.raw",
  },
  {
    url: "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings",
    accept: "application/json",
  },
];

function canonicalClubName(name: string): string {
  const clean = name.trim();
  const overrides: Record<string, string> = {
    "bournemouth": "AFC Bournemouth",
    "brighton": "Brighton & Hove Albion",
    "man city": "Manchester City",
    "man utd": "Manchester United",
    "newcastle": "Newcastle United",
    "tottenham": "Tottenham Hotspur",
    "west ham": "West Ham United",
    "wolverhampton": "Wolverhampton Wanderers",
  };
  return overrides[clean.toLowerCase()] ?? clean;
}

function csvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function rowsToCsv(rows: FetchedPlTableRow[]): string {
  const headers: Array<keyof FetchedPlTableRow> = [
    "position",
    "club",
    "played",
    "won",
    "drawn",
    "lost",
    "gd",
    "pts",
    "badge",
  ];
  return [
    headers.join(","),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(",")),
  ].join("\n") + "\n";
}

function findStandingsEntries(value: any): any[] | null {
  if (!value || typeof value !== "object") return null;
  if (
    Array.isArray(value.entries)
    && value.entries.length
    && value.entries.every((entry: any) => entry?.team && Array.isArray(entry?.stats))
  ) {
    return value.entries;
  }

  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findStandingsEntries(child);
    if (found) return found;
  }
  return null;
}

function statValue(entry: any, name: string): string {
  const stat = Array.isArray(entry?.stats)
    ? entry.stats.find((candidate: any) => String(candidate?.name ?? "").toLowerCase() === name.toLowerCase())
    : null;
  if (!stat) return "0";
  if (stat.value !== undefined && stat.value !== null) return String(stat.value);
  return String(stat.displayValue ?? "0").trim() || "0";
}

export function parseEspnPlStandings(data: any): { rows: FetchedPlTableRow[]; season: string } {
  const entries = data?.children?.[0]?.standings?.entries ?? findStandingsEntries(data);
  if (!Array.isArray(entries)) throw new Error("ESPN returned no Premier League standings.");

  const rows = entries.map((entry: any) => {
    const club = canonicalClubName(String(entry?.team?.displayName ?? entry?.team?.name ?? ""));
    return {
      position: statValue(entry, "rank"),
      club,
      played: statValue(entry, "gamesPlayed"),
      won: statValue(entry, "wins"),
      drawn: statValue(entry, "ties"),
      lost: statValue(entry, "losses"),
      gd: statValue(entry, "pointDifferential"),
      pts: statValue(entry, "points"),
      badge: `${club}.png`,
    };
  }).filter((row: FetchedPlTableRow) => row.club);

  if (rows.length !== 20) {
    throw new Error(`Expected 20 Premier League rows but ESPN returned ${rows.length}.`);
  }

  rows.sort((a: FetchedPlTableRow, b: FetchedPlTableRow) => Number(a.position) - Number(b.position));
  const season = String(data?.season?.displayName ?? data?.season?.year ?? "Current season").trim();
  return { rows, season };
}

export async function fetchLatestPlTableCsv(): Promise<FetchedPlTableCsv> {
  const failures: string[] = [];

  for (const source of ESPN_PL_STANDINGS_SOURCES) {
    try {
      const response = await fetch(source.url, {
        method: "GET",
        cache: "no-store",
        headers: { Accept: source.accept },
      });
      if (!response.ok) {
        failures.push(`HTTP ${response.status}`);
        continue;
      }

      const { rows, season } = parseEspnPlStandings(await response.json());
      return {
        csvText: rowsToCsv(rows),
        rowCount: rows.length,
        season,
        source: "ESPN",
      };
    } catch (error: any) {
      failures.push(error?.message ?? String(error));
    }
  }

  throw new Error(`Could not fetch ESPN standings (${failures.join("; ")}).`);
}
