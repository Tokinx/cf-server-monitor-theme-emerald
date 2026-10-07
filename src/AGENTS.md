# Source Guide

- Use Vue 3 Composition API with `<script setup lang="ts">`.
- `App.vue` owns the shell and calls `initApp()` / `destroyInitManager()`.
- Hash routes are `/` and `/server/:id`.
- `stores/app.ts` owns theme and UI preferences; `stores/nodes.ts` owns normalized node state.
- `utils/api.ts` is the CF Server Monitor HTTP and adaptation boundary.
- `utils/init.ts` owns startup, Turnstile, WebSocket and refresh lifecycle.
- `utils/rpc.ts` exists only as an adapter for chart code inherited from Emerald.
- Backend site switches (`sysConfig.show_price`, `show_three_net_details`) belong in the store and are consumed via computed getters — never read `sysConfig` from views or presentation components.
- Use existing reka-ui wrappers under `components/ui/` and Tailwind utilities.
- Use `publicAsset()` for public files so subpath deployments keep working.
- Do not add Cobe, Naive UI, UnoCSS, SCSS, or browser-history routing.
- Validate with `bun run lint` and `bun run build`.
