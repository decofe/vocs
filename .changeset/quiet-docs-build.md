---
"vocs": patch
---

Generate Markdown exports only after the client bundle is written, avoiding repeated work in server build passes and preserving exports after output cleanup. Reuse Git modification dates during production builds while keeping development lookups fresh.
