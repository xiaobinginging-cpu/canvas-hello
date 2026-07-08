/**
 * Project sync: primary storage on Cloudflare R2 (public reads + Vercel `/api/r2-*` writes),
 * with GitHub REST + PAT as fallback when R2 is unavailable or misconfigured.
 *
 * GitHub PAT: https://github.com/settings/tokens — scope **repo**
 */
import { Octokit } from '@octokit/rest'
import type { CanvasData, ProjectMeta } from '../types/project'
import { EMPTY_LIBRARY, normalizeLibraryData, type LibraryData } from '../types/library'
import { EMPTY_CHAT, normalizeChatData, type ChatData } from '../types/chat'

// ─── constants ───────────────────────────────────────────────────────────────

/** localStorage key for the validated PAT. */
export const GITHUB_PAT_KEY = 'github_pat'

const GITHUB_LOGIN_KEY = 'github_login'
const PENDING_SYNC_KEY = 'github_pending_sync'
const REPO_NAME = 'canvas-tool-projects'
const PROJECT_PREFIX = 'project-'
/** 跨 project 全局素材库根目录（下划线前缀避免与 `project-{slug}` 撞）。见 `canvas-spec.md` §1「素材库」。 */
const LIBRARY_PREFIX = '_library'
/** Chat 浮动小精灵会话同步根目录（多设备共享，同 `_library` 模式）。 */
const CHAT_PREFIX = '_chat'

// ─── 读缓存（切页面提速）─────────────────────────────────────────────────────
// 列表 / 缩略图 / 素材库读多写少：缓存避免每次切页面都重拉。本地写操作即时失效，
// 最坏只是缩略图/列表稍旧（不缓存会丢数据的写路径）。跨设备改动需刷新（同既有同步模型）。
let cacheProjectsList: ProjectMeta[] | null = null
const cacheProjectCanvas = new Map<string, CanvasData>()
let cacheLibrary: LibraryData | null = null

function invalidateProjectCaches(id?: string): void {
  cacheProjectsList = null
  if (id) cacheProjectCanvas.delete(id)
}

// ─── Cloudflare R2 (writes via Vercel `/api/r2-*`; secrets stay server-side) ─

function r2PublicReadConfigured(): boolean {
  const u = import.meta.env.VITE_R2_PUBLIC_URL
  return typeof u === 'string' && u.trim().length > 0
}

function r2PublicBase(): string {
  return String(import.meta.env.VITE_R2_PUBLIC_URL ?? '')
    .trim()
    .replace(/\/+$/, '')
}

function r2ObjectKey(projectId: string, ...segments: string[]): string {
  const rest = segments.map((s) => s.replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean)
  return [`${PROJECT_PREFIX}${projectId}`, ...rest].join('/')
}

function r2PublicUrlForKey(key: string): string {
  const k = key.replace(/^\/+/, '')
  const encoded = k
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `${r2PublicBase()}/${encoded}`
}

async function r2ListProjectPrefixes(): Promise<string[]> {
  const qs = new URLSearchParams({ prefix: PROJECT_PREFIX, delimiter: '/' })
  const res = await fetch(`/api/r2-list?${qs.toString()}`, { cache: 'no-store' })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `[r2] list failed ${res.status}`)
  }
  const data = (await res.json()) as { commonPrefixes?: string[] }
  return Array.isArray(data.commonPrefixes) ? data.commonPrefixes : []
}

function projectIdFromR2ListPrefix(p: string): string | null {
  const clean = p.replace(/\/+$/, '')
  return extractProjectFolderId(clean)
}

async function r2FetchTextFromPublic(key: string): Promise<string | null> {
  const url = r2PublicUrlForKey(key)
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'no-store' })
    if (!res.ok) return null
    const t = await res.text()
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

/**
 * 预签名直传：拿 R2 PUT URL → 浏览器把 blob 直接 PUT 到 R2，绕过 Vercel ~4.5MB body 上限。
 * 需 R2 bucket 配 CORS 允许 PUT（否则浏览器拦截、抛错走下面 base64 兜底）。
 */
async function r2PutViaPresignedUrl(key: string, blob: Blob, contentType: string): Promise<void> {
  const res = await fetch('/api/r2-presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, contentType }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `[r2] presign failed ${res.status}`)
  }
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error('[r2] presign returned no url')

  const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob })
  if (!put.ok) throw new Error(`[r2] direct PUT failed ${put.status}`)
}

async function r2UploadViaApi(key: string, blob: Blob): Promise<void> {
  const contentType = blob.type && blob.type.length > 0 ? blob.type : 'application/octet-stream'

  // 1) 预签名直传（大文件 / 视频走这条，绕过 Vercel body 上限）。
  try {
    await r2PutViaPresignedUrl(key, blob, contentType)
    return
  } catch (e) {
    console.warn('[r2] presigned direct PUT failed, falling back to base64 API upload', e)
  }

  // 2) 兜底：base64 JSON 走 serverless（小文件可用；CORS 未配时仍能传小图，但 >~4.5MB 会被上限拦）。
  const base64 = await blobToBase64(blob)
  const res = await fetch('/api/r2-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, contentType, base64 }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `[r2] upload failed ${res.status}`)
  }
}

async function r2DeletePrefix(prefix: string): Promise<void> {
  const res = await fetch('/api/r2-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefix }),
  })
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(j.error || `[r2] delete failed ${res.status}`)
  }
}

// 资产文件名带 nanoid、内容不可变 → 放心吃 HTTP 缓存（meta/canvas/library 等可变 JSON 仍走 no-store）
async function r2FetchBlobFromPublicThenApi(key: string, mime: string): Promise<Blob | null> {
  try {
    const url = r2PublicUrlForKey(key)
    const res = await fetch(url, { credentials: 'omit', cache: 'force-cache' })
    if (res.ok) {
      const b = await res.blob()
      if (b.size > 0) return b
    }
  } catch {
    /* fall through */
  }
  const qs = new URLSearchParams({ key })
  const res2 = await fetch(`/api/r2-fetch?${qs.toString()}`, { cache: 'force-cache' })
  if (!res2.ok) return null
  const buf = await res2.arrayBuffer()
  return new Blob([buf], { type: mime })
}

