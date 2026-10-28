import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'prompt',
    includeAssets: ['icon.svg','icon-192.png','icon-512.png'],
    manifest: { name: 'Sou Linda System', short_name: 'Sou Linda', description: 'Tu inventario, ventas y finanzas en equilibrio.', theme_color: '#8c3047', background_color: '#faf8f5', display: 'standalone', start_url: '/', scope:'/', lang: 'es-AR', shortcuts:[{name:'Abrir vista Ágil',short_name:'Vista Ágil',url:'/agil'},{name:'Nueva venta · Ágil',short_name:'Vender',url:'/agil?section=pos'}], icons: [{src:'/icon-192.png',sizes:'192x192',type:'image/png',purpose:'any'},{src:'/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any maskable'},{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}] },
    workbox: { globPatterns: ['**/*.{js,css,html,svg,png,woff2}'], maximumFileSizeToCacheInBytes: 4000000, navigateFallback: '/index.html', navigateFallbackDenylist:[/^\/api(?:\/|$)/,/^\/mobile(?:\/|$)/], cleanupOutdatedCaches: true },
  })],
  server:{proxy:{'/api':{target:'http://127.0.0.1:8765',changeOrigin:false}}},
  test: { environment: 'node', include: ['tests-web/**/*.test.ts'], fileParallelism: false },
});
