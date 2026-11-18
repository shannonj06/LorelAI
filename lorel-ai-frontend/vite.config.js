import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The API (api/, `npm start`) runs on :4000. Proxying keeps the browser on one
    // origin, so the httpOnly session cookie works exactly as it does in production.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
})
