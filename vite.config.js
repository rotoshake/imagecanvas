import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: {
    port: 5173,
    open: true,
    host: true, // This allows access from external devices
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
}); 