interface Env {
  CRON_SECRET?: string;
  DEFAULT_COVER_IMAGE?: string;
  GIB_DUYURU_URL?: string;
  GITHUB_TOKEN?: string;
  GITHUB_REPO?: string;
  GITHUB_BRANCH?: string;
  GITHUB_FILE_PATH?: string;
  MAX_POSTS?: string;
  COMMITTER_NAME?: string;
  COMMITTER_EMAIL?: string;
}

interface ScheduledController {
  cron: string;
}

interface WorkerExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

type GibNotice = {
  id: string;
  duyuruBaslik?: string;
  duyuruIcerik?: string;
  duyuruOzet?: string;
  eklenmeTarihi?: string;
  baslangicTarihi?: string;
  kategoriAdi?: string;
};

type SiteAnnouncement = {
  slug: string;
  title: string;
  excerpt: string;
  date: string;
  coverImage: string;
  body: string;
  category?: string;
};

type SyncOptions = {
  source: "scheduled" | "manual" | "preview";
  cron?: string;
  persist: boolean;
};

type SyncSuccess = {
  ok: true;
  posts: SiteAnnouncement[];
  pageDetail: unknown;
  meta: {
    source: string;
    cron: string | null;
    fetchedAt: string;
    durationMs: number;
    apiUrl: string;
    totalInResponse: number;
  };
};

type SyncError = {
  ok: false;
  error: string;
  status?: number;
  detail?: string;
  bodyPreview?: string;
  meta: {
    source: string;
    cron: string | null;
    fetchedAt: string;
    durationMs: number;
    apiUrl: string;
  };
};

type PublishResult = {
  enabled: boolean;
  skipped: boolean;
  reason?: string;
  updated?: boolean;
  commitSha?: string | null;
  commitUrl?: string | null;
  postCount?: number;
  repo?: string;
  branch?: string;
  path?: string;
};

type GitHubContentsFileResponse = {
  sha: string;
  content?: string;
  encoding?: string;
};

const GIB_API_URL =
  "https://dijital.gib.gov.tr/apigateway/notice/duyuru/duyurular";

const GIB_REQUEST_BODY = {
  meta: {
    pagination: {
      pageNo: 1,
      pageSize: 50,
    },
  },
  data: {
    body: {
      kategoriId: "0",
      baslangicTarihi: "",
      bitisTarihi: "",
    },
  },
};

const DEFAULT_COVER_IMAGE =
  "https://rzgymm.com.tr/uploads/vergi-denetimi.jpg";

const DEFAULT_GITHUB_FILE_PATH = "src/data/duyurular.json";
const DEFAULT_GITHUB_BRANCH = "main";
const DEFAULT_MAX_POSTS = 300;
const GITHUB_API_VERSION = "2022-11-28";
const TURKISH_LOCALE = "tr-TR";

const handler = {
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: WorkerExecutionContext,
  ) {
    ctx.waitUntil(
      syncAndMaybePublish(env, {
        source: "scheduled",
        cron: controller.cron,
        persist: true,
      }),
    );
  },

  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "gib-duyuru-cron",
        publishConfigured: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO),
      });
    }

    if (url.pathname === "/run") {
      if (!isAuthorized(request, env)) {
        return jsonResponse(
          { ok: false, error: "Unauthorized. x-cron-secret header is required." },
          401,
        );
      }

      const dryRun = url.searchParams.get("dryRun") === "1";
      const result = await syncAndMaybePublish(env, {
        source: "manual",
        persist: !dryRun,
      });

      return jsonResponse(result, result.ok ? 200 : 502);
    }

    if (url.pathname === "/duyurular.json") {
      if (!isAuthorized(request, env)) {
        return jsonResponse(
          { ok: false, error: "Unauthorized. x-cron-secret header is required." },
          401,
        );
      }

      const result = await syncAndMaybePublish(env, {
        source: "preview",
        persist: false,
      });

      if (!result.ok) {
        return jsonResponse(result, 502);
      }

      return jsonResponse(
        {
          posts: result.posts,
          source: result.meta,
          publish: result.publish,
        },
        200,
      );
    }

    return new Response("Not found", { status: 404 });
  },
};

export default handler;

function isAuthorized(request: Request, env: Env): boolean {
  if (!env.CRON_SECRET) {
    return true;
  }

  return request.headers.get("x-cron-secret") === env.CRON_SECRET;
}

async function syncAndMaybePublish(env: Env, options: SyncOptions) {
  const sync = await syncFromGib(env, options);
  if (!sync.ok) {
    return {
      ...sync,
      publish: {
        enabled: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO),
        skipped: true,
        reason: "sync_failed",
      } satisfies PublishResult,
    };
  }

  let publish: PublishResult = {
    enabled: Boolean(env.GITHUB_TOKEN && env.GITHUB_REPO),
    skipped: true,
    reason: options.persist ? "publish_not_configured" : "persist_disabled",
  };

  if (options.persist) {
    publish = await publishToGitHub(env, sync.posts);
  }

  return {
    ...sync,
    publish,
  };
}

