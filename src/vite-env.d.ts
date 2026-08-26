/// <reference types="vite/client" />

/** Build stamp injected at build time; compared against /build-info.json to detect stale clients. */
declare const __APP_BUILD_ID__: string;