async function listProjectsFromR2(): Promise<ProjectMeta[]> {
  const prefixes = await r2ListProjectPrefixes()
  const metas: ProjectMeta[] = []
  for (const p of prefixes) {
    const id = projectIdFromR2ListPrefix(p)
    if (!id) continue
    const json = await r2FetchTextFromPublic(r2ObjectKey(id, 'meta.json'))
    if (json == null) continue
    try {
      const meta = JSON.parse(json) as ProjectMeta
      if (meta && typeof meta.id === 'string') metas.push(meta)
    } catch {
      console.warn(`[r2] skip invalid meta.json prefix=${p}`)
    }
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

async function loadProjectFromR2(id: string): Promise<LoadedProject> {
  const metaKey = r2ObjectKey(id, 'meta.json')
  const canvasKey = r2ObjectKey(id, 'canvas.json')
  const [metaJson, canvasJson] = await Promise.all([
    r2FetchTextFromPublic(metaKey),
    r2FetchTextFromPublic(canvasKey),
  ])
  if (metaJson == null || canvasJson == null) {
    throw new Error(`[r2] missing project files ${PROJECT_PREFIX}${id}`)
  }
  return {
    meta: JSON.parse(metaJson) as ProjectMeta,
    canvas: JSON.parse(canvasJson) as CanvasData,
  }
}

async function fetchProjectCanvasFromR2(projectId: string): Promise<CanvasData> {
  const json = await r2FetchTextFromPublic(r2ObjectKey(projectId, 'canvas.json'))
  if (json == null) throw new Error(`[r2] missing canvas.json ${PROJECT_PREFIX}${projectId}`)
  return JSON.parse(json) as CanvasData
}

// ─── errors ───────────────────────────────────────────────────────────────────

/** Current PAT rejected — call {@link setToken} with a new PAT. */
export class GitHubReauthRequiredError extends Error {
  readonly code = 'GITHUB_REAUTH_REQUIRED' as const
  constructor(message = 'GitHub PAT expired or invalid. Call setToken() with a new PAT.') {
    super(message)
    this.name = 'GitHubReauthRequiredError'
  }
}

/** Could not merge with remote — caller may surface UI; library retries overwrite once with fresh SHA. */
export class GitHubSyncConflictError extends Error {
  readonly code = 'GITHUB_SYNC_CONFLICT' as const
  constructor(message = 'GitHub content SHA conflict after retry.') {
    super(message)
    this.name = 'GitHubSyncConflictError'
  }
}

// ─── types ──────────────────────────────────────────────────────────────────

export interface CanvasToolRepoInfo {
  id: number
  name: string
  full_name: string
  html_url: string
  default_branch: string
}

export interface LoadedProject {
  meta: ProjectMeta
  canvas: CanvasData
}

type PendingQueueFile = {
  version: 1
  items: PendingItem[]
}

type PendingItem =
  | {
      v: 1
      kind: 'save'
      projectId: string
      meta: ProjectMeta
      canvas: CanvasData
      assets: { name: string; dataBase64: string }[]
    }
  | { v: 1; kind: 'delete'; projectId: string }

interface PendingPayload {
  meta: ProjectMeta
  canvas: CanvasData
  assets: { name: string; blob: Blob }[]
}

// ─── HTTP / GitHub helpers ─────────────────────────────────────────────────

/** Octokit / fetch errors may expose status on the error or on `response`. */
function getHttpStatus(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null) {
    const s = (e as { status?: unknown }).status
    if (typeof s === 'number') return s
    const rs = (e as { response?: { status?: number } }).response?.status
    if (typeof rs === 'number') return rs
  }
  return undefined
}

function is404(e: unknown): boolean {
  return getHttpStatus(e) === 404
}

function is401(e: unknown): boolean {
  return getHttpStatus(e) === 401
}

function shouldQueueOffline(e: unknown): boolean {
  if (e instanceof TypeError) return true // Failed to fetch, etc.
  const st = getHttpStatus(e)
  if (st != null) return st >= 500 || st === 0
  return false
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function ghTextContentToString(contentBase64: string): string {
  const clean = contentBase64.replace(/\s/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function base64ToBlob(b64: string, mime = 'application/octet-stream'): Blob {
  const clean = b64.replace(/\s/g, '')
  const bin = atob(clean)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function extractProjectFolderId(entryName: string): string | null {
  if (!entryName.startsWith(PROJECT_PREFIX)) return null
  return entryName.slice(PROJECT_PREFIX.length)
}

// ─── auth + octokit (PAT) ───────────────────────────────────────────────────

export function getToken(): string | null {
  try {
    return localStorage.getItem(GITHUB_PAT_KEY)
  } catch {
    return null
  }
}

/** Validates the PAT via `GET /user`, then persists it under {@link GITHUB_PAT_KEY}. */
export async function setToken(token: string): Promise<void> {
  const trimmed = token.trim()
  if (!trimmed) throw new Error('GitHub PAT is empty')

  const probe = createOctokit(trimmed)
  try {
    await probe.rest.users.getAuthenticated()
  } catch (e) {
    if (is401(e))
      throw new Error('GitHub PAT invalid or lacks access (401)', { cause: e })
    throw e
  }

  try {
    localStorage.setItem(GITHUB_PAT_KEY, trimmed)
    localStorage.removeItem(GITHUB_LOGIN_KEY)
  } catch {
    throw new Error('Could not persist GitHub PAT')
  }

  cachedRepoBranch = null
  clearReadCaches()
  await getOwnerLogin(createOctokit(trimmed))
  void syncPendingFromStorage()
  console.log('[github/auth] PAT saved (validated via /user)')
}

/** 切账号 / 登出时清读缓存，避免串账号数据。 */
function clearReadCaches(): void {
  cacheProjectsList = null
  cacheProjectCanvas.clear()
  cacheLibrary = null
}

export function clearToken(): void {
  try {
    localStorage.removeItem(GITHUB_PAT_KEY)
    localStorage.removeItem(GITHUB_LOGIN_KEY)
  } catch {
    /* ignore */
  }
  cachedRepoBranch = null
  clearReadCaches()
}

export function isAuthenticated(): boolean {
  return Boolean(getToken())
}

/** Cached GitHub username after successful PAT validation (`GET /user`). */
export function getGithubLogin(): string | null {
  try {
    return localStorage.getItem(GITHUB_LOGIN_KEY)
  } catch {
    return null
  }
}

/** Avoid stale GET responses (list/tree/content) from browser HTTP disk cache after mutations. */
function githubNoStoreFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, { ...init, cache: 'no-store' })
}

function createOctokit(token: string): Octokit {
  return new Octokit({
    auth: token,
    request: {
      fetch: githubNoStoreFetch,
    },
  })
}

async function getOwnerLogin(octokit: Octokit): Promise<string> {
  try {
    const cached = localStorage.getItem(GITHUB_LOGIN_KEY)
    if (cached) return cached
  } catch {
    /* ignore */
  }
  const { data } = await octokit.rest.users.getAuthenticated()
  try {
    localStorage.setItem(GITHUB_LOGIN_KEY, data.login)
  } catch {
    /* ignore */
  }
  return data.login
}

async function getAuthenticatedOctokit(): Promise<Octokit> {
  const token = getToken()
  if (!token) throw new GitHubReauthRequiredError()
  return createOctokit(token)
}

function handle401(): never {
  clearToken()
  throw new GitHubReauthRequiredError()
}

// ─── repo context ────────────────────────────────────────────────────────────

let cachedRepoBranch: string | null = null

/**
 * Convert a GitHub raw file URL to jsDelivr CDN (`cdn.jsdelivr.net/gh/...`) for faster reads + edge cache.
 * Non-matching URLs (data:, other hosts, malformed) are returned unchanged.
 * Note: jsDelivr `gh` serves **public** repos; private repos may 404 — callers can fall back (e.g. {@link fetchAsset}).
 */
export function githubRawToJsdelivr(url: string): string {
  const trimmed = url.trim()
  try {
    const u = new URL(trimmed)
    if (u.hostname !== 'raw.githubusercontent.com') return trimmed
    const segments = u.pathname.split('/').filter(Boolean)
    if (segments.length < 4) return trimmed
    const owner = segments[0]
    const repo = segments[1]
    const branch = segments[2]
    const pathInRepo = segments.slice(3).join('/')
    return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${pathInRepo}`
  } catch {
    return trimmed
  }
}

/**
 * jsDelivr CDN URL for any file path in a GitHub repo (`gh` endpoint).
 * Same mapping as {@link githubRawToJsdelivr}; use for metadata JSON reads (see {@link readRepoJsonFileCdnFirst}).
 */
export function githubRepoPathToJsdelivrUrl(
  owner: string,
  repo: string,
  branch: string,
  pathInRepo: string,
): string {
  const p = pathInRepo.replace(/^\/+/, '')
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${p}`
  return githubRawToJsdelivr(raw)
}

async function fetchRepoFileTextFromCdn(
  owner: string,
  repo: string,
  branch: string,
  pathInRepo: string,
): Promise<string | null> {
  const url = githubRepoPathToJsdelivrUrl(owner, repo, branch, pathInRepo)
  try {
    const res = await fetch(url, { credentials: 'omit', cache: 'default' })
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function readRepoTextFileViaContentsApi(
  octokit: Octokit,
  owner: string,
  branch: string,
  pathInRepo: string,
): Promise<string> {
  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo: REPO_NAME,
    path: pathInRepo,
    ref: branch,
  })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Not a file: ${pathInRepo}`)
  }
  return ghTextContentToString(data.content)
}

/**
 * Read small repo JSON files (meta.json, canvas.json): jsDelivr first, GitHub Contents API on miss / private repo / invalid body.
 */
async function readRepoJsonFileCdnFirst(
  octokit: Octokit,
  owner: string,
  branch: string,
  pathInRepo: string,
): Promise<string> {
  const fromCdn = await fetchRepoFileTextFromCdn(owner, REPO_NAME, branch, pathInRepo)
  if (fromCdn != null && fromCdn.length > 0) {
    try {
      JSON.parse(fromCdn)
      return fromCdn
    } catch {
      console.warn(`[github/cdn] invalid JSON from CDN path=${pathInRepo}, falling back to Contents API`)
    }
  }
  return readRepoTextFileViaContentsApi(octokit, owner, branch, pathInRepo)
}

/** Owner / repo / default branch — for building asset read URLs (via jsDelivr when applicable). */
export function getRepoConfig(): { owner: string; repo: string; branch: string } {
  const owner = getGithubLogin()
  if (!owner) {
    throw new Error('[github] 未登录，无法构造 raw 资源 URL')
  }
  return {
    owner,
    repo: REPO_NAME,
    branch: cachedRepoBranch ?? 'main',
  }
}

/**
 * Public read URL for a file under `project-{projectSlug}/`.
 * When `VITE_R2_PUBLIC_URL` is set, uses R2 public URL; otherwise jsDelivr over GitHub raw.
 * @param projectSlug 项目 id（与路由一致，不含 `project-` 前缀）
 * @param assetPath 如 `assets/img-xxx.png`
 */
export function getRawAssetUrl(projectSlug: string, assetPath: string): string {
  const normalized = assetPath.replace(/^\/+/, '')
  if (r2PublicReadConfigured()) {
    return r2PublicUrlForKey(r2ObjectKey(projectSlug, ...normalized.split('/').filter(Boolean)))
  }
  const { owner, repo, branch } = getRepoConfig()
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/project-${projectSlug}/${normalized}`
  return githubRawToJsdelivr(raw)
}

async function getRepoBranch(octokit: Octokit, owner: string): Promise<string> {
  if (cachedRepoBranch) return cachedRepoBranch
  const { data } = await octokit.rest.repos.get({ owner, repo: REPO_NAME })
  cachedRepoBranch = data.default_branch
  return cachedRepoBranch
}

/** Ensures the private `canvas-tool-projects` repo exists; seeds README + `.gitignore` when created. */
async function ensureRepoGithub(): Promise<CanvasToolRepoInfo> {
  const octokit = await getAuthenticatedOctokit()
  const owner = await getOwnerLogin(octokit)

  try {
    const { data } = await octokit.rest.repos.get({ owner, repo: REPO_NAME })
    cachedRepoBranch = data.default_branch
    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
      default_branch: data.default_branch,
    }
  } catch (e) {
    if (is401(e)) handle401()
    if (!is404(e)) throw e

    let seededNewRepo = false
    try {
      await octokit.rest.repos.createForAuthenticatedUser({
        name: REPO_NAME,
        private: true,
        auto_init: false,
      })
      seededNewRepo = true
    } catch (createErr) {
      if (is401(createErr)) handle401()
      if (getHttpStatus(createErr) !== 422) throw createErr
    }

    const { data } = await octokit.rest.repos.get({ owner, repo: REPO_NAME })
    cachedRepoBranch = data.default_branch

    if (seededNewRepo) {
      const branch = data.default_branch
      const readme = '# Canvas Tool Projects\n\nPrivate sync storage for canvas-tool v2.\n'
      await putTextFile(octokit, owner, branch, 'README.md', readme, `init README.md`, null)

      const gitignore = '*.DS_Store\n.env\n*.local\n'
      await putTextFile(octokit, owner, branch, '.gitignore', gitignore, `init .gitignore`, null)
    }

    return {
      id: data.id,
      name: data.name,
      full_name: data.full_name,
      html_url: data.html_url,
      default_branch: data.default_branch,
    }
  }
}

/**
 * When R2 is configured, skips GitHub repo bootstrap (lazy storage via R2 + `/api/r2-*`).
 * Otherwise ensures the GitHub sync repo exists.
 */
export async function ensureRepo(): Promise<CanvasToolRepoInfo> {
  if (r2PublicReadConfigured()) {
    return {
      id: 0,
      name: 'r2',
      full_name: 'r2/canvas-storage',
      html_url: r2PublicBase(),
      default_branch: 'main',
    }
  }
  return ensureRepoGithub()
}

async function getShaIfExists(
  octokit: Octokit,
  owner: string,
  path: string,
  ref: string,
): Promise<string | null> {
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: REPO_NAME,
      path,
      ref,
    })
    if (Array.isArray(data)) return null
    return data.sha
  } catch (e) {
    if (is401(e)) handle401()
    /** Missing file / path → create on next PUT (omit `sha`). Never throw for 404. */
    if (is404(e)) return null
    throw e
  }
}

