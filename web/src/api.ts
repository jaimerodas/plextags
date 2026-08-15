export type Kind = "movie" | "show";

export interface Item {
  ratingKey: string;
  title: string;
  year: number | string | null;
  genres: string[];
}

export interface Library {
  sectionId: string;
  kind: Kind;
  seeded: boolean;
  savedAt: number;
  items: Item[];
}

export interface Section {
  id: string;
  kind: Kind;
  title: string;
}

export interface AuthStatus {
  authenticated: boolean;
  server: { name: string; url: string } | null;
  sections: Section[] | null;
  serverError: string | null;
}

export interface ServerInfo {
  name: string;
  clientIdentifier: string;
  accessToken: string;
  url: string | null;
  reachable: boolean;
}

export interface PinInfo {
  pinId: number;
  code: string;
  authUrl: string;
}

export interface RefreshJob {
  running: boolean;
  done: number;
  total: number;
  error: string | null;
}

export interface ApplyResult {
  ratingKey: string;
  title: string;
  op: string;
  ok: boolean;
  status: number | string;
}

export interface EditPayload {
  ratingKey: string;
  title: string;
  add: string[];
  remove: string[];
}

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = (await r.json()).detail ?? detail;
    } catch {
      /* not json */
    }
    throw new ApiError(r.status, detail);
  }
  return r.json();
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const post = (body?: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});

export const api = {
  authStatus: () => req<AuthStatus>("/api/auth/status"),
  createPin: () => req<PinInfo>("/api/auth/pin", post()),
  checkPin: (id: number) =>
    req<{ authenticated: boolean }>(`/api/auth/pin/${id}`),
  logout: () => req<{ ok: boolean }>("/api/auth/logout", post()),
  servers: () => req<ServerInfo[]>("/api/servers"),
  selectServer: (s: { name: string; url: string; accessToken: string }) =>
    req<{ ok: boolean }>("/api/server", post(s)),
  items: (sectionId: string, kind: Kind) =>
    req<Library>(`/api/sections/${sectionId}/items?kind=${kind}`),
  refreshStart: (sectionId: string, kind: Kind) =>
    req<RefreshJob>(`/api/sections/${sectionId}/refresh`, post({ kind })),
  refreshStatus: (sectionId: string) =>
    req<RefreshJob>(`/api/sections/${sectionId}/refresh`),
  apply: (sectionId: string, kind: Kind, edits: EditPayload[]) =>
    req<{ results: ApplyResult[]; ok: boolean }>(
      `/api/sections/${sectionId}/apply`,
      post({ kind, edits }),
    ),
};
