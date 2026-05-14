/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** R2 public read URL (optional; GitHub-only mode when unset). */
  readonly VITE_R2_PUBLIC_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
