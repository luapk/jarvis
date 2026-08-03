import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Minimal Vite config. The serverless function under /api is handled by Vercel,
// not by Vite, so nothing extra is needed here.
export default defineConfig({
  plugins: [react()],
});
