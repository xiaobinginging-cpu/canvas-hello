/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google AI / Generative Language API key (e.g. AI Studio). */
  readonly VITE_GOOGLE_API_KEY?: string
  /** Moonshot Kimi OpenAI-compatible API key (`https://api.moonshot.cn/v1`). */
  readonly VITE_KIMI_API_KEY?: string
  /** APIMart API key (`https://api.apimart.ai`). */
  readonly VITE_APIMART_API_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
