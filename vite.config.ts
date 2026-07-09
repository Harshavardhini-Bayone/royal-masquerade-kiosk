import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Standard Vite + React setup. Builds to /dist for Vercel.
export default defineConfig({
  plugins: [react()],
  server: { host: true },
});
