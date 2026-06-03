import { useEffect, useState } from 'react'
import * as github from '../../lib/github.ts'
import type { LibraryMaterial } from '../../types/library.ts'

function filenameFromSrc(src: string): string {
  return src.split('/').filter(Boolean).pop() ?? ''
}

/**
 * 素材库缩略图：按需拉取 `_library/assets/…` blob → object URL，卸载时回收。
 * 与画布 ImageItem 一致的 hydrate 模式（避免依赖私有仓库 jsDelivr 公共读）。
 */
export default function LibraryThumb({
  material,
  className,
}: {
  material: LibraryMaterial
  className?: string
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let revoked = false
    let objectUrl: string | null = null
    void (async () => {
      try {
        const blob = await github.fetchLibraryAsset(filenameFromSrc(material.src))
        if (revoked) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch {
        if (!revoked) setFailed(true)
      }
    })()
    return () => {
      revoked = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [material.src])

  return (
    <div
      className={`flex items-center justify-center overflow-hidden bg-neutral-100 ${className ?? ''}`}
    >
      {url ? (
        <img src={url} alt={material.name ?? ''} className="h-full w-full object-cover" />
      ) : failed ? (
        <span className="font-mono text-[10px] text-neutral-400">加载失败</span>
      ) : (
        <span className="font-mono text-[10px] text-neutral-300">…</span>
      )}
    </div>
  )
}
