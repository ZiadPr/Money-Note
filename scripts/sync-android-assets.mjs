import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const androidAssetsDir = path.join(rootDir, 'android', 'app', 'src', 'main', 'assets', 'public');

if (!existsSync(distDir)) {
  throw new Error('dist/ does not exist. Run the web build first.');
}

rmSync(androidAssetsDir, { recursive: true, force: true });
mkdirSync(androidAssetsDir, { recursive: true });
cpSync(distDir, androidAssetsDir, { recursive: true });

console.log(`Synced web assets to ${androidAssetsDir}`);
