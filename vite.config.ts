import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/**
 * `base` is the path the built assets are served from.
 *
 * Local dev and most hosts serve from the domain root, so '/' is the default.
 * GitHub Pages project sites serve from '/<repo-name>/', which the deploy
 * workflow passes in via VITE_BASE_PATH. Hardcoding the repo name here would
 * break `npm run dev` and any future move to a custom domain.
 */
export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