async function syncFromGib(
  env: Env,
  options: Omit<SyncOptions, "persist">,
): Promise<SyncSuccess | SyncError> {
  const startedAt = Date.now();
  const apiUrl = env.GIB_DUYURU_URL || GIB_API_URL;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
        Origin: "https://dijital.gib.gov.tr",
        Referer: "https://dijital.gib.gov.tr/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      },
      body: JSON.stringify(GIB_REQUEST_BODY),
    });

    const text = await response.text();
    const parsed = safeJsonParse(text);

    if (!response.ok || !parsed) {
      const errorResult: SyncError = {
        ok: false,
        error: "GIB API request failed",
        status: response.status,
        bodyPreview: text.slice(0, 1500),
        meta: {
          source: options.source,
          cron: options.cron || null,
          fetchedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAt,
          apiUrl,
        },
      };

      console.error(JSON.stringify(errorResult));
      return errorResult;
    }

    const notices = Array.isArray(parsed.duyurular)
      ? (parsed.duyurular as GibNotice[])
      : [];

    const coverImage = env.DEFAULT_COVER_IMAGE || DEFAULT_COVER_IMAGE;
    const posts = notices.map((notice) => mapNoticeToSitePost(notice, coverImage));

    const successResult: SyncSuccess = {
      ok: true,
      posts,
      pageDetail: parsed.pageDetail ?? null,
      meta: {
        source: options.source,
        cron: options.cron || null,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        apiUrl,
        totalInResponse: notices.length,
      },
    };

    console.log(
      JSON.stringify({
        type: "gib-duyuru-sync",
        ok: true,
        source: options.source,
        cron: options.cron || null,
        totalInResponse: notices.length,
        firstNoticeId: notices[0]?.id || null,
      }),
    );

    return successResult;
  } catch (error) {
    const errorResult: SyncError = {
      ok: false,
      error: "Unhandled error",
      detail: error instanceof Error ? error.message : String(error),
      meta: {
        source: options.source,
        cron: options.cron || null,
        fetchedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
        apiUrl,
      },
    };

    console.error(JSON.stringify(errorResult));
    return errorResult;
  }
}

async function publishToGitHub(
  env: Env,
  newPosts: SiteAnnouncement[],
): Promise<PublishResult> {
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_REPO?.trim();
  const branch = env.GITHUB_BRANCH?.trim() || DEFAULT_GITHUB_BRANCH;
  const path = env.GITHUB_FILE_PATH?.trim() || DEFAULT_GITHUB_FILE_PATH;
  const maxPosts = parsePositiveInt(env.MAX_POSTS, DEFAULT_MAX_POSTS);

  if (!token || !repo) {
    return {
      enabled: false,
      skipped: true,
      reason: "missing GITHUB_TOKEN or GITHUB_REPO",
    };
  }

  try {
    const existingFile = await getGitHubFile(token, repo, branch, path);
    const existingPosts = parsePostsFromFile(existingFile.content);
    const mergedPosts = mergePosts(newPosts, existingPosts, maxPosts);

    const nextContent = JSON.stringify({ posts: mergedPosts }, null, 2) + "\n";
    const unchanged =
      (existingFile.content ?? "").trimEnd() === nextContent.trimEnd();

    if (unchanged) {
      return {
        enabled: true,
        skipped: true,
        updated: false,
        reason: "no_changes",
        repo,
        branch,
        path,
        postCount: mergedPosts.length,
      };
    }

    const commitMessage =
      `chore(duyurular): GIB duyurularini guncelle (${new Date().toISOString().slice(0, 10)})`;

    const update = await putGitHubFile({
      token,
      repo,
      branch,
      path,
      content: nextContent,
      previousSha: existingFile.sha,
      message: commitMessage,
      committerName: env.COMMITTER_NAME,
      committerEmail: env.COMMITTER_EMAIL,
    });

    console.log(
      JSON.stringify({
        type: "duyuru-github-publish",
        ok: true,
        repo,
        branch,
        path,
        commitSha: update.commitSha,
        postCount: mergedPosts.length,
      }),
    );

    return {
      enabled: true,
      skipped: false,
      updated: true,
      commitSha: update.commitSha,
      commitUrl: update.commitUrl,
      repo,
      branch,
      path,
      postCount: mergedPosts.length,
    };
  } catch (error) {
    return {
      enabled: true,
      skipped: true,
      reason: error instanceof Error ? error.message : String(error),
      repo,
      branch,
      path,
    };
  }
}

