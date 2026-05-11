import LogoLoading from './LogoLoading.tsx'

/** Full-viewport centered loading — same position for home ↔ canvas transitions */
export default function LogoViewportLoading({ label = '加载中…' }: { label?: string }) {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[40] flex items-center justify-center bg-[#FAF8F5]/85 font-mono text-sm text-neutral-500"
      aria-live="polite"
      role="status"
    >
      <LogoLoading size={40} label={label} announce={false} />
    </div>
  )
}
