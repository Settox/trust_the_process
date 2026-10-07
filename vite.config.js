import { defineConfig } from 'vite';
import { copyFileSync, existsSync, mkdirSync, cpSync } from 'fs';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [
    {
      name: 'copy-static-assets',
      writeBundle() {
        // Copy supabase-config.js
        if (existsSync('supabase-config.js')) {
          copyFileSync('supabase-config.js', 'dist/supabase-config.js');
        }
        if (existsSync('supabase-config.example.js')) {
          copyFileSync('supabase-config.example.js', 'dist/supabase-config.example.js');
        }
        if (existsSync('.nojekyll')) {
          copyFileSync('.nojekyll', 'dist/.nojekyll');
        }
        // Copy sfx folder
        if (existsSync('sfx')) {
          if (!existsSync('dist/sfx')) mkdirSync('dist/sfx');
          cpSync('sfx', 'dist/sfx', { recursive: true });
        }
      }
    }
  ],
  base: './',
  optimizeDeps: {
    include: ['@supabase/supabase-js']
  }
});