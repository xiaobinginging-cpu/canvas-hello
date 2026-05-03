import type { ReactNode } from 'react'

export default function ProjectGrid({ children }: { children: ReactNode }) {
  return (
    <div
      className="grid gap-4"
      style={{
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
      }}
    >
      {children}
    </div>
  )
}
