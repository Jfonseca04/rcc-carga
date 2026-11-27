import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "./",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "RCC Condición Corporal",
        short_name: "RCC Carga",
        description: "Carga de condición corporal de cerdas, offline",
        lang: "es",
        start_url: ".",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#1f6f4a",
        icons: [{ src: "icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      },
      workbox: { globPatterns: ["**/*.{js,css,html,svg}"] }
    })
  ],
  test: { environment: "node" }
} as any);
