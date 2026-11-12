// Copie supabase-js dans public/vendor/ (aucune dépendance externe au chargement du site).
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
const outDir = join(root, 'public', 'vendor');

if (!existsSync(src)) {
  console.error('supabase-js introuvable : lance d\'abord "npm install".');
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'supabase.js'));
console.log('supabase.js copié dans public/vendor/');
