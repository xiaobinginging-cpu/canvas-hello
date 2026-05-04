import { useProjectStore } from '../../store/useStore.ts'

export default function ReferenceImageThumb({
  id,
  onRemove,
}: {
  id: string
  onRemove: () => void
}) {
  const url = useProjectStore((s) => s.imageObjectUrls.get(id))
  return (
    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-neutral-200 bg-neutral-100">
      {url ? <img src={url} alt="" className="h-full w-full object-cover" /> : null}
      <button
        type="button"
        className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white shadow"
        onClick={onRemove}
        title="移除"
      >
        ✕
      </button>
    </div>
  )
}
