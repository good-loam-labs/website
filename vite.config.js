import { defineConfig } from 'vite';

// Relative base works for both a custom domain and https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
});
