import { useEffect, useState } from 'react'
import { Rnd } from 'react-rnd'
import * as github from '../../lib/github.ts'
import { schedulePersistCanvas } from '../../lib/canvasPersist.ts'
import { cancelImageGeneration, retryCanvasImageGeneration } from '../../lib/canvasGeneration.ts'
import { parseFilenameFromSrc, retryImageUpload } from '../../lib/canvasUpload.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { Image as CanvasImage } from '../../types/image.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'
import ImageToolbar from './ImageToolbar.tsx'

function truncatePrompt(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

export default function ImageItem({ image }: { image: CanvasImage }) {
  const projectId = useProjectStore((s) => s.currentProjectId)
  const selectedImageId = useProjectStore((s) => s.selectedImageId)
  const objectUrl = useProjectStore((s) => s.imageObjectUrls.get(image.id))
  const updateImagePosition = useProjectStore((s) => s.updateImagePosition)
  const setSelectedImage = useProjectStore((s) => s.setSelectedImage)
  const canvasScale = useProjectStore((s) => s.canvasScale)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)
  const canvasSelectionIds = useProjectStore((s) => s.canvasSelectionIds)
  const toggleCanvasSelection = useProjectStore((s) => s.toggleCanvasSelection)
  const selectedTool = useProjectStore((s) => s.selectedTool)
  const promptGenImageIds = useProjectStore((s) => s.promptGenImageIds)
  const togglePromptGenImageId = useProjectStore((s) => s.togglePromptGenImageId)

  const isPromptGenPickMode = selectedTool === 'prompt-gen'
  const selected = selectedImageId === image.id
  /** Asset fetch from GitHub failed (does not persist to canvas.json). */
  const [assetFetchFailed, setAssetFetchFailed] = useState(false)

  useEffect(() => {
    console.log(`[image/load] mount image=${image.id} src=${image.src}`)

    if (image.src === 'pending') {
      return
    }

    if (!projectId) {
      console.warn('[image/load] error →', { details: 'missing currentProjectId' })
      return
    }

    const cached = useProjectStore.getState().imageObjectUrls.get(image.id)
    if (cached) {
      console.log(`[image/load] cache hit objectURL for id=${image.id}`)
      return
    }

    if (image.isLoading) {
      console.log(`[image/load] skip fetch id=${image.id} — isLoading (upload in progress)`)
      return
    }

    if (image.uploadError) {
      console.log(`[image/load] skip fetch id=${image.id} — uploadError present`, image.uploadError)
      return
    }

    const filename = parseFilenameFromSrc(image.src)
    if (!filename) {
      console.warn('[image/load] error →', { details: 'empty filename from src', src: image.src })
      return
    }

    console.log(`[image/load] fetching projectId=${projectId} filename=${filename}`)

    let cancelled = false

    void (async () => {
      try {
        const blob = await github.fetchAsset(projectId, filename)
        if (cancelled) return
        console.log(
          `[image/load] fetched blob size=${blob.size} type=${blob.type || 'application/octet-stream'}`,
        )
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        useProjectStore.getState().registerImageObjectUrl(image.id, url)
        console.log(`[image/load] objectURL created for id=${image.id}`)
        setAssetFetchFailed(false)
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e)
        console.error(`[image/load] error →`, { details, projectId, filename, imageId: image.id })
        if (!cancelled) setAssetFetchFailed(true)
      }
    })()

    return () => {
      cancelled = true
      useProjectStore.getState().revokeImageObjectUrl(image.id)
      console.log(`[image/load] cleanup id=${image.id} (revoke if URL was registered)`)
    }
    /* Identity deps only — omit isLoading/uploadError/objectUrl: effect must not re-run after
       upload completes or cleanup would revoke the URL registerImageObjectUrl just set. */

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, image.id, image.src])

  const displayUrl: string | undefined = objectUrl

  const showAssetLoading =
    !image.isLoading && !image.uploadError && !displayUrl && !assetFetchFailed

  const refSelectable =
    !image.isLoading &&
    image.src !== 'pending' &&
    !image.uploadError &&
    Boolean(displayUrl)

  const inRefSelection = canvasSelectionIds.includes(image.id)
  const inPromptGenPick = promptGenImageIds.includes(image.id)

  /** Map screen-constant UI (toolbar, outline, placeholders) through canvas zoom. */
  const invCanvas = 1 / canvasScale
  const outlineBorderPx = invCanvas
  const cornerDotPx = 4 * invCanvas

  return (
    <Rnd
      scale={canvasScale}
      cancel=".no-rnd-drag"
      disableDragging={isCanvasSelectionMode || isPromptGenPickMode}
      enableResizing={false}
      size={{ width: image.size.w, height: image.size.h }}
      position={{ x: image.position.x, y: image.position.y }}
      className="!pointer-events-auto"
      style={{
        zIndex:
          (isCanvasSelectionMode && inRefSelection) || (isPromptGenPickMode && inPromptGenPick)
            ? 25
            : selected && !isCanvasSelectionMode && !isPromptGenPickMode
              ? 20
              : 2,
      }}
      onDragStop={(_e, d) => {
        document.body.style.cursor = ''
        if (!projectId) return
        updateImagePosition(image.id, { x: d.x, y: d.y })
        schedulePersistCanvas(projectId, 500)
      }}
      onDragStart={() => {
        document.body.style.cursor = 'grabbing'
      }}
      onDrag={() => {
        document.body.style.cursor = 'grabbing'
      }}
    >
      <div data-image-item className="relative h-full w-full">
        {selected && !isCanvasSelectionMode && !isPromptGenPickMode ? (
          <>
            <div
              className="pointer-events-none absolute inset-0 z-10"
              style={{
                boxShadow: `inset 0 0 0 ${outlineBorderPx}px rgb(163 163 163)`,
              }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute z-20 rounded-full bg-neutral-900"
              style={{
                left: -cornerDotPx / 2,
                top: -cornerDotPx / 2,
                width: cornerDotPx,
                height: cornerDotPx,
              }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute z-20 rounded-full bg-neutral-900"
              style={{
                right: -cornerDotPx / 2,
                top: -cornerDotPx / 2,
                width: cornerDotPx,
                height: cornerDotPx,
              }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute z-20 rounded-full bg-neutral-900"
              style={{
                left: -cornerDotPx / 2,
                bottom: -cornerDotPx / 2,
                width: cornerDotPx,
                height: cornerDotPx,
              }}
              aria-hidden
            />
            <span
              className="pointer-events-none absolute z-20 rounded-full bg-neutral-900"
              style={{
                right: -cornerDotPx / 2,
                bottom: -cornerDotPx / 2,
                width: cornerDotPx,
                height: cornerDotPx,
              }}
              aria-hidden
            />
          </>
        ) : null}

        {selected &&
        !image.isLoading &&
        !image.uploadError &&
        !isCanvasSelectionMode &&
        !isPromptGenPickMode ? (
          <div
            className="pointer-events-auto absolute right-1 top-1 z-[35] origin-top-right"
            style={{ transform: `scale(${invCanvas})` }}
          >
            <ImageToolbar image={image} displayUrl={displayUrl} />
          </div>
        ) : null}

        <div
          className={`relative h-full w-full overflow-hidden bg-neutral-100 shadow-sm ${
            image.uploadError ? 'ring-2 ring-red-500' : ''
          } ${
            (isCanvasSelectionMode || isPromptGenPickMode) && refSelectable
              ? `cursor-pointer ring-inset ${
                  (isCanvasSelectionMode && inRefSelection) ||
                  (isPromptGenPickMode && inPromptGenPick)
                    ? 'ring-2 ring-neutral-900'
                    : 'ring-2 ring-transparent hover:ring-neutral-400'
                }`
              : ''
          }`}
          onMouseDown={(e) => {
            if (isCanvasSelectionMode) {
              if (refSelectable) {
                e.stopPropagation()
                toggleCanvasSelection(image.id)
              }
              return
            }
            if (isPromptGenPickMode) {
              if (refSelectable) {
                e.stopPropagation()
                togglePromptGenImageId(image.id)
              }
              return
            }
            setSelectedImage(image.id)
          }}
        >
          {isCanvasSelectionMode && refSelectable && inRefSelection ? (
            <span
              className="pointer-events-none absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-900 text-[10px] leading-none text-white shadow"
              aria-hidden
            >
              ✓
            </span>
          ) : null}
          {isPromptGenPickMode && refSelectable && inPromptGenPick ? (
            <span
              className="pointer-events-none absolute right-1 top-1 z-20 flex h-5 w-5 items-center justify-center rounded-sm bg-neutral-900 text-[10px] leading-none text-white shadow"
              aria-hidden
            >
              ✓
            </span>
          ) : null}
          {image.isLoading ? (
            image.source === 'generated' ? (
              <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 px-2">
                {image.cancelable ? (
                  <div
                    className="absolute right-1 top-1 z-10 origin-top-right"
                    style={{ transform: `scale(${invCanvas})` }}
                  >
                    <button
                      type="button"
                      className="no-rnd-drag flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800/90 text-xs text-white hover:bg-neutral-900"
                      title="取消生成"
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelImageGeneration(image.id)
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                <div
                  className="flex w-full max-w-full flex-col items-center justify-center"
                  style={{ transform: `scale(${invCanvas})`, transformOrigin: 'center center' }}
                >
                  <InlineSpinner />
                  <span className="mt-2 max-w-full truncate px-2 text-center font-mono text-[10px] text-neutral-700">
                    {truncatePrompt(image.metadata.prompt ?? '生成中…', 20)}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 px-2">
                <div
                  className="flex max-w-full flex-col items-center justify-center"
                  style={{ transform: `scale(${invCanvas})`, transformOrigin: 'center center' }}
                >
                  <InlineSpinner />
                  <span className="mt-2 max-w-full truncate px-1 text-center font-mono text-[10px] text-neutral-600">
                    {image.metadata.originalFilename ?? '上传中…'}
                  </span>
                </div>
              </div>
            )
          ) : image.uploadError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-100 px-2 text-center">
              <p className="font-mono text-[10px] leading-snug text-red-700">{image.uploadError}</p>
              <button
                type="button"
                className="no-rnd-drag rounded border border-neutral-900 bg-neutral-900 px-2 py-1 font-mono text-[10px] text-white hover:bg-neutral-800"
                onClick={(e) => {
                  e.stopPropagation()
                  if (image.source === 'generated') void retryCanvasImageGeneration(image.id)
                  else void retryImageUpload(image.id)
                }}
              >
                重试
              </button>
            </div>
          ) : showAssetLoading ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 px-2">
              <div
                className="flex max-w-full flex-col items-center justify-center"
                style={{ transform: `scale(${invCanvas})`, transformOrigin: 'center center' }}
              >
                <InlineSpinner />
                <span className="mt-2 max-w-full truncate px-1 text-center font-mono text-[10px] text-neutral-600">
                  {image.metadata.originalFilename ?? '加载图片…'}
                </span>
              </div>
            </div>
          ) : assetFetchFailed || !displayUrl ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-200 text-neutral-500">
              <span className="text-2xl" aria-hidden>
                🖼️
              </span>
              <span className="font-mono text-[10px]">加载失败</span>
            </div>
          ) : (
            <img
              key={displayUrl}
              src={displayUrl}
              alt={image.metadata.originalFilename ?? ''}
              draggable={false}
              className="h-full w-full select-none object-contain"
              onError={() => {
                console.warn('[image/load] <img> onError', { id: image.id, src: displayUrl })
                setAssetFetchFailed(true)
              }}
            />
          )}
        </div>
      </div>
    </Rnd>
  )
}
