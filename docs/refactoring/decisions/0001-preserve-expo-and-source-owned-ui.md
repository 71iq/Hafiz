# ADR 0001. Preserve Expo and the existing shared UI

Status accepted for the stabilization workstream. Date 2026-10-15.

Hafiz already uses Expo Router, strict TypeScript, NativeWind, semantic themes, rn-primitives, Lucide, RHF/Zod, Zustand, SQLite and TanStack Query. Existing overlays own complex web/native focus, direction, scrolling and safe-area behavior.

Keep this implementation set and repair inconsistent use within it. Treat the existing shared source components as the native UI system. Do not add gluestack, Uniwind, another router or a second form/state package. A missing primitive can justify adding one compatible source component after checking current wrappers.

This avoids a broad visual and platform migration with no demonstrated benefit. It leaves some existing custom controls to improve, with behavior tests and rendered checks. Package patch alignment is separate from SDK-major migration. Reconsider only if a measured limitation cannot be addressed by extending the existing owner.
