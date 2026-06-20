import { execFileSync } from 'node:child_process';

const minimum = [1, 95, 0];

function compare(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

try {
  const output = execFileSync('rustc', ['--version'], { encoding: 'utf8' }).trim();
  const match = output.match(/rustc\s+(\d+)\.(\d+)\.(\d+)/);
  if (!match) throw new Error(`Could not parse: ${output}`);

  const installed = match.slice(1, 4).map(Number);
  if (compare(installed, minimum) < 0) {
    console.error(`\nMegaClient requires Rust 1.95 or newer; found ${installed.join('.')}.`);
    console.error('Update with: rustup update stable');
    console.error('Then run:   rustup override unset  (only if an older directory override is active)\n');
    process.exit(1);
  }
} catch (error) {
  console.error('\nA supported Rust toolchain was not found.');
  console.error('Install or update Rust with rustup, then rerun this command.');
  console.error('Official installer: https://rustup.rs\n');
  if (process.env.MEGACLIENT_DEBUG_TOOLCHAIN === '1') console.error(error);
  process.exit(1);
}
