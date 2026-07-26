import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          chrome: resolve(__dirname, 'src/preload/chrome.ts'),
          content: resolve(__dirname, 'src/preload/content.ts'),
          'extension-compat': resolve(__dirname, 'src/preload/extension-compat.ts')
        }
      }
    }
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  }
});
