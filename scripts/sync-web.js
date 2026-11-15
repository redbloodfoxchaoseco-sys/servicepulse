/* Copies the shared web UI (../app) into the Electron (../electron/app)
 * and Android (../android/www) build targets. Run from any directory. */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'app');
const targets = [
  path.join(root, 'electron', 'app'),
  path.join(root, 'android', 'www')
];

if (!fs.existsSync(source)) {
  console.error('Source folder not found:', source);
  process.exit(1);
}

for (const target of targets) {
  fs.rmSync(target, { recursive: true, force: true });
  fs.cpSync(source, target, { recursive: true });
  console.log('Synced', path.relative(root, source), '->', path.relative(root, target));
}
