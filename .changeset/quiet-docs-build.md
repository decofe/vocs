---
"vocs": patch
---

Generate Markdown exports only after the client bundle is written, avoiding repeated work in server build passes and preserving exports after output cleanup. Reuse Git modification dates within each production build, with isolated caches for each configuration and fresh lookups in development and watch mode.
