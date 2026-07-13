/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MASSIVE_API_KEY?: string;
  readonly VITE_ALPHAVANTAGE_KEY?: string;
  readonly VITE_TWELVEDATA_KEY?: string;
  readonly VITE_YAHOO_PROXY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