async function putTextFile(
  octokit: Octokit,
  owner: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  sha: string | null,
): Promise<void> {
  await putWithConflictRetry(octokit, owner, branch, path, utf8ToBase64(content), message, sha)
}

async function putBinaryFile(
  octokit: Octokit,
  owner: string,
  branch: string,
  path: string,
  base64: string,
  message: string,
  sha: string | null,
): Promise<{ data: CreateOrUpdateFileResponseData; status: number }> {
  return putWithConflictRetry(octokit, owner, branch, path, base64, message, sha)
}

type CreateOrUpdateFileResponseData = Awaited<
  ReturnType<Octokit['rest']['repos']['createOrUpdateFileContents']>
>['data']

async function putWithConflictRetry(
  octokit: Octokit,
  owner: string,
  branch: string,
  path: string,
  contentBase64: string,
  message: string,
  sha: string | null,
): Promise<{ data: CreateOrUpdateFileResponseData; status: number }> {
  const attempt = async (
    useSha: string | null,
    depth: number,
  ): Promise<{ data: CreateOrUpdateFileResponseData; status: number }> => {
    try {
      const resp = await octokit.rest.repos.createOrUpdateFileContents({
        owner,
        repo: REPO_NAME,
        path,
        branch,
        message,
        content: contentBase64,
        ...(useSha != null && useSha !== '' ? { sha: useSha } : {}),
      })
      return { data: resp.data, status: resp.status }
    } catch (e) {
      if (is401(e)) handle401()
      if (depth > 0 && isConflictStatus(e)) {
        const fresh = await getShaIfExists(octokit, owner, path, branch)
        return await attempt(fresh, depth - 1)
      }
      throw e
    }
  }
  return await attempt(sha, 2)
}

/** Prefer PUT response; GitHub may omit `content` on large payloads — then GET the file. */
async function verifyUploadedBinarySize(
  octokit: Octokit,
  owner: string,
  branch: string,
  filePath: string,
  putResponseData: CreateOrUpdateFileResponseData,
  expectedBytes: number,
): Promise<void> {
  const raw = putResponseData.content
  let remoteSize: number | null = null
  if (raw != null && typeof raw === 'object' && 'size' in raw && typeof (raw as { size: unknown }).size === 'number') {
    remoteSize = (raw as { size: number }).size
  }
  if (remoteSize != null && remoteSize === expectedBytes) return
  if (remoteSize != null && remoteSize !== expectedBytes) {
    throw new Error(
      `[github/save] asset verify failed path=${filePath} expected ${expectedBytes} bytes from blob, response.content.size=${remoteSize}`,
    )
  }

  const { data } = await octokit.rest.repos.getContent({
    owner,
    repo: REPO_NAME,
    path: filePath,
    ref: branch,
  })
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`[github/save] asset verify failed path=${filePath}: not a file after PUT`)
  }
  if (data.size !== expectedBytes) {
    throw new Error(
      `[github/save] asset verify failed path=${filePath} expected ${expectedBytes} bytes from blob, GET size=${data.size}`,
    )
  }
}

