import { defineConfig } from 'vite';

export default defineConfig({
  // 상대 경로: GitHub Pages 하위 경로(/dream-drive-simulator/)와 로컬 preview 모두에서 동작
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // 라이브러리는 거의 바뀌지 않으므로 따로 묶어 브라우저 캐시 재사용
        manualChunks: {
          three: ['three'],
          rapier: ['@dimforge/rapier3d-compat'],
        },
      },
    },
  },
});
