import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  envDir: 'src',
  plugins: [react()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3002",
    },
  },
})