function isConflictStatus(e: unknown): boolean {
  const st = getHttpStatus(e)
  return st === 409 || st === 422 || st === 412
}

// ─── projects API ────────────────────────────────────────────────────────────

const META_JSON_PATH_RE = /^project-([^/]+)\/meta\.json$/

/**
 * One Git Tree API call for the whole repo (`recursive=1`). Uses PAT on api.github.com.
 * @throws If tree is truncated (unlikely) or ref/commit/tree fails.
 */
async function getRepoTreeRecursiveInternal(
  octokit: Octokit,
  owner: string,
  branch: string,
): Promise<Array<{ path?: string; type?: string; sha?: string; mode?: string; size?: number }>> {
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo: REPO_NAME,
    ref: `heads/${branch}`,
  })
  const commitSha = refData.object.sha
  const { data: commitData } = await octokit.rest.git.getCommit({
    owner,
    repo: REPO_NAME,
    commit_sha: commitSha,
  })
  const treeSha = commitData.tree.sha
  const { data: treeData } = await octokit.rest.git.getTree({
    owner,
    repo: REPO_NAME,
    tree_sha: treeSha,
    recursive: 'true',
  })
  if (treeData.truncated) {
    throw new Error('[github] git/tree recursive truncated')
  }
  return treeData.tree ?? []
}

/**
 * Public helper: full recursive tree for `canvas-tool-projects` (same as {@link listProjects} listing source).
 */
export async function getRepoTreeRecursive(
  owner: string,
  repo: string,
  branch: string,
): Promise<Array<{ path?: string; type?: string; sha?: string; mode?: string; size?: number }>> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const login = await getOwnerLogin(octokit)
  if (login !== owner) {
    throw new Error('[github] getRepoTreeRecursive: owner must match authenticated user')
  }
  if (repo !== REPO_NAME) {
    throw new Error('[github] getRepoTreeRecursive: repo must be canvas-tool-projects')
  }
  return getRepoTreeRecursiveInternal(octokit, owner, branch)
}

/** Fallback: root Contents listing + per-dir meta (N+1 API calls). */
async function listProjectsViaContentsListing(
  octokit: Octokit,
  owner: string,
  branch: string,
): Promise<ProjectMeta[]> {
  let rootItems: Awaited<
    ReturnType<typeof octokit.rest.repos.getContent>
  >['data']
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: REPO_NAME,
      path: '',
      ref: branch,
    })
    rootItems = data
  } catch (e) {
    if (is401(e)) handle401()
    throw e
  }

  if (!Array.isArray(rootItems)) return []

  const metas: ProjectMeta[] = []

  for (const entry of rootItems) {
    if (entry.type !== 'dir') continue
    const id = extractProjectFolderId(entry.name)
    if (!id) continue

    const metaPath = `${PROJECT_PREFIX}${id}/meta.json`
    try {
      const json = await readRepoJsonFileCdnFirst(octokit, owner, branch, metaPath)
      const meta = JSON.parse(json) as ProjectMeta
      if (meta && typeof meta.id === 'string') metas.push(meta)
    } catch (e) {
      if (is401(e)) handle401()
      if (is404(e)) continue
      console.warn(`[github] skip project folder ${entry.name}:`, e)
    }
  }

  metas.sort((a, b) => b.updatedAt - a.updatedAt)
  return metas
}

/** Lists `project-{id}/meta.json` across the repo; sorted by `updatedAt` descending. */
export async function listProjects(): Promise<ProjectMeta[]> {
  if (cacheProjectsList) return cacheProjectsList
  const r = await listProjectsUncached()
  cacheProjectsList = r
  return r
}

async function listProjectsUncached(): Promise<ProjectMeta[]> {
  const octokit = await getAuthenticatedOctokit()
  if (r2PublicReadConfigured()) {
    try {
      return await listProjectsFromR2()
    } catch (e) {
      console.warn('[r2] listProjects failed, falling back to GitHub', e)
    }
  }
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)

  try {
    const tree = await getRepoTreeRecursiveInternal(octokit, owner, branch)
    const metaPaths = new Set<string>()
    for (const entry of tree) {
      if (entry.type !== 'blob' || !entry.path) continue
      if (!META_JSON_PATH_RE.test(entry.path)) continue
      metaPaths.add(entry.path)
    }

    const metas: ProjectMeta[] = []
    for (const metaPath of metaPaths) {
      try {
        const json = await readRepoJsonFileCdnFirst(octokit, owner, branch, metaPath)
        const meta = JSON.parse(json) as ProjectMeta
        if (meta && typeof meta.id === 'string') metas.push(meta)
      } catch (e) {
        if (is401(e)) handle401()
        if (is404(e)) continue
        console.warn(`[github] skip meta ${metaPath}:`, e)
      }
    }

    metas.sort((a, b) => b.updatedAt - a.updatedAt)
    return metas
  } catch (e) {
    console.warn('[github] listProjects: Git Tree listing failed, falling back to Contents API', e)
    return listProjectsViaContentsListing(octokit, owner, branch)
  }
}

/** Loads `meta.json` + `canvas.json` only (assets are loaded via {@link fetchAsset}). */
export async function loadProject(id: string): Promise<LoadedProject> {
  const octokit = await getAuthenticatedOctokit()
  if (r2PublicReadConfigured()) {
    try {
      return await loadProjectFromR2(id)
    } catch (e) {
      console.warn('[r2] loadProject failed, falling back to GitHub', e)
    }
  }
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const base = `${PROJECT_PREFIX}${id}`

  let metaJson: string
  let canvasJson: string
  try {
    metaJson = await readRepoJsonFileCdnFirst(octokit, owner, branch, `${base}/meta.json`)
    canvasJson = await readRepoJsonFileCdnFirst(octokit, owner, branch, `${base}/canvas.json`)
  } catch (e) {
    if (is401(e)) handle401()
    throw e
  }

  const meta = JSON.parse(metaJson) as ProjectMeta
  const canvas = JSON.parse(canvasJson) as CanvasData

  return { meta, canvas }
}

/**
 * Reads `project-{id}/canvas.json` only (lighter than {@link loadProject} for library thumbnails).
 */
export async function fetchProjectCanvas(projectId: string): Promise<CanvasData> {
  const c = cacheProjectCanvas.get(projectId)
  if (c) return c
  const r = await fetchProjectCanvasUncached(projectId)
  cacheProjectCanvas.set(projectId, r)
  return r
}