async function getGitHubFile(
  token: string,
  repo: string,
  branch: string,
  path: string,
): Promise<{ sha: string | null; content: string | null }> {
  const endpoint = `https://api.github.com/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
  const response = await fetch(endpoint, {
    headers: githubHeaders(token),
  });

  if (response.status === 404) {
    return { sha: null, content: null };
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub read failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as GitHubContentsFileResponse;
  const rawContent = data.content ?? "";
  const content =
    data.encoding === "base64"
      ? decodeBase64Utf8(rawContent.replace(/\n/g, ""))
      : rawContent;

  return {
    sha: data.sha || null,
    content,
  };
}

async function putGitHubFile(args: {
  token: string;
  repo: string;
  branch: string;
  path: string;
  content: string;
  previousSha: string | null;
  message: string;
  committerName?: string;
  committerEmail?: string;
}): Promise<{ commitSha: string | null; commitUrl: string | null }> {
  const endpoint = `https://api.github.com/repos/${args.repo}/contents/${encodePath(args.path)}`;
  const payload: Record<string, unknown> = {
    message: args.message,
    content: encodeBase64Utf8(args.content),
    branch: args.branch,
  };

  if (args.previousSha) {
    payload.sha = args.previousSha;
  }

  if (args.committerName && args.committerEmail) {
    payload.committer = {
      name: args.committerName,
      email: args.committerEmail,
    };
  }

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      ...githubHeaders(args.token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub write failed (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as {
    commit?: { sha?: string; html_url?: string };
  };

  return {
    commitSha: data.commit?.sha ?? null,
    commitUrl: data.commit?.html_url ?? null,
  };
}

function githubHeaders(token: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": "rzg-gib-duyuru-cron",
  };
}

function parsePostsFromFile(content: string | null): SiteAnnouncement[] {
  if (!content) {
    return [];
  }

  try {
    const parsed = JSON.parse(content) as { posts?: SiteAnnouncement[] };
    if (!Array.isArray(parsed.posts)) {
      return [];
    }
    return parsed.posts.filter(isValidSitePost);
  } catch {
    return [];
  }
}

function mergePosts(
  newest: SiteAnnouncement[],
  existing: SiteAnnouncement[],
  maxPosts: number,
): SiteAnnouncement[] {
  const map = new Map<string, SiteAnnouncement>();

  for (const post of newest) {
    map.set(post.slug, post);
  }

  for (const post of existing) {
    if (!map.has(post.slug)) {
      map.set(post.slug, post);
    }
  }

  return [...map.values()]
    .sort((a, b) => {
      const dateCmp = b.date.localeCompare(a.date);
      if (dateCmp !== 0) {
        return dateCmp;
      }
      return a.title.localeCompare(b.title, TURKISH_LOCALE);
    })
    .slice(0, maxPosts);
}

function isValidSitePost(value: unknown): value is SiteAnnouncement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.slug === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.excerpt === "string" &&
    typeof candidate.date === "string" &&
    typeof candidate.coverImage === "string" &&
    typeof candidate.body === "string"
  );
}

function mapNoticeToSitePost(notice: GibNotice, coverImage: string): SiteAnnouncement {
  const title = cleanText(notice.duyuruBaslik || "Duyuru");
  const excerptSource = cleanText(notice.duyuruOzet || notice.duyuruBaslik || "");
  const excerpt = truncateText(excerptSource, 220);
  const rawDate = notice.baslangicTarihi || notice.eklenmeTarihi || new Date().toISOString();
  const date = normalizeDate(rawDate);
  const body = htmlToMarkdownLike(notice.duyuruIcerik || "");
  const category = cleanText(notice.kategoriAdi || "");
  const slug = `${slugify(title)}-${(notice.id || "duyuru").toLowerCase()}`;

  return {
    slug,
    title,
    excerpt,
    date,
    coverImage,
    body,
    ...(category ? { category } : {}),
  };
}

function normalizeDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function htmlToMarkdownLike(input: string): string {
  if (!input) {
    return "";
  }

  let text = input
    .replace(/<img[^>]+src="data:image\/[^"]+"[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");

  text = text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/td>/gi, " | ")
    .replace(/<\/th>/gi, " | ");

  text = text.replace(/<[^>]+>/g, "");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");

  text = text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

function cleanText(value: string): string {
  return value
    .replace(/\r/g, " ")
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

function slugify(value: string): string {
  return value
    .toLocaleLowerCase(TURKISH_LOCALE)
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function encodePath(path: string): string {
  return path
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function encodeBase64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

function decodeBase64Utf8(base64: string): string {
  if (!base64) {
    return "";
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new TextDecoder().decode(bytes);
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
