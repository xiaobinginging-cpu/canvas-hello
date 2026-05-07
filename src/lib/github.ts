/**
 * GitHub REST sync via Personal Access Token (browser calls api.github.com directly; no OAuth code exchange).
 *
 * Create a PAT: https://github.com/settings/tokens — enable scope **repo**
 * (Full control of private repositories).
 */
import { Octokit } from '@octokit/rest'
import type { CanvasData, ProjectMeta } from '../types/project'

// ─── constants ───────────────────────────────────────────────────────────────

/** localStorage key for the validated PAT. */
export const GITHUB_PAT_KEY = 'github_pat'

const GITHUB_LOGIN_KEY = 'github_login'
const PENDING_SYNC_KEY = 'github_pending_sync'
const REPO_NAME = 'canvas-tool-projects'
const PROJECT_PREFIX = 'project-'

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
  await getOwnerLogin(createOctokit(trimmed))
  void syncPendingFromStorage()
  console.log('[github/auth] PAT saved (validated via /user)')
}

export function clearToken(): void {
  try {
    localStorage.removeItem(GITHUB_PAT_KEY)
    localStorage.removeItem(GITHUB_LOGIN_KEY)
  } catch {
    /* ignore */
  }
  cachedRepoBranch = null
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

/** Owner / repo / default branch — for building `raw.githubusercontent.com` URLs (needs login cache). */
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
 * Public raw URL for a file under `project-{projectSlug}/`.
 * @param projectSlug 项目 id（与路由一致，不含 `project-` 前缀）
 * @param assetPath 如 `assets/img-xxx.png`
 */
export function getRawAssetUrl(projectSlug: string, assetPath: string): string {
  const { owner, repo, branch } = getRepoConfig()
  const normalized = assetPath.replace(/^\/+/, '')
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/project-${projectSlug}/${normalized}`
}

async function getRepoBranch(octokit: Octokit, owner: string): Promise<string> {
  if (cachedRepoBranch) return cachedRepoBranch
  const { data } = await octokit.rest.repos.get({ owner, repo: REPO_NAME })
  cachedRepoBranch = data.default_branch
  return cachedRepoBranch
}

/** Ensures the private `canvas-tool-projects` repo exists; seeds README + `.gitignore` when created. */
export async function ensureRepo(): Promise<CanvasToolRepoInfo> {
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

/** Lists `project-{id}/meta.json` across the repo; sorted by `updatedAt` descending. */
export async function listProjects(): Promise<ProjectMeta[]> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)

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
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo: REPO_NAME,
        path: metaPath,
        ref: branch,
      })
      if (Array.isArray(data) || data.type !== 'file') continue
      const json = ghTextContentToString(data.content)
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

/** Loads `meta.json` + `canvas.json` only (assets are loaded via {@link fetchAsset}). */
export async function loadProject(id: string): Promise<LoadedProject> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const base = `${PROJECT_PREFIX}${id}`

  const readTextFile = async (path: string): Promise<string> => {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo: REPO_NAME,
        path,
        ref: branch,
      })
      if (Array.isArray(data) || data.type !== 'file') throw new Error(`Not a file: ${path}`)
      return ghTextContentToString(data.content)
    } catch (e) {
      if (is401(e)) handle401()
      throw e
    }
  }

  const metaJson = await readTextFile(`${base}/meta.json`)
  const canvasJson = await readTextFile(`${base}/canvas.json`)

  const meta = JSON.parse(metaJson) as ProjectMeta
  const canvas = JSON.parse(canvasJson) as CanvasData

  return { meta, canvas }
}

/**
 * Reads `project-{id}/canvas.json` only (lighter than {@link loadProject} for library thumbnails).
 */
export async function fetchProjectCanvas(projectId: string): Promise<CanvasData> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${PROJECT_PREFIX}${projectId}/canvas.json`
  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo: REPO_NAME,
      path,
      ref: branch,
    })
    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error(`Not a file: ${path}`)
    }
    const json = ghTextContentToString(data.content)
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
          await flushSaveToGitHub(id, payload)
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

async function flushSaveToGitHub(projectId: string, payload: PendingPayload): Promise<void> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
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
        await flushSaveToGitHub(item.projectId, payload)
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
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
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

/** Lazy-loads one asset under `project-{id}/assets/{filename}` as a `Blob`. */
export async function fetchAsset(id: string, filename: string): Promise<Blob> {
  const octokit = await getAuthenticatedOctokit()
  await ensureRepo()
  const owner = await getOwnerLogin(octokit)
  const branch = await getRepoBranch(octokit, owner)
  const path = `${PROJECT_PREFIX}${id}/assets/${filename.replace(/^\/+/, '')}`

  const ext = filename.split('.').pop()?.toLowerCase()
  const mime =
    ext === 'png'
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