async function fetchProjectCanvasUncached(projectId: string): Promise<CanvasData> {
  const octokit = await getAuthenticatedOctokit()
  if (r2PublicReadConfigured()) {
    try {
      return await fetchProjectCanvasFromR2(projectId)
    } catch (e) {
      console.warn('[r2] fetchProjectCanvas failed, falling back to GitHub', e)
    }
  }
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${PROJECT_PREFIX}${projectId}/canvas.json`
  try {
    const json = await readRepoJsonFileCdnFirst(octokit, owner, branch, path)
    return JSON.parse(json) as CanvasData
  } catch (e) {
    if (is401(e)) handle401()
    throw e
  }
}

/** Resolve `assets/foo.png` from canvas image src (same rule as canvas upload). Does not import canvasUpload (avoid circular deps). */
function assetFilenameFromCanvasSrc(src: string): string | null {
  const t = src.trim()
  if (!t || t === 'pending') return null
  const fn = t.replace(/^assets\//, '').replace(/^\//, '')
  return fn || null
}

/**
 * Remove canvas rows whose asset file is missing on GitHub or decodes to an empty blob (orphans after failed commits).
 * Uses {@link fetchAsset} so files &gt; 1MB (Contents API omits body) are not mistaken for missing.
 * Writes updated `meta.json` + `canvas.json` only when at least one row is removed.
 */
export async function cleanupOrphanCanvasAssets(
  projectId: string,
  meta: ProjectMeta,
  canvas: CanvasData,
): Promise<{ removedIds: string[]; nextCanvas: CanvasData; nextMeta: ProjectMeta; saved: boolean }> {
  const removedIds: string[] = []
  const kept: CanvasData['images'] = []

  for (const im of canvas.images) {
    const fn = assetFilenameFromCanvasSrc(im.src)
    if (!fn) {
      kept.push(im)
      continue
    }
    try {
      const blob = await fetchAsset(projectId, fn)
      if (blob.size === 0) {
        removedIds.push(im.id)
        continue
      }
      kept.push(im)
    } catch (e) {
      if (is404(e)) {
        removedIds.push(im.id)
        continue
      }
      if (is401(e)) handle401()
      throw e
    }
  }

  if (removedIds.length === 0) {
    return { removedIds, nextCanvas: canvas, nextMeta: meta, saved: false }
  }

  const now = Date.now()
  const nextMeta: ProjectMeta = { ...meta, updatedAt: now }
  const nextCanvas: CanvasData = {
    images: kept,
    textCards: canvas.textCards ?? [],
  }
  await saveProject(projectId, nextMeta, nextCanvas, [])

  return { removedIds, nextCanvas, nextMeta, saved: true }
}

/** Serialize GitHub saves — avoids parallel PUT canvas.json (409) and stale-payload retries overwriting newer state. */
let saveQueueTail: Promise<void> = Promise.resolve()
let saveQueueDepth = 0

/**
 * Writes `meta.json`, `canvas.json`, and optional new asset blobs to GitHub immediately (awaits each REST commit).
 * Failed saves may still be queued in localStorage (`github_pending_sync`) for retry when offline / conflict (see `persistFailedSave`).
 * All `saveProject` calls are serialized on a module-level queue.
 */
export async function saveProject(
  id: string,
  meta: ProjectMeta,
  canvas: CanvasData,
  newAssets?: { name: string; blob: Blob }[],
): Promise<void> {
  // 调用方在 async 间隙后可能拿到已清空的 store 快照——写 null 会摧毁远端 meta/canvas
  if (!meta || !canvas) {
    throw new Error(`[save] refusing to write null meta/canvas for project ${id}`)
  }
  invalidateProjectCaches(id)
  // 该 project 缩略图来源就是它的 canvas——存了直接更新缓存，省下一次重拉。
  cacheProjectCanvas.set(id, canvas)
  saveQueueDepth += 1
  console.log('[save/queue] queued, queueDepth=', saveQueueDepth)

  const payload: PendingPayload = {
    meta,
    canvas,
    assets: [...(newAssets ?? [])],
  }

  saveQueueTail = saveQueueTail
    .catch((err) => {
      console.warn('[save/queue] previous link rejected (chain continues)', err)
    })
    .then(async () => {
      console.log('[save/exec] starting')
      try {
        try {
          await flushSavePreferR2(id, payload)
        } catch (e) {
          await persistFailedSave(id, payload, e)
        }
      } catch (e) {
        console.error('[save/exec] error', e)
      } finally {
        saveQueueDepth -= 1
        console.log('[save/exec] done')
      }
    })

  await saveQueueTail
}

async function flushSaveToR2(projectId: string, payload: PendingPayload): Promise<void> {
  const base = `${PROJECT_PREFIX}${projectId}`
  const metaStr = `${JSON.stringify(payload.meta, null, 2)}\n`
  const canvasStr = `${JSON.stringify(payload.canvas, null, 2)}\n`
  console.log(`[r2/save] starting for ${base}`)
  for (const asset of payload.assets) {
    const safeName = asset.name.replace(/^\/+/, '')
    const key = `${base}/assets/${safeName}`
    if (!asset.blob || asset.blob.size === 0) {
      throw new Error(`[r2/save] refusing empty blob path=${key}`)
    }
    await r2UploadViaApi(key, asset.blob)
  }
  await r2UploadViaApi(`${base}/meta.json`, new Blob([metaStr], { type: 'application/json' }))
  await r2UploadViaApi(`${base}/canvas.json`, new Blob([canvasStr], { type: 'application/json' }))
  console.log(`[r2/save] done for ${base}`)
}

async function flushSavePreferR2(projectId: string, payload: PendingPayload): Promise<void> {
  if (!r2PublicReadConfigured()) {
    await flushSaveToGitHub(projectId, payload)
    return
  }
  try {
    await flushSaveToR2(projectId, payload)
  } catch (e) {
    console.warn('[r2/save] R2 path failed, falling back to GitHub', e)
    await flushSaveToGitHub(projectId, payload)
  }
}

async function flushSaveToGitHub(projectId: string, payload: PendingPayload): Promise<void> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const base = `${PROJECT_PREFIX}${projectId}`
  const iso = new Date().toISOString()
  const msg = `update ${payload.meta.name} - ${iso}`

  const metaStr = `${JSON.stringify(payload.meta, null, 2)}\n`
  const canvasStr = `${JSON.stringify(payload.canvas, null, 2)}\n`

  const plannedFiles = [
    ...payload.assets.map((a) => `${base}/assets/${a.name.replace(/^\/+/, '')}`),
    `${base}/meta.json`,
    `${base}/canvas.json`,
  ]
  console.log(`[github/save] starting commit for ${base}, files:`, plannedFiles)

  const putTextLogged = async (filePath: string, content: string): Promise<void> => {
    try {
      const sha = await getShaIfExists(octokit, owner, filePath, branch)
      const shaLabel = sha ?? 'null'
      console.log(`[github/save] getShaIfExists path=${filePath} sha=${shaLabel}`)
      await putTextFile(octokit, owner, branch, filePath, content, msg, sha)
      console.log(`[github/save] PUT path=${filePath} sha=${shaLabel} → success`)
    } catch (e) {
      console.error(`[github/save] error path=${filePath}`, e)
      throw e
    }
  }

  let assetUploadsPassed = 0
  for (const asset of payload.assets) {
    const { name, blob } = asset
    const safeName = name.replace(/^\/+/, '')
    const filePath = `${base}/assets/${safeName}`
    try {
      if (!blob || blob.size === 0) {
        throw new Error(`[github/save] refusing empty blob path=${filePath}`)
      }
      console.log('[upload/A]', {
        name: asset.name,
        blobSize: asset.blob.size,
        blobType: asset.blob.type,
      })
      const b64 = await blobToBase64(blob)
      console.log('[upload/B]', {
        name: asset.name,
        base64Length: b64.length,
        expectedRatio: (asset.blob.size * 4) / 3,
      })
      const sha = await getShaIfExists(octokit, owner, filePath, branch)
      const shaLabel = sha ?? 'null'
      console.log(`[github/save] getShaIfExists path=${filePath} sha=${shaLabel}`)
      const putResp = await putBinaryFile(octokit, owner, branch, filePath, b64, msg, sha)
      const putData = putResp.data
      const contentRaw = putData.content
      const contentSize =
        contentRaw != null && typeof contentRaw === 'object' && 'size' in contentRaw
          ? (contentRaw as { size: number }).size
          : undefined
      console.log('[upload/C]', {
        name: asset.name,
        status: putResp.status,
        contentSize,
      })
      const mismatch = contentSize != null && contentSize !== blob.size
      await verifyUploadedBinarySize(octokit, owner, branch, filePath, putData, blob.size)
      console.log('[upload/D]', {
        name: asset.name,
        verified: true,
        mismatch,
      })
      assetUploadsPassed += 1
      console.log(`[github/save] PUT+verify path=${filePath} sha=${shaLabel} size=${blob.size} → success`)
    } catch (e) {
      console.error(`[github/save] error path=${filePath}`, e)
      throw e
    }
  }

  await putTextLogged(`${base}/meta.json`, metaStr)
  await putTextLogged(`${base}/canvas.json`, canvasStr)

  console.log(`[github/save] commit done for ${base}`)
  console.log('[upload/E] all done', {
    totalAssets: payload.assets.length,
    allPassed: payload.assets.length === 0 || assetUploadsPassed === payload.assets.length,
  })
}

async function persistFailedSave(projectId: string, payload: PendingPayload, error: unknown): Promise<void> {
  const queuedSave = async (): Promise<void> => {
    await persistPendingQueueItem({
      v: 1,
      kind: 'save',
      projectId,
      meta: payload.meta,
      canvas: payload.canvas,
      assets: await serializeAssets(payload.assets),
    })
  }

  if (is401(error)) {
    await queuedSave()
    handle401()
  } else if (shouldQueueOffline(error)) {
    await queuedSave()
    return
  } else if (isConflictStatus(error)) {
    console.warn('[github] conflict — queued for retry (overwrite remote)')
    await queuedSave()
    return
  }

  throw error
}

async function serializeAssets(
  assets: { name: string; blob: Blob }[],
): Promise<{ name: string; dataBase64: string }[]> {
  const out: { name: string; dataBase64: string }[] = []
  for (const a of assets) {
    out.push({ name: a.name, dataBase64: await blobToBase64(a.blob) })
  }
  return out
}

function readPendingQueue(): PendingQueueFile {
  try {
    const raw = localStorage.getItem(PENDING_SYNC_KEY)
    if (!raw) return { version: 1, items: [] }
    const parsed = JSON.parse(raw) as PendingQueueFile
    if (parsed?.version === 1 && Array.isArray(parsed.items)) return parsed
  } catch {
    /* ignore */
  }
  return { version: 1, items: [] }
}

function writePendingQueue(q: PendingQueueFile): void {
  try {
    localStorage.setItem(PENDING_SYNC_KEY, JSON.stringify(q))
  } catch {
    /* ignore */
  }
}

async function persistPendingQueueItem(item: PendingItem): Promise<void> {
  const q = readPendingQueue()
  q.items.push(item)
  writePendingQueue(q)
}

/** Flushes queued saves/deletes (e.g. after auth or when `online`). */
export async function syncPendingFromStorage(): Promise<void> {
  if (!isAuthenticated()) return

  const items = readPendingQueue().items
  if (items.length === 0) return

  const remaining: PendingItem[] = []

  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    try {
      if (item.kind === 'save') {
        const payload: PendingPayload = {
          meta: item.meta,
          canvas: item.canvas,
          assets: item.assets.map(({ name, dataBase64 }) => ({
            name,
            blob: base64ToBlob(dataBase64),
          })),
        }
        await flushSavePreferR2(item.projectId, payload)
      } else {
        await deleteProjectImmediate(item.projectId)
      }
    } catch (e) {
      if (is401(e)) {
        remaining.push(item, ...items.slice(i + 1))
        writePendingQueue({ version: 1, items: remaining })
        handle401()
      } else {
        remaining.push(item)
      }
    }
  }

  writePendingQueue({ version: 1, items: remaining })
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    void syncPendingFromStorage()
  })
}

/** Deletes `project-{id}/` (all nested files). Commit per file (GitHub Contents API). */
export async function deleteProject(id: string): Promise<void> {
  invalidateProjectCaches(id)
  try {
    await deleteProjectImmediate(id)
  } catch (e) {
    console.error(`[github/delete] deleteProject failed project-${id}`, e)
    if (is401(e) || shouldQueueOffline(e)) {
      await persistPendingQueueItem({ v: 1, kind: 'delete', projectId: id })
      if (is401(e)) handle401()
      return
    }
    throw e
  }
}

async function deleteProjectImmediate(id: string): Promise<void> {
  if (r2PublicReadConfigured()) {
    try {
      await r2DeletePrefix(`${PROJECT_PREFIX}${id}/`)
      console.log(`[r2/delete] done project-${id}`)
      return
    } catch (e) {
      console.warn('[r2/delete] failed, falling back to GitHub', e)
    }
  }

  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const root = `${PROJECT_PREFIX}${id}`
  const visited = new Set<string>()

  console.log(`[github/delete] starting delete ${root}`)

  const deleteOneFile = async (filePath: string, sha: string): Promise<void> => {
    const shaShort = sha.length > 10 ? `${sha.slice(0, 7)}…` : sha
    try {
      await octokit.rest.repos.deleteFile({
        owner,
        repo: REPO_NAME,
        path: filePath,
        message: `delete ${filePath}`,
        sha,
        branch,
      })
      console.log(`[github/delete] DELETE path=${filePath} sha=${shaShort} → success`)
    } catch (e) {
      if (is401(e)) handle401()
      const st = getHttpStatus(e)
      if (st === 404) {
        console.log(`[github/delete] DELETE path=${filePath} sha=${shaShort} → 404 ignored (already gone)`)
        return
      }
      console.error(`[github/delete] error path=${filePath}`, e)
      throw e
    }
  }

  const deleteTree = async (path: string): Promise<void> => {
    if (visited.has(path)) {
      console.log(`[github/delete] skip duplicate path=${path}`)
      return
    }
    visited.add(path)

    let data: Awaited<ReturnType<typeof octokit.rest.repos.getContent>>['data']
    try {
      ;({ data } = await octokit.rest.repos.getContent({
        owner,
        repo: REPO_NAME,
        path,
        ref: branch,
      }))
    } catch (e) {
      if (is401(e)) handle401()
      if (is404(e)) {
        console.log(`[github/delete] list path=${path} → 404 ignored (already gone)`)
        return
      }
      console.error(`[github/delete] error path=${path}`, e)
      throw e
    }

    if (!Array.isArray(data)) {
      if (data.type === 'file') {
        await deleteOneFile(path, data.sha)
      }
      return
    }

    if (data.length === 0) {
      console.log(`[github/delete] deleteTree path=${path} found 0 children`)
      return
    }

    console.log(`[github/delete] deleteTree path=${path} found ${data.length} children`)

    const dirs = data.filter((e) => e.type === 'dir')
    const files = data.filter((e) => e.type === 'file')

    for (const entry of dirs) {
      await deleteTree(entry.path)
    }
    for (const entry of files) {
      await deleteOneFile(entry.path, entry.sha)
    }
  }

  await deleteTree(root)
  console.log(`[github/delete] done for ${root}`)
}

/** GitHub Contents API omits `content` for files &gt; ~1MB (empty string + optional `encoding: "none"`). */
function shouldFetchAssetViaGitBlob(data: {
  content: string | undefined
  encoding?: string
  size: number
}): boolean {
  const body = data.content ?? ''
  return (
    body === '' ||
    data.encoding === 'none' ||
    data.size > 1_000_000
  )
}

function mimeForAssetFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  return ext === 'png'
    ? 'image/png'
    : ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'webp'
        ? 'image/webp'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'mp4'
            ? 'video/mp4'
            : 'application/octet-stream'
}

async function fetchAssetFromGitHub(id: string, filename: string): Promise<Blob> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${PROJECT_PREFIX}${id}/assets/${filename.replace(/^\/+/, '')}`
  const mime = mimeForAssetFilename(filename)

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: REPO_NAME,
      path,
      ref: branch,
    })
    if (Array.isArray(data) || data.type !== 'file') throw new Error(`Not a file: ${path}`)

    const large = shouldFetchAssetViaGitBlob({
      content: typeof data.content === 'string' ? data.content : undefined,
      encoding: data.encoding,
      size: data.size,
    })
    console.log(
      `[fetch/path] size=${data.size}、` +
        (large ? 'large 走 getBlob' : 'small 走 getContent'),
      { path },
    )

    let out: Blob
    if (large) {
      if (!data.sha) {
        throw new Error(`[fetchAsset] missing sha for git blob path=${path}`)
      }
      const { data: blobData } = await octokit.rest.git.getBlob({
        owner,
        repo: REPO_NAME,
        file_sha: data.sha,
      })
      if (blobData.encoding !== 'base64' || blobData.content == null) {
        throw new Error(`[fetchAsset] unexpected git/blobs payload path=${path}`)
      }
      const clean = blobData.content.replace(/\s/g, '')
      out = base64ToBlob(clean, mime)
    } else {
      const clean = (typeof data.content === 'string' ? data.content : '').replace(/\s/g, '')
      out = base64ToBlob(clean, mime)
    }

    console.log('[fetch/done]', { size: out.size, type: out.type })
    return out
  } catch (e) {
    if (is401(e)) handle401()
    throw e
  }
}

