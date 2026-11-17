import { readFileSync } from 'node:fs';

const pages = [
  'index.html',
  'admin.html',
  'founder-announcements.html',
  'founder-dashboard.html',
];

let checked = 0;
let failed = 0;

for (const page of pages) {
  let html;
  try {
    html = readFileSync(page, 'utf8');
  } catch (error) {
    console.error('FAIL ' + page + ': could not read file (' + error.message + ')');
    failed++;
    continue;
  }

  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => match[2])
    .filter((content) => content.trim().length > 0);

  if (scripts.length === 0) {
    console.error('FAIL ' + page + ': no inline JavaScript blocks found');
    failed++;
    continue;
  }

  scripts.forEach((source, index) => {
    checked++;
    try {
      // Syntax compilation only. No browser globals or application code are executed.
      new Function(source);
      console.log('PASS ' + page + ' inline script #' + (index + 1));
    } catch (error) {
      failed++;
      console.error('FAIL ' + page + ' inline script #' + (index + 1) + ': ' + error.message);
    }
  });
}

console.log('\nChecked ' + checked + ' inline JavaScript block(s); ' + failed + ' failure(s).');
if (failed > 0) process.exitCode = 1;
