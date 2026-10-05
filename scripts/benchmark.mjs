import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT } from './version.mjs';

const stamp = new Date().toISOString().replaceAll(':', '-');
const output = resolve(ROOT, 'benchmark-results', stamp);
await mkdir(output, { recursive: true });
execFileSync(process.execPath, [resolve(ROOT, 'scripts/build.mjs')], { stdio: 'inherit' });
const bundled = await build({ entryPoints: [resolve(ROOT, 'benchmark/application.jsx')], bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } });
const html = '<!doctype html><title>Senior Engineer @ Benchmark</title><style>body{font:16px system-ui;padding:24px;max-width:850px}label{display:block;margin:12px 0}fieldset{margin:16px 0}input,textarea,select,button{font:inherit;padding:8px}button[aria-pressed=true]{background:#85c695}</style><div id="root"></div><script src="/application.js"></script>';
const server = createServer((req, res) => {
  if (req.url === '/application.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(bundled.outputFiles[0].contents); }
  else { res.setHeader('Content-Type', 'text/html'); res.end(req.url === '/iframe' ? '<!doctype html><title>Application host</title><iframe src="/application" style="width:100%;height:1800px"></iframe>' : html); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const report = { startedAt: new Date().toISOString(), mode: 'real-extension-real-native-host-real-codex', scenarios: [] };
let context, panel, activePage;
try {
  const extension = resolve(ROOT, 'dist/extension');
  context = await chromium.launchPersistentContext(join(output, 'browser-profile'), { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  await context.tracing.start({ screenshots: true, snapshots: true });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).host;
  report.extensionId = extensionId;
  console.log(`Benchmark extension: ${extensionId}`);
  panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  await panel.locator('#contextRoot').fill(resolve(ROOT, 'benchmark'));
  for (const scenario of ['application', 'iframe']) {
    const page = await context.newPage();
    activePage = page;
    const started = Date.now();
    await page.goto(`${base}/${scenario}`);
    const frame = scenario === 'iframe' ? page.frames().find(f => f !== page.mainFrame()) : page.mainFrame();
    await frame.waitForSelector('#name');
    await page.bringToFront();
    await panel.locator('#load').evaluate(button => button.click());
    await panel.waitForFunction(() => !document.querySelector('#run').disabled || /Connection failed:/.test(document.querySelector('#status').textContent), null, { timeout: 150000 });
    if (await panel.locator('#run').isDisabled()) throw new Error(await panel.locator('#status').textContent());
    await panel.locator('#run').evaluate(button => button.click());
    await panel.waitForFunction(() => !document.querySelector('#stop').disabled || document.querySelector('#finalizer').open, null, { timeout: 10000 });
    await panel.waitForFunction(() => document.querySelector('#finalizer').open || (!document.querySelector('#run').disabled && document.querySelector('#stop').disabled), null, { timeout: 180000 });
    const expected = { name: 'Keep My Name', email: 'benchmark@example.test', linkedin: 'https://example.test/benchmark-profile', java: '3', split: '70% Backend / 30% Frontend', sponsorship: false, sources: ['Company Website', 'LinkedIn'], remote: true, country: 'Canada', languages: ['JavaScript', 'Python'], intro: 'I build reliable services and usable interfaces.', start: '2026-11-01', gender: 'Prefer not to say', preservedRadio: 'Keep this choice', preservedChecks: ['Keep this selection'] };
    const actual = await frame.evaluate(() => window.benchmarkState);
    const dom = await frame.evaluate(() => {
      const result = {};
      for (const key of ['name', 'email', 'linkedin', 'java', 'country', 'intro', 'start']) result[key] = document.getElementById(key)?.value ?? '';
      for (const key of ['split', 'gender', 'preservedRadio']) result[key] = document.querySelector(`input[name="${key}"]:checked`)?.value ?? '';
      for (const key of ['sources', 'preservedChecks']) result[key] = [...document.querySelectorAll(`#${key}-group input:checked`)].map(el => el.value);
      result.remote = document.getElementById('remote').checked;
      result.languages = [...document.getElementById('languages').selectedOptions].map(el => el.value);
      const choice = document.querySelector('.ashby-application-form-input-yesno button[aria-pressed="true"]')?.dataset.option;
      result.sponsorship = choice ? choice === 'yes' : null;
      return result;
    });
    const checks = Object.entries(expected).map(([field, value]) => ({ field, expected: value, actual: actual[field], passed: JSON.stringify(Array.isArray(value) ? [...value].sort() : value) === JSON.stringify(Array.isArray(actual[field]) ? [...actual[field]].sort() : actual[field]) }));
    for (const [field, value] of Object.entries(expected)) checks.push({ field: `DOM:${field}`, expected: value, actual: dom[field], passed: JSON.stringify(Array.isArray(value) ? [...value].sort() : value) === JSON.stringify(Array.isArray(dom[field]) ? [...dom[field]].sort() : dom[field]) });
    const submitted = await frame.evaluate(() => Boolean(window.benchmarkSubmitted));
    checks.push({ field: 'never-submitted', expected: false, actual: submitted, passed: !submitted });
    const status = await panel.locator('#status').textContent();
    checks.push({ field: 'finalizer-complete', expected: 'Form complete', actual: status, passed: status.startsWith('Form complete') });
    const check = (field, expected, actual) => checks.push({ field, expected, actual, passed: JSON.stringify(expected) === JSON.stringify(actual) });
    check('panel-initial-count', '15 / 15', await panel.locator('#count').textContent());
    check('delayed-rejection-audited', true, (await panel.locator('#audit').textContent()).includes('retry-pending'));
    // Change React state after finalization, without clicking Rescan or sending worker messages.
    await frame.evaluate(() => window.benchmarkPatch({ sources: ['LinkedIn'], split: '' }));
    await panel.waitForFunction(() => document.querySelector('#count').textContent === '13 / 15', null, { timeout: 10000 });
    check('panel-live-count-after-reset', '13 / 15', await panel.locator('#count').textContent());
    check('stale-finalizer-closed', false, await panel.locator('#finalizer').evaluate(el => el.open));
    check('partial-checkbox-group-incomplete', true, (await panel.locator('#questions li').filter({ hasText: 'Referral sources' }).textContent()).includes('Retry needed'));
    check('verification-loss-audited', true, (await panel.locator('#audit').textContent()).includes('verification-lost'));
    await frame.locator('input[name="split"][value="50/50 split"]').check();
    await frame.locator('#remote').uncheck();
    await panel.waitForFunction(() => [...document.querySelectorAll('#questions li')].some(el => el.textContent.includes('Available for remote work') && el.querySelector('.mark')?.textContent === '!'), null, { timeout: 10000 });
    check('user-radio-preserved-label', true, (await panel.locator('#questions li').filter({ hasText: 'Backend / Frontend split' }).textContent()).includes('User answer'));
    await panel.locator('#run').evaluate(button => button.click());
    await panel.waitForFunction(() => !document.querySelector('#stop').disabled, null, { timeout: 10000 });
    await panel.waitForFunction(() => document.querySelector('#finalizer').open, null, { timeout: 180000 });
    check('retry-restores-entire-checkbox-group', ['Company Website', 'LinkedIn'], await frame.evaluate(() => [...window.benchmarkState.sources].sort()));
    check('retry-preserves-user-radio', '50/50 split', await frame.evaluate(() => window.benchmarkState.split));
    check('retry-preserves-user-uncheck', false, await frame.evaluate(() => window.benchmarkState.remote));
    check('panel-final-count-with-user-blocker', '14 / 15', await panel.locator('#count').textContent());
    check('user-blocker-needs-attention', 'Needs attention', await panel.locator('#status').textContent());
    check('still-never-submitted', false, await frame.evaluate(() => Boolean(window.benchmarkSubmitted)));
    const result = { scenario, elapsedMs: Date.now() - started, checks, passed: checks.filter(check => check.passed).length, total: checks.length, status };
    report.scenarios.push(result);
    await page.screenshot({ path: join(output, `${scenario}.png`), fullPage: true });
    await panel.screenshot({ path: join(output, `${scenario}-panel.png`), fullPage: true });
    console.log(`${scenario}: ${result.passed}/${result.total} checks passed`);
    for (const failure of checks.filter(check => !check.passed)) console.log(JSON.stringify(failure));
    if (await panel.locator('#finalizer').evaluate(el => el.open)) await panel.locator('#closeFinal').click();
    await page.close();
  }
} catch (error) {
  report.error = error.message;
  console.error(error.message);
  if (panel) { report.panelStatus = await panel.locator('#status').textContent().catch(() => 'Panel unavailable'); await panel.screenshot({ path: join(output, 'failure-panel.png'), fullPage: true }).catch(() => {}); }
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: join(output, 'failure-page.png'), fullPage: true }).catch(() => {});
} finally {
  if (context) {
    if (panel) await writeFile(join(output, 'diagnostics.json'), JSON.stringify(await panel.evaluate(() => chrome.storage.local.get(['diagnostics-panel', 'diagnostics-extension'])).catch(() => ({})), null, 2));
    await context.tracing.stop({ path: join(output, 'trace.zip') }).catch(() => {});
    await context.close();
  }
  await new Promise(done => server.close(done));
  report.passed = !report.error && report.scenarios.length === 2 && report.scenarios.every(s => s.passed === s.total);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(resolve(ROOT, 'benchmark-results/latest.json'), JSON.stringify(report, null, 2));
  const markdown = [`# Job Form Agent benchmark`, ``, `Result: ${report.passed ? 'PASS' : 'FAIL'}`, ``, `Uses the real extension, native host and Codex with synthetic evidence. No application is submitted.`, ``, ...(report.error ? [`Error: ${report.error}`, ``] : []), ...report.scenarios.flatMap(s => [`## ${s.scenario}: ${s.passed}/${s.total}`, ``, '| Check | Expected | Actual | Result |', '| --- | --- | --- | --- |', ...s.checks.map(c => `| ${c.field} | ${JSON.stringify(c.expected)} | ${JSON.stringify(c.actual)} | ${c.passed ? 'PASS' : 'FAIL'} |`), ``])].join('\n');
  await writeFile(join(output, 'report.md'), markdown);
  console.log(`Report: ${join(output, 'report.json')}`);
  if (!report.passed) process.exitCode = 1;
}
