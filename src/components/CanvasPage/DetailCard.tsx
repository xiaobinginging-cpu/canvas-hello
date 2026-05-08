import { Copy } from 'lucide-react'
import { useState } from 'react'
import { formatRelativeTimeZh } from '../../lib/formatRelativeTime.ts'
import { useProjectStore } from '../../store/useStore.ts'
import type { ImageMetadata } from '../../types/image.ts'

/** Detail-only: same lineage ids as persisted metadata (no canvas connectors). */
function detailParentSourceDisplay(meta: ImageMetadata): string | undefined {
  if (meta.parents?.length) return meta.parents.join(', ')
  const single = meta.parentImageId?.trim() || meta.parent?.trim()
  return single || undefined
}

export default function DetailCard() {
  const detailCardImageId = useProjectStore((s) => s.detailCardImageId)
  const closeDetailCard = useProjectStore((s) => s.closeDetailCard)
  const canvas = useProjectStore((s) => s.currentProjectCanvas)
  const imageObjectUrls = useProjectStore((s) => s.imageObjectUrls)

  const image = detailCardImageId
    ? canvas?.images.find((im) => im.id === detailCardImageId)
    : undefined

  const [copyDone, setCopyDone] = useState(false)

  if (!detailCardImageId || !image) return null

  const meta = image.metadata

  async function copyPrompt(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopyDone(true)
      window.setTimeout(() => setCopyDone(false), 2000)
    } catch {
      setCopyDone(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center bg-black/40 px-4 font-mono"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-card-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeDetailCard()
      }}
    >
      <div
        key={detailCardImageId}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded border border-neutral-200 bg-white p-6 text-left shadow-none"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="detail-card-title" className="text-lg font-medium text-neutral-900">
            图片详情
          </h2>
          <button
            type="button"
            title="关闭"
            className="rounded p-1 text-neutral-600 hover:bg-neutral-100"
            onClick={closeDetailCard}
          >
            ✕
          </button>
        </div>

        <p className="mb-4 text-xs text-neutral-500">
          来源：<span className="text-neutral-800">{image.source}</span>
        </p>

        {image.source === 'generated' ? (
          <div className="space-y-4 text-sm">
            {meta.prompt ? (
              <div>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-neutral-700">提示词</span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 hover:bg-neutral-50"
                    onClick={() => void copyPrompt(meta.prompt ?? '')}
                  >
                    <Copy size={14} aria-hidden />
                    {copyDone ? '已复制' : '复制'}
                  </button>
                </div>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-900">
                  {meta.prompt}
                </p>
              </div>
            ) : null}

            {meta.referenceImageIds && meta.referenceImageIds.length > 0 ? (
              <div>
                <p className="mb-2 text-xs font-medium text-neutral-700">图片参考</p>
                <div className="flex flex-wrap gap-2">
                  {meta.referenceImageIds.map((rid) => {
                    const thumb = imageObjectUrls.get(rid)
                    return (
                      <div
                        key={rid}
                        className="h-12 w-12 overflow-hidden rounded border border-neutral-200 bg-neutral-100"
                      >
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full items-center justify-center text-[10px] text-neutral-400">
                            …
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            <DetailRow label="基础模型" value={meta.model} />
            <DetailRow label="API" value={meta.api} />
            <DetailRow label="尺寸" value={meta.ratio} />
            <DetailRow label="分辨率" value={meta.resolution} />
            <DetailRow label="同款来源 (parent)" value={detailParentSourceDisplay(meta)} />
            <DetailRow
              label="生成时间"
              value={
                meta.generatedAt != null ? formatRelativeTimeZh(meta.generatedAt) : undefined
              }
            />
          </div>
        ) : image.source === 'upload' ? (
          <div className="space-y-4 text-sm">
            <DetailRow
              label="上传时间"
              value={
                meta.uploadedAt != null ? formatRelativeTimeZh(meta.uploadedAt) : undefined
              }
            />
            <DetailRow label="原文件名" value={meta.originalFilename} />
          </div>
        ) : (
          <div className="space-y-4 text-sm text-neutral-600">
            <p className="text-xs">reference 类型暂无额外字段。</p>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | undefined }) {
  if (value == null || value === '') return null
  return (
    <div>
      <p className="mb-0.5 text-xs font-medium text-neutral-700">{label}</p>
      <p className="text-xs text-neutral-900">{value}</p>
    </div>
  )
}