/** Lazy-loads one asset under `project-{id}/assets/{filename}` as a `Blob`. */
export async function fetchAsset(id: string, filename: string): Promise<Blob> {
  const mime = mimeForAssetFilename(filename)
  const key = `${PROJECT_PREFIX}${id}/assets/${filename.replace(/^\/+/, '')}`

  if (r2PublicReadConfigured()) {
    try {
      const blob = await r2FetchBlobFromPublicThenApi(key, mime)
      if (blob && blob.size > 0) {
        console.log('[fetch/r2] done', { size: blob.size, type: blob.type })
        return blob
      }
    } catch (e) {
      console.warn('[r2/fetchAsset] failed, falling back to GitHub', e)
    }
  }

  return fetchAssetFromGitHub(id, filename)
}

// ─── 素材库 Asset Library (`_library/`) ──────────────────────────────────────
//
// 跨 project 全局存储层，复用上方 R2 + GitHub 基建（不另开 repo / OAuth）。
// 路径：`_library/library.json`（索引）+ `_library/assets/lib-{nanoid}.{ext}`（图片二进制）。

/** Build an object key / repo path under `_library/` (no `project-` prefix). */
function libraryKey(...segments: string[]): string {
  const rest = segments.map((s) => s.replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean)
  return [LIBRARY_PREFIX, ...rest].join('/')
}

