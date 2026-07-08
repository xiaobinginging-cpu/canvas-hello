import { memo, useEffect, useState } from 'react'
import { VideoOff } from 'lucide-react'
import { Rnd } from 'react-rnd'
import * as github from '../../lib/github.ts'
import { cancelVideoGeneration } from '../../lib/canvasGeneration.ts'
import { parseFilenameFromSrc } from '../../lib/canvasUpload.ts'
import { schedulePersistCanvas } from '../../lib/canvasPersist.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { VideoItem as CanvasVideo } from '../../types/project.ts'
import InlineSpinner from '../shared/InlineSpinner.tsx'
import VideoToolbar from './VideoToolbar.tsx'

function truncatePrompt(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}

function VideoItem({ video }: { video: CanvasVideo }) {
  const projectId = useProjectStore((s) => s.currentProjectId)
  const selectedVideoId = useProjectStore((s) => s.selectedVideoId)
  const objectUrl = useProjectStore((s) => s.videoObjectUrls.get(video.id))
  const updateVideoBounds = useProjectStore((s) => s.updateVideoBounds)
  const setSelectedVideo = useProjectStore((s) => s.setSelectedVideo)
  const canvasScale = useProjectStore((s) => s.canvasScale)
  const isCanvasSelectionMode = useProjectStore((s) => s.isCanvasSelectionMode)

  const selected = selectedVideoId === video.id
  const [assetFetchFailed, setAssetFetchFailed] = useState(false)

  useEffect(() => {
    console.log(`[video/load] mount video=${video.id} src=${video.src}`)

    if (video.src === 'pending') {
      return
    }

    if (!projectId) {
      console.warn('[video/load] error →', { details: 'missing currentProjectId' })
      return
    }

    const cached = useProjectStore.getState().videoObjectUrls.get(video.id)
    if (cached) {
      console.log(`[video/load] cache hit objectURL for id=${video.id}`)
      return
    }

    if (video.isLoading) {
      console.log(`[video/load] skip fetch id=${video.id} — isLoading`)
      return
    }

    if (video.uploadError) {
      console.log(`[video/load] skip fetch id=${video.id} — uploadError`, video.uploadError)
      return
    }

    const filename = parseFilenameFromSrc(video.src)
    if (!filename) {
      console.warn('[video/load] error →', { details: 'empty filename', src: video.src })
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const blob = await github.fetchAsset(projectId, filename)
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        useProjectStore.getState().registerVideoObjectUrl(video.id, url)
        setAssetFetchFailed(false)
      } catch (e) {
        const details = e instanceof Error ? e.message : String(e)
        console.error(`[video/load] error →`, details)
        if (!cancelled) setAssetFetchFailed(true)
      }
    })()

    return () => {
      cancelled = true
      // unmount 不 revoke——视口剔除会反复 mount/unmount；由 store 的 removeVideo/切项目统一回收
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, video.id, video.src])

  const displayUrl: string | undefined = objectUrl

  const showAssetLoading =
    !video.isLoading && !video.uploadError && !displayUrl && !assetFetchFailed

  const invCanvas = 1 / canvasScale
  const outlineBorderPx = invCanvas
  const cornerDotPx = 4 * invCanvas

  return (
    <Rnd
      scale={canvasScale}
      cancel=".no-rnd-drag"
      disableDragging={isCanvasSelectionMode}
      enableResizing={!isCanvasSelectionMode}
      minWidth={120}
      minHeight={68}
      size={{ width: video.width, height: video.height }}
      position={{ x: video.x, y: video.y }}
      className="!pointer-events-auto"
      style={{
        zIndex: selected && !isCanvasSelectionMode ? 21 : 3,
      }}
      onDragStop={(_e, d) => {
        document.body.style.cursor = ''
        if (!projectId) return
        updateVideoBounds(video.id, {
          x: d.x,
          y: d.y,
          width: video.width,
          height: video.height,
        })
        schedulePersistCanvas(projectId, 500)
      }}
      /* 拖拽/缩放期间不回写 store——逐帧 set() 会让整棵 Canvas 树重渲染（对齐 TextCardItem 的写法），松手时一次性提交 */
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        if (!projectId) return
        updateVideoBounds(video.id, {
          x: position.x,
          y: position.y,
          width: parseFloat(ref.style.width),
          height: parseFloat(ref.style.height),
        })
        schedulePersistCanvas(projectId, 500)
      }}
      onDragStart={() => {
        document.body.style.cursor = 'grabbing'
      }}
    >
      <div
        data-video-item
        className="relative h-full w-full"
        style={selected && !isCanvasSelectionMode ? { willChange: 'transform' } : undefined}
      >
        {selected && !isCanvasSelectionMode ? (
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

        {selected && !video.isLoading && !video.uploadError && !isCanvasSelectionMode ? (
          <div
            className="pointer-events-auto absolute right-1 top-1 z-[35] origin-top-right"
            style={{ transform: `scale(${invCanvas})` }}
          >
            <VideoToolbar video={video} displayUrl={displayUrl} />
          </div>
        ) : null}

        <div
          className={`relative h-full w-full overflow-hidden bg-neutral-100 shadow-sm ${
            video.uploadError ? 'ring-2 ring-red-500' : ''
          }`}
          onMouseDown={() => {
            if (isCanvasSelectionMode) return
            setSelectedVideo(video.id)
          }}
        >
          {video.isLoading ? (
            <div className="relative flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 px-2">
              {video.cancelable ? (
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
                      cancelVideoGeneration(video.id)
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
                  {truncatePrompt(video.prompt ?? '生成视频中…', 24)}
                </span>
              </div>
            </div>
          ) : video.uploadError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-neutral-100 px-2 text-center">
              <p className="font-mono text-[10px] leading-snug text-red-700">{video.uploadError}</p>
            </div>
          ) : showAssetLoading ? (
            <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-neutral-200 via-neutral-100 to-neutral-300 px-2">
              <div
                className="flex max-w-full flex-col items-center justify-center"
                style={{ transform: `scale(${invCanvas})`, transformOrigin: 'center center' }}
              >
                <InlineSpinner />
                <span className="mt-2 font-mono text-[10px] text-neutral-600">加载视频…</span>
              </div>
            </div>
          ) : assetFetchFailed || !displayUrl ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 bg-neutral-200 text-neutral-500">
              <VideoOff size={28} strokeWidth={1.5} aria-hidden />
              <span className="font-mono text-[10px]">加载失败</span>
            </div>
          ) : (
            <video
              key={displayUrl}
              src={displayUrl}
              controls
              preload="metadata"
              className="h-full w-full select-none bg-black object-contain"
            />
          )}
        </div>
      </div>
    </Rnd>
  )
}

export default memo(VideoItem)
