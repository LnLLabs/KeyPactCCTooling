/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BLOCKFROST_URL?: string
  readonly VITE_BLOCKFROST_PROJECT_ID?: string
  readonly VITE_RATIONALE_URL?: string
  readonly VITE_CONSTITUTION_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