/**
 * Read a text object from R2, distinguishing **genuinely missing (404)** from **transient error**.
 * Public URL first, then authoritative `/api/r2-fetch`. Throws on real errors so callers never
 * mistake a network blip for an empty library (which would overwrite real data on next save).
 */
async function r2FetchTextStrict(key: string): Promise<{ found: boolean; text: string | null }> {
  try {
    const res = await fetch(r2PublicUrlForKey(key), { credentials: 'omit', cache: 'no-store' })
    if (res.ok) return { found: true, text: await res.text() }
    if (res.status === 404) return { found: false, text: null }
  } catch {
    /* fall through to authoritative API */
  }
  const qs = new URLSearchParams({ key })
  const res2 = await fetch(`/api/r2-fetch?${qs.toString()}`, { cache: 'no-store' })
  if (res2.status === 404) return { found: false, text: null }
  if (!res2.ok) throw new Error(`[r2] library read failed ${res2.status}`)
  return { found: true, text: await res2.text() }
}

/** Loads `_library/library.json`. Missing file → empty library; transient errors throw. */
export async function loadLibrary(): Promise<LibraryData> {
  if (cacheLibrary) return cacheLibrary
  const r = await loadLibraryUncached()
  cacheLibrary = r
  return r
}

async function loadLibraryUncached(): Promise<LibraryData> {
  if (r2PublicReadConfigured()) {
    const { found, text } = await r2FetchTextStrict(libraryKey('library.json'))
    if (!found || !text) return { ...EMPTY_LIBRARY }
    try {
      return normalizeLibraryData(JSON.parse(text))
    } catch {
      throw new Error('[r2] library.json invalid JSON')
    }
  }

  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  try {
    // 用 Contents API（no-store、权威）而**不是** jsDelivr CDN——library.json 是可变索引、
    // 写后立刻读，走 CDN 会拿到 @branch 的过期缓存：导致「存入成功但不显示」、
    // 且 saveImageToLibrary 读到旧快照后追加会覆盖中间新增的素材（数据丢失）。
    const json = await readRepoTextFileViaContentsApi(octokit, owner, branch, `${LIBRARY_PREFIX}/library.json`)
    return normalizeLibraryData(JSON.parse(json))
  } catch (e) {
    if (is401(e)) handle401()
    if (is404(e)) return { ...EMPTY_LIBRARY }
    throw e
  }
}

async function flushLibraryToR2(
  data: LibraryData,
  newAssets: { name: string; blob: Blob }[],
): Promise<void> {
  for (const asset of newAssets) {
    const safeName = asset.name.replace(/^\/+/, '')
    const key = libraryKey('assets', safeName)
    if (!asset.blob || asset.blob.size === 0) {
      throw new Error(`[r2/library] refusing empty blob path=${key}`)
    }
    await r2UploadViaApi(key, asset.blob)
  }
  const json = `${JSON.stringify(data, null, 2)}\n`
  await r2UploadViaApi(libraryKey('library.json'), new Blob([json], { type: 'application/json' }))
}

async function flushLibraryToGitHub(
  data: LibraryData,
  newAssets: { name: string; blob: Blob }[],
): Promise<void> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const iso = new Date().toISOString()
  const msg = `update _library - ${iso}`

  for (const asset of newAssets) {
    const safeName = asset.name.replace(/^\/+/, '')
    const filePath = `${LIBRARY_PREFIX}/assets/${safeName}`
    if (!asset.blob || asset.blob.size === 0) {
      throw new Error(`[github/library] refusing empty blob path=${filePath}`)
    }
    const b64 = await blobToBase64(asset.blob)
    const sha = await getShaIfExists(octokit, owner, filePath, branch)
    const putResp = await putBinaryFile(octokit, owner, branch, filePath, b64, msg, sha)
    await verifyUploadedBinarySize(octokit, owner, branch, filePath, putResp.data, asset.blob.size)
  }

  const json = `${JSON.stringify(data, null, 2)}\n`
  const indexPath = `${LIBRARY_PREFIX}/library.json`
  const sha = await getShaIfExists(octokit, owner, indexPath, branch)
  await putTextFile(octokit, owner, branch, indexPath, json, msg, sha)
}

/**
 * Writes `_library/library.json` and optional new asset blobs. Prefers R2 when configured,
 * falls back to GitHub (same policy as {@link saveProject}). Throws on hard failure so callers can surface retry.
 */
export async function saveLibrary(
  data: LibraryData,
  newAssets: { name: string; blob: Blob }[] = [],
): Promise<void> {
  cacheLibrary = data // 写的就是新真相，缓存直接更新，下次 loadLibrary 即时且正确
  if (r2PublicReadConfigured()) {
    try {
      await flushLibraryToR2(data, newAssets)
      return
    } catch (e) {
      console.warn('[r2/library] save failed, falling back to GitHub', e)
    }
  }
  await flushLibraryToGitHub(data, newAssets)
}

