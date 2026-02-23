// Force headless mode
process.env.HEADLESS = 'true';

// Start Electron
const { spawn } = require('child_process');
const path = require('path');

const electronExe = path.join(__dirname, 'node_modules', 'electron', 'dist', 'electron.exe');

console.log('Starting G.O.A.T in HEADLESS mode...');
console.log('This will run the API server WITHOUT the GUI window');

const electron = spawn(electronExe, ['.', '--headless'], {
  cwd: __dirname,
  env: { ...process.env, HEADLESS: 'true' },
  stdio: 'inherit',
  shell: true
});

electron.on('close', (code) => {
  console.log(`Electron process exited with code ${code}`);
  process.exit(code);
});
