import { main } from './driver.js';

try {
  const code = await main();
  process.exit(code);
} catch (err) {
  console.error('[worker crash]', err);
  process.exit(1);
}
