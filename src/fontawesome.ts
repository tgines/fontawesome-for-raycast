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

interface SearchIcon {
  id: string;
  label: string;
  unicode: string;
  svgs: { html: string }[];
}

const SEARCH_QUERY = `
  query Search($version: String!, $query: String!, $first: Int!) {
    search(version: $version, query: $query, first: $first) {
      id
      label
      unicode
      svgs(filter: { familyStyles: [{ family: CLASSIC, style: REGULAR }] }) {
        html
      }
    }
  }
`;

/**
 * Search icons by name/alias, restricted to the Classic / Regular style.
 * Icons without a Classic-Regular variant are dropped.
 */
export async function searchIcons(query: string, first = 50): Promise<Icon[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const version = await getLatestVersion();
  const data = await graphql<{ search: SearchIcon[] }>(SEARCH_QUERY, {
    version,
    query: trimmed,
    first,
  });

  return data.search
    .filter((icon) => icon.svgs.length > 0)
    .map((icon) => ({
      id: icon.id,
      label: icon.label,
      unicode: icon.unicode,
      svg: icon.svgs[0].html,
    }));
}
