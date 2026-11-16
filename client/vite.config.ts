import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const socketProxy = {
  '/socket.io': { target: 'http://127.0.0.1:3000', ws: true },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] },
    proxy: socketProxy,
  },
  preview: { proxy: socketProxy },
})
