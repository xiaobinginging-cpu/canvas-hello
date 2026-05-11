import { useEffect, useRef, useState } from 'react'
import type { Image as CanvasImage } from '../../types/image.ts'
import type { ProjectMeta } from '../../types/project'
import * as github from '../../lib/github.ts'
import { parseFilenameFromSrc } from '../../lib/canvasUpload.ts'
import { formatRelativeTimeZh } from '../../lib/formatRelativeTime'
import InlineSpinner from '../shared/InlineSpinner.tsx'

function pickFirstThumbnailImage(images: CanvasImage[] | undefined): CanvasImage | null {
  if (!images?.length) return null
  for (const img of images) {
    if (img.isLoading) continue
    if (img.uploadError) continue
    const s = img.src?.trim() ?? ''
    if (!s || s === 'pending') continue
    return img
  }
  return null
}

function isRemoteOrDataSrc(src: string): boolean {
  const t = src.trim()
  return t.startsWith('http://') || t.startsWith('https://') || t.startsWith('data:')
}

export default function ProjectCard({
  meta,
  onOpen,
  onTogglePin,
  onRename,
  onDelete,
  actionsBusy,
  pinBusy,
}: {
  meta: ProjectMeta
  onOpen: () => void
  onTogglePin: () => void
  onRename: () => void
  onDelete: () => void
  actionsBusy?: boolean
  pinBusy?: boolean
}) {
  const preview = meta.name.trim().slice(0, 48) || meta.id.slice(0, 12)

  const [thumbUrl, setThumbUrl] = useState<string | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const blobUrlRef = useRef<string | null>(null)
  /** When CDN thumb fails (e.g. private repo), fall back to GitHub API → blob URL once */
  const thumbBlobFallbackRef = useRef<{ filename: string } | null>(null)

  useEffect(() => {
    setImgLoaded(false)
  }, [thumbUrl])

  useEffect(() => {
    let cancelled = false
    blobUrlRef.current = null
    thumbBlobFallbackRef.current = null
    setThumbUrl(null)

    void (async () => {
      try {
        const canvas = await github.fetchProjectCanvas(meta.id)
        if (cancelled) return
        const first = pickFirstThumbnailImage(canvas.images)
        if (!first) {
          setThumbUrl(null)
          return
        }

        const raw = first.src.trim()
        if (raw.startsWith('data:')) {
          setThumbUrl(raw)
          return
        }
        if (isRemoteOrDataSrc(raw)) {
          setThumbUrl(github.githubRawToJsdelivr(raw))
          return
        }

        const filename = parseFilenameFromSrc(raw)
        if (!filename) {
          setThumbUrl(null)
          return
        }

        const assetPath = raw.startsWith('assets/') ? raw.replace(/^\/+/, '') : `assets/${filename}`
        thumbBlobFallbackRef.current = { filename }
        setThumbUrl(github.getRawAssetUrl(meta.id, assetPath))
      } catch {
        if (!cancelled) setThumbUrl(null)
      }
    })()

    return () => {
      cancelled = true
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current)
        blobUrlRef.current = null
      }
    }
  }, [meta.id])

  const showImageThumb = thumbUrl != null && thumbUrl !== ''

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onOpen}
        className="w-full rounded border border-neutral-300 bg-white text-left transition-colors hover:bg-neutral-50"
      >
        <div
          className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-[var(--cream-light)] px-3"
          aria-hidden
        >
          {showImageThumb ? (
            <>
              <img
                src={thumbUrl}
                alt=""
                onLoad={() => setImgLoaded(true)}
                onError={() => {
                  const fb = thumbBlobFallbackRef.current
                  if (fb && !blobUrlRef.current) {
                    const fn = fb.filename
                    thumbBlobFallbackRef.current = null
                    void (async () => {
                      try {
                        const blob = await github.fetchAsset(meta.id, fn)
                        const url = URL.createObjectURL(blob)
                        blobUrlRef.current = url
                        setThumbUrl(url)
                      } catch {
                        setImgLoaded(true)
                      }
                    })()
                    return
                  }
                  setImgLoaded(true)
                }}
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ease-out ${
                  imgLoaded ? 'opacity-100' : 'pointer-events-none opacity-0'
                }`}
              />
              {imgLoaded ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 px-3">
                  <span className="line-clamp-3 break-all text-center font-mono text-sm font-medium leading-snug text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                    {preview}
                  </span>
                </div>
              ) : (
                <span className="relative z-[1] line-clamp-3 break-all text-center font-mono text-sm leading-snug text-neutral-800">
                  {preview}
                </span>
              )}
            </>
          ) : (
            <span className="line-clamp-3 break-all text-center font-mono text-sm leading-snug text-neutral-800">
              {preview}
            </span>
          )}
        </div>
        <div className="border-t border-neutral-200 px-3 py-3">
          <div className="truncate font-mono text-sm font-medium text-neutral-900">{meta.name}</div>
          <div className="mt-1 font-mono text-xs text-neutral-500">
            {formatRelativeTimeZh(meta.updatedAt)}
          </div>
        </div>
      </button>

      <div
        className={`pointer-events-none absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 ${actionsBusy ? 'pointer-events-auto opacity-100' : ''}`}
      >
        <button
          type="button"
          title={meta.pinned ? '取消置顶' : '置顶'}
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onTogglePin()
          }}
          className="pointer-events-auto inline-flex min-h-[2rem] min-w-[2rem] items-center justify-center rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pinBusy ? <InlineSpinner /> : '📌'}
        </button>
        <button
          type="button"
          title="重命名"
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRename()
          }}
          className="pointer-events-auto rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          ✏️
        </button>
        <button
          type="button"
          title="删除"
          disabled={actionsBusy}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onDelete()
          }}
          className="pointer-events-auto rounded bg-white/95 px-2 py-1 font-mono text-sm text-neutral-900 ring-1 ring-neutral-300 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          🗑️
        </button>
      </div>
    </div>
  )
}