async function fetchLibraryAssetFromGitHub(filename: string, mime: string): Promise<Blob> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${LIBRARY_PREFIX}/assets/${filename.replace(/^\/+/, '')}`

  try {
    const { data } = await octokit.rest.repos.getContent({ owner, repo: REPO_NAME, path, ref: branch })
    if (Array.isArray(data) || data.type !== 'file') throw new Error(`Not a file: ${path}`)

    const large = shouldFetchAssetViaGitBlob({
      content: typeof data.content === 'string' ? data.content : undefined,
      encoding: data.encoding,
      size: data.size,
    })
    if (large) {
      if (!data.sha) throw new Error(`[fetchLibraryAsset] missing sha for git blob path=${path}`)
      const { data: blobData } = await octokit.rest.git.getBlob({
        owner,
        repo: REPO_NAME,
        file_sha: data.sha,
      })
      if (blobData.encoding !== 'base64' || blobData.content == null) {
        throw new Error(`[fetchLibraryAsset] unexpected git/blobs payload path=${path}`)
      }
      return base64ToBlob(blobData.content.replace(/\s/g, ''), mime)
    }
    const clean = (typeof data.content === 'string' ? data.content : '').replace(/\s/g, '')
    return base64ToBlob(clean, mime)
  } catch (e) {
    if (is401(e)) handle401()
    throw e
  }
}

/** Lazy-loads one library asset under `_library/assets/{filename}` as a `Blob`. */
export async function fetchLibraryAsset(filename: string): Promise<Blob> {
  const mime = mimeForAssetFilename(filename)
  const key = libraryKey('assets', filename)
  if (r2PublicReadConfigured()) {
    try {
      const blob = await r2FetchBlobFromPublicThenApi(key, mime)
      if (blob && blob.size > 0) return blob
    } catch (e) {
      console.warn('[r2/fetchLibraryAsset] failed, falling back to GitHub', e)
    }
  }
  return fetchLibraryAssetFromGitHub(filename, mime)
}

/** Best-effort delete of one library asset object (R2 keys, else GitHub deleteFile). */
export async function deleteLibraryAssetObject(filename: string): Promise<void> {
  const safeName = filename.replace(/^\/+/, '')
  const key = libraryKey('assets', safeName)

  if (r2PublicReadConfigured()) {
    try {
      const res = await fetch('/api/r2-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [key] }),
      })
      if (res.ok) return
      console.warn(`[r2/library] delete asset failed ${res.status}, falling back to GitHub`)
    } catch (e) {
      console.warn('[r2/library] delete asset failed, falling back to GitHub', e)
    }
  }

  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${LIBRARY_PREFIX}/assets/${safeName}`
  const sha = await getShaIfExists(octokit, owner, path, branch)
  if (!sha) return
  try {
    await octokit.rest.repos.deleteFile({
      owner,
      repo: REPO_NAME,
      path,
      message: `delete ${path}`,
      sha,
      branch,
    })
  } catch (e) {
    if (is401(e)) handle401()
    if (is404(e)) return
    throw e
  }
}

// ─── Chat 小精灵会话同步 (`_chat/`) ─────────────────────────────────────────────
//
// 多设备共享聊天历史，复用上方 R2 + GitHub 基建（同 `_library`）。仅一个 JSON 索引、无二进制。
// 注：发图的 chat 图片二进制走 project/library 既有路径或 `_chat/assets/`（Phase 2）。

function chatKey(...segments: string[]): string {
  const rest = segments.map((s) => s.replace(/^\/+/, '').replace(/\/+$/, '')).filter(Boolean)
  return [CHAT_PREFIX, ...rest].join('/')
}

/**
 * 聊天图片的**公开 URL**（R2 公共 / jsDelivr）。用于多轮把历史图以 `image_url.url` 传给模型——
 * 模型服务端按 URL 拉取，免去重新 base64 编码。
 */
export function getChatAssetUrl(filename: string): string {
  const fn = filename.replace(/^\/+/, '')
  if (r2PublicReadConfigured()) {
    return r2PublicUrlForKey(chatKey('assets', fn))
  }
  const { owner, repo, branch } = getRepoConfig()
  const raw = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${CHAT_PREFIX}/assets/${fn}`
  return githubRawToJsdelivr(raw)
}

/** 每个 project 的会话文件 `_chat/{projectId}.json`（按项目分会话）。 */
function chatJsonName(projectId: string): string {
  return `${projectId}.json`
}

/** Loads `_chat/{projectId}.json`. Missing → empty; transient errors throw. 同 loadLibrary：不走 CDN。 */
export async function loadChat(projectId: string): Promise<ChatData> {
  if (r2PublicReadConfigured()) {
    const { found, text } = await r2FetchTextStrict(chatKey(chatJsonName(projectId)))
    if (!found || !text) return { ...EMPTY_CHAT }
    try {
      return normalizeChatData(JSON.parse(text))
    } catch {
      throw new Error('[r2] chat json invalid JSON')
    }
  }

  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  try {
    const json = await readRepoTextFileViaContentsApi(
      octokit,
      owner,
      branch,
      `${CHAT_PREFIX}/${chatJsonName(projectId)}`,
    )
    return normalizeChatData(JSON.parse(json))
  } catch (e) {
    if (is401(e)) handle401()
    if (is404(e)) return { ...EMPTY_CHAT }
    throw e
  }
}

async function flushChatToGitHub(
  projectId: string,
  data: ChatData,
  newAssets: { name: string; blob: Blob }[],
): Promise<void> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const msg = `update _chat - ${new Date().toISOString()}`

  for (const asset of newAssets) {
    const safeName = asset.name.replace(/^\/+/, '')
    const filePath = `${CHAT_PREFIX}/assets/${safeName}`
    if (!asset.blob || asset.blob.size === 0) continue
    const b64 = await blobToBase64(asset.blob)
    const sha = await getShaIfExists(octokit, owner, filePath, branch)
    await putBinaryFile(octokit, owner, branch, filePath, b64, msg, sha)
  }

  const json = `${JSON.stringify(data, null, 2)}\n`
  const path = `${CHAT_PREFIX}/${chatJsonName(projectId)}`
  const sha = await getShaIfExists(octokit, owner, path, branch)
  await putTextFile(octokit, owner, branch, path, json, msg, sha)
}

/** Writes `_chat/{projectId}.json` + optional image assets. Prefers R2, falls back to GitHub。 */
export async function saveChat(
  projectId: string,
  data: ChatData,
  newAssets: { name: string; blob: Blob }[] = [],
): Promise<void> {
  const json = `${JSON.stringify(data, null, 2)}\n`
  if (r2PublicReadConfigured()) {
    try {
      for (const asset of newAssets) {
        if (!asset.blob || asset.blob.size === 0) continue
        await r2UploadViaApi(chatKey('assets', asset.name.replace(/^\/+/, '')), asset.blob)
      }
      await r2UploadViaApi(
        chatKey(chatJsonName(projectId)),
        new Blob([json], { type: 'application/json' }),
      )
      return
    } catch (e) {
      console.warn('[r2/chat] save failed, falling back to GitHub', e)
    }
  }
  await flushChatToGitHub(projectId, data, newAssets)
}

/** Lazy-loads one chat image under `_chat/assets/{filename}` as a Blob（同 fetchLibraryAsset）。 */
export async function fetchChatAsset(filename: string): Promise<Blob> {
  const mime = mimeForAssetFilename(filename)
  const key = chatKey('assets', filename)
  if (r2PublicReadConfigured()) {
    try {
      const blob = await r2FetchBlobFromPublicThenApi(key, mime)
      if (blob && blob.size > 0) return blob
    } catch (e) {
      console.warn('[r2/fetchChatAsset] failed, falling back to GitHub', e)
    }
  }
  // GitHub 兜底
  const octokit = await getAuthenticatedOctokit()
  await ensureRepoGithub()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${CHAT_PREFIX}/assets/${filename.replace(/^\/+/, '')}`
  const { data } = await octokit.rest.repos.getContent({ owner, repo: REPO_NAME, path, ref: branch })
  if (Array.isArray(data) || data.type !== 'file') throw new Error(`Not a file: ${path}`)
  if (shouldFetchAssetViaGitBlob({ content: typeof data.content === 'string' ? data.content : undefined, encoding: data.encoding, size: data.size })) {
    if (!data.sha) throw new Error(`[fetchChatAsset] missing sha path=${path}`)
    const { data: blobData } = await octokit.rest.git.getBlob({ owner, repo: REPO_NAME, file_sha: data.sha })
    if (blobData.encoding !== 'base64' || blobData.content == null) throw new Error(`[fetchChatAsset] bad blob path=${path}`)
    return base64ToBlob(blobData.content.replace(/\s/g, ''), mime)
  }
  return base64ToBlob((typeof data.content === 'string' ? data.content : '').replace(/\s/g, ''), mime)
}
