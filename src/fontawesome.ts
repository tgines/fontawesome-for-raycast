import { LocalStorage, getPreferenceValues } from "@raycast/api";

const TOKEN_URL = "https://api.fontawesome.com/token";
const GRAPHQL_URL = "https://api.fontawesome.com";

const ACCESS_TOKEN_KEY = "fa-access-token";
const ACCESS_TOKEN_EXPIRY_KEY = "fa-access-token-expiry";
const VERSION_KEY = "fa-latest-version";
const VERSION_EXPIRY_KEY = "fa-latest-version-expiry";

// Refresh a little early so a request never fails on a just-expired token.
const EXPIRY_SKEW_MS = 60_000;
// Cache the resolved "latest" release for a day.
const VERSION_TTL_MS = 24 * 60 * 60 * 1000;

interface Preferences {
  apiToken: string;
}

export interface Icon {
  id: string;
  label: string;
  unicode: string;
  /** Full <svg> markup for the Classic / Regular style, if the icon has one. */
  svg: string;
}

/** Exchange the long-lived API token for a short-lived access token, cached in LocalStorage. */
async function getAccessToken(): Promise<string> {
  const { apiToken } = getPreferenceValues<Preferences>();
  if (!apiToken) {
    throw new Error("Missing API token. Set it in the extension preferences.");
  }

  const cached = await LocalStorage.getItem<string>(ACCESS_TOKEN_KEY);
  const expiry = await LocalStorage.getItem<number>(ACCESS_TOKEN_EXPIRY_KEY);
  if (cached && expiry && Date.now() < expiry - EXPIRY_SKEW_MS) {
    return cached;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error("Invalid API token. Check it in the extension preferences.");
  }
  if (!res.ok) {
    throw new Error(`Token request failed (HTTP ${res.status}).`);
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error("Token response did not include an access token.");
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  await LocalStorage.setItem(ACCESS_TOKEN_KEY, data.access_token);
  await LocalStorage.setItem(ACCESS_TOKEN_EXPIRY_KEY, Date.now() + expiresInMs);

  return data.access_token;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GraphQL request failed (HTTP ${res.status}).`);
  }

  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(body.errors.map((e) => e.message).join("; "));
  }
  if (!body.data) {
    throw new Error("GraphQL response contained no data.");
  }
  return body.data;
}

/** Resolve the latest Font Awesome release version (required by the search query), cached for a day. */
async function getLatestVersion(): Promise<string> {
  const cached = await LocalStorage.getItem<string>(VERSION_KEY);
  const expiry = await LocalStorage.getItem<number>(VERSION_EXPIRY_KEY);
  if (cached && expiry && Date.now() < expiry) {
    return cached;
  }

  const data = await graphql<{ release: { version: string } }>(
    `
      query LatestVersion {
        release(version: "latest") {
          version
        }
      }
    `,
    {},
  );
  const version = data.release.version;
  await LocalStorage.setItem(VERSION_KEY, version);
  await LocalStorage.setItem(VERSION_EXPIRY_KEY, Date.now() + VERSION_TTL_MS);
  return version;
}

// -----------------------------------------------------------------------------
// Local metadata index
//
// The GraphQL `search` field is fuzzy ("word associations, beyond simple text
// matching") and does not return the icons the fontawesome.com results show
// (e.g. "grid" surfaces grin-*/grip- but not `grid` itself). So instead we pull
// the full Classic/Regular catalog once, cache it, and search it locally with
// plain substring/alias matching + ranking — which mirrors the website.
// -----------------------------------------------------------------------------

const INDEX_KEY = "fa-index";
const INDEX_VERSION_KEY = "fa-index-version";
const INDEX_EXPIRY_KEY = "fa-index-expiry";
const SVG_CACHE_KEY = "fa-svg-cache";

const INDEX_TTL_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
// Max results rendered per search, and how many icon+svg selections to batch
// into one aliased GraphQL request when fetching their SVGs.
const MAX_RESULTS = 60;
const SVG_BATCH = 10;

interface IconMeta {
  id: string;
  label: string;
  unicode: string;
  aliases: string[];
}

interface PageIcon {
  id: string;
  label: string;
  unicodeHex: string;
  aliases: { names: string[] | null } | null;
  familyStylesByLicense: { pro: { family: string; style: string }[] };
}

const INDEX_QUERY = `
  query Catalog($version: String!, $page: Int!, $pageSize: Int!) {
    release(version: $version) {
      iconsPaginated(license: PRO, page: $page, pageSize: $pageSize) {
        totalPageCount
        icons {
          id
          label
          unicodeHex
          aliases {
            names
          }
          familyStylesByLicense {
            pro {
              family
              style
            }
          }
        }
      }
    }
  }
`;

function hasClassicRegular(icon: PageIcon): boolean {
  return icon.familyStylesByLicense.pro.some((fs) => fs.family === "classic" && fs.style === "regular");
}

/** Fetch every Classic/Regular icon's metadata (paged), cached for a day. */
async function getIndex(): Promise<IconMeta[]> {
  const version = await getLatestVersion();
  const cachedVersion = await LocalStorage.getItem<string>(INDEX_VERSION_KEY);
  const expiry = await LocalStorage.getItem<number>(INDEX_EXPIRY_KEY);
  const cached = await LocalStorage.getItem<string>(INDEX_KEY);
  if (cached && cachedVersion === version && expiry && Date.now() < expiry) {
    return JSON.parse(cached) as IconMeta[];
  }

  const index: IconMeta[] = [];
  let page = 1;
  let totalPages = 1;
  do {
    const data = await graphql<{
      release: { iconsPaginated: { totalPageCount: number; icons: PageIcon[] } };
    }>(INDEX_QUERY, { version, page, pageSize: PAGE_SIZE });

    const paginated = data.release.iconsPaginated;
    totalPages = paginated.totalPageCount;
    for (const icon of paginated.icons) {
      if (!hasClassicRegular(icon)) continue;
      index.push({
        id: icon.id,
        label: icon.label,
        unicode: icon.unicodeHex,
        aliases: icon.aliases?.names ?? [],
      });
    }
    page += 1;
  } while (page <= totalPages);

  await LocalStorage.setItem(INDEX_KEY, JSON.stringify(index));
  await LocalStorage.setItem(INDEX_VERSION_KEY, version);
  await LocalStorage.setItem(INDEX_EXPIRY_KEY, Date.now() + INDEX_TTL_MS);
  return index;
}

/**
 * Rank a match the way the fontawesome.com results feel: exact id, then id
 * prefix, then id substring, then label, then alias. Lower is better.
 * Returns null when no query token appears anywhere (not a match).
 */
function rankIcon(icon: IconMeta, tokens: string[], full: string): number | null {
  const id = icon.id.toLowerCase();
  const label = icon.label.toLowerCase();
  const aliases = icon.aliases.map((n) => n.toLowerCase());
  const haystack = [id, label, ...aliases].join(" ");

  if (!tokens.every((t) => haystack.includes(t))) {
    return null;
  }

  if (id === full) return 0;
  if (id.startsWith(full)) return 1;
  if (id.includes(full)) return 2;
  if (label.includes(full)) return 3;
  if (aliases.some((a) => a.includes(full))) return 4;
  return 5; // tokens matched separately but not as a whole phrase
}

/** Fetch <svg> markup for a set of ids (Classic/Regular), batched and cached. */
async function getSvgs(ids: string[]): Promise<Record<string, string>> {
  const rawCache = await LocalStorage.getItem<string>(SVG_CACHE_KEY);
  const cache: Record<string, string> = rawCache ? JSON.parse(rawCache) : {};

  const missing = ids.filter((id) => !(id in cache));
  if (missing.length > 0) {
    const version = await getLatestVersion();
    const chunks: string[][] = [];
    for (let i = 0; i < missing.length; i += SVG_BATCH) {
      chunks.push(missing.slice(i, i + SVG_BATCH));
    }

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const fields = chunk
          .map(
            (id, i) =>
              `i${i}: icon(name: ${JSON.stringify(id)}) { svgs(filter: { familyStyles: [{ family: CLASSIC, style: REGULAR }] }) { html } }`,
          )
          .join("\n");
        const query = `query Svgs($version: String!) { release(version: $version) { ${fields} } }`;
        const data = await graphql<{ release: Record<string, { svgs: { html: string }[] } | null> }>(query, {
          version,
        });
        return chunk.map((id, i) => ({ id, html: data.release[`i${i}`]?.svgs?.[0]?.html ?? "" }));
      }),
    );

    for (const group of results) {
      for (const { id, html } of group) {
        if (html) cache[id] = html;
      }
    }
    await LocalStorage.setItem(SVG_CACHE_KEY, JSON.stringify(cache));
  }

  return cache;
}

/**
 * Search Classic/Regular icons by name, label, and alias — locally, over the
 * cached catalog — then attach SVG markup for the top matches.
 */
export async function searchIcons(query: string): Promise<Icon[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const index = await getIndex();
  const full = trimmed.toLowerCase();
  const tokens = full.split(/\s+/).filter(Boolean);

  const ranked = index
    .map((icon) => ({ icon, rank: rankIcon(icon, tokens, full) }))
    .filter((entry): entry is { icon: IconMeta; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.icon.id.length - b.icon.id.length || a.icon.id.localeCompare(b.icon.id))
    .slice(0, MAX_RESULTS)
    .map((entry) => entry.icon);

  const svgs = await getSvgs(ranked.map((icon) => icon.id));

  return ranked
    .filter((icon) => svgs[icon.id])
    .map((icon) => ({
      id: icon.id,
      label: icon.label,
      unicode: icon.unicode,
      svg: svgs[icon.id],
    }));
}
