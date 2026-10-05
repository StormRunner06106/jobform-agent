import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browser } from './browser.mjs';
import { ROOT } from '../scripts/version.mjs';

test('real Chrome scanner preserves answers, fills groups, verifies and never submits', async t => {
  const b = await browser(t); if (!b) return;
  await b.html(`<!doctype html><title>Job application</title><form onsubmit="window.submitted=true;return false">
    <label>Name<input id="name" value="Already entered" required></label>
    <label>Email<input id="email" type="email" required></label>
    <fieldset><legend>Location</legend><label><input name="location" type="radio" value="remote" required>Remote</label><label><input name="location" type="radio" value="office">Office</label></fieldset>
    <label>Team<select id="team" required><option value="">Select…</option><option value="engineering">Engineering</option></select></label>
    <label>Essay<textarea id="essay" aria-describedby="essay-help"></textarea></label><p id="essay-help">Must be more than 3000 characters.</p>
    <label>Resume<input type="file" required></label>
    <label><input type="checkbox">Optional updates</label>
    <label><input type="checkbox" checked required>I agree to the terms</label>
    <button type="submit">Submit application</button></form>`);
  await b.evaluate(await readFile(resolve(ROOT, 'extension/scanner.js'), 'utf8'));
  const first = await b.evaluate('jobformScanner.scan()');
  assert.equal(first.regions.length, 1);
  assert.equal(first.questions.find(q => q.label === 'Name').state, 'complete');
  assert.equal(first.questions.filter(q => q.label === 'Location').length, 1);
  assert.equal(first.questions.find(q => q.label === 'Essay').minLength, 3001);
  assert.equal(first.questions.find(q => q.kind === 'upload').state, 'needs-user');
  assert.equal(first.questions.find(q => q.label === 'Optional updates').state, 'complete');
  assert.equal(first.questions.find(q => q.label === 'I agree to the terms').state, 'complete');
  const email = first.questions.find(q => q.label === 'Email');
  const location = first.questions.find(q => q.label === 'Location');
  const team = first.questions.find(q => q.label === 'Team');
  const name = first.questions.find(q => q.label === 'Name');
  const answers = [
    { id: name.id, disposition: 'fill', value: 'Must not overwrite' },
    { id: email.id, disposition: 'fill', value: 'alex@example.test' },
    { id: location.id, disposition: 'fill', value: location.options[0].id },
    { id: team.id, disposition: 'fill', value: team.options[1].id },
  ];
  await b.evaluate(`jobformScanner.apply(${JSON.stringify(answers)})`);
  assert.equal(await b.evaluate('document.querySelector("#name").value'), 'Already entered');
  assert.equal(await b.evaluate('document.querySelector("#email").value'), 'alex@example.test');
  assert.equal(await b.evaluate('document.querySelector("input[name=location]:checked").value'), 'remote');
  assert.equal(await b.evaluate('document.querySelector("#team").value'), 'engineering');
  await b.evaluate(`jobformScanner.finish(${JSON.stringify(first.regionId)})`);
  assert.equal(await b.evaluate('Boolean(window.submitted)'), false);
  // Editing while the model is thinking must survive an old proposal.
  await b.evaluate('document.querySelector("#email").value=""; jobformScanner.scan(); document.querySelector("#email").value="user@example.test"');
  await b.evaluate(`jobformScanner.apply(${JSON.stringify([answers[1]])})`);
  assert.equal(await b.evaluate('document.querySelector("#email").value'), 'user@example.test');
});

test('Ashby div layouts include sibling sections and custom questions without treating resume autofill as a field', async t => {
  const b = await browser(t); if (!b) return;
  await b.html(`<!doctype html><title>Senior Engineer @ Example</title><h1>Senior Engineer</h1>
    <div role="tabpanel">
      <div class="ashby-application-form-autofill-uploader"><h2>Autofill from resume</h2><input type="file"></div>
      <div class="ashby-application-form-container">
        <div class="ashby-application-form-field-entry"><label for="full-name">Full Name</label><input id="full-name" value="Already entered" required></div>
        <label>Email<input type="email" required></label><label>Resume<input type="file" required></label>
        <fieldset><label class="ashby-application-form-question-title _required_fixture">Work preference</label><label><input type="radio" name="work" value="remote">Remote</label><label><input type="radio" name="work" value="office">Office</label></fieldset>
        <div class="ashby-application-form-field-entry"><label class="ashby-application-form-question-title _required_fixture">Sponsorship</label><div class="ashby-application-form-input-yesno"><button type="button" data-option="yes" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">Yes</button><button type="button" data-option="no" aria-pressed="false" onclick="this.setAttribute('aria-pressed','true')">No</button><input type="checkbox" style="display:none"></div></div>
        <fieldset class="ashby-application-form-input-checkbox-group"><label class="ashby-application-form-question-title _required_fixture">How did you hear about us?</label><label><input type="checkbox">Website</label><label><input type="checkbox">Referral</label></fieldset>
      </div>
      <section><fieldset><label class="ashby-application-form-question-title">Optional survey</label><label><input type="radio" name="survey" value="yes">Yes</label><label><input type="radio" name="survey" value="no">No</label></fieldset></section>
      <button onclick="window.submitted=true">Submit Application</button>
    </div>`);
  await b.evaluate('globalThis.jobformScanner = { scan: () => ({ regions: [], questions: [] }) }');
  await b.evaluate(await readFile(resolve(ROOT, 'extension/scanner.js'), 'utf8'));
  const result = await b.evaluate('jobformScanner.scan()');
  await b.evaluate(await readFile(resolve(ROOT, 'extension/scanner.js'), 'utf8'));
  assert.deepEqual((await b.evaluate('jobformScanner.scan()')).questions.map(q => q.id), result.questions.map(q => q.id));
  assert.equal(result.regions.length, 1);
  assert.equal(result.regions[0].title, 'Application form');
  assert.equal(result.questions.length, 7);
  assert.equal(result.questions.filter(q => q.kind === 'upload').length, 1);
  assert.equal(result.questions.find(q => q.label === 'Full Name').state, 'complete');
  const work = result.questions.find(q => q.label === 'Work preference');
  assert.equal(work.required, true);
  assert.deepEqual(work.options.map(option => option.label), ['Remote', 'Office']);
  for (const label of ['Sponsorship', 'How did you hear about us?']) {
    const question = result.questions.find(q => q.label === label);
    assert.equal(question.kind, label === 'Sponsorship' ? 'one' : 'many');
    assert.equal(question.state, 'pending');
    assert.equal(question.required, true);
  }
  const sponsorship = result.questions.find(q => q.label === 'Sponsorship');
  const referral = result.questions.find(q => q.label === 'How did you hear about us?');
  const answers = [{ id: sponsorship.id, disposition: 'fill', value: sponsorship.options[1].id }, { id: referral.id, disposition: 'fill', value: referral.options.map(o => o.id) }];
  const outcomes = await b.evaluate(`jobformScanner.apply(${JSON.stringify(answers)})`);
  assert.ok(outcomes.every(row => row.state === 'filled'));
  const after = await b.evaluate('jobformScanner.scan()');
  assert.equal(after.questions.find(q => q.id === sponsorship.id).state, 'complete');
  assert.equal(after.questions.find(q => q.id === referral.id).state, 'complete');
  assert.equal(result.questions.find(q => q.label === 'Optional survey').required, false);
  assert.equal((await b.evaluate(`jobformScanner.finish(${JSON.stringify(result.regionId)})`)).target, 'submit');
  assert.equal(await b.evaluate('Boolean(window.submitted)'), false);
});

test('side-panel UI renders in Chrome without console exceptions', async t => {
  const b = await browser(t); if (!b) return;
  const initial = { connected: false, contextReady: false, running: false, stage: 0, message: 'Choose your knowledge folder to get started.', questions: [], regions: [], audit: [], blockedFrames: 0, summary: null };
  await b.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.panelStored={settings:{contextRoot:'C:/Knowledge',codexPath:'C:/old/codex.exe'}};window.chrome={runtime:{id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',getManifest:()=>({version_name:'Development — unreleased'}),sendMessage:async message=>{window.lastPanelMessage=message;return {ok:true,result:${JSON.stringify(initial)}}},onMessage:{addListener(callback){window.onPanelState=callback}}},storage:{onChanged:{addListener(callback){window.onStorageChanged=callback}},local:{get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,window.panelStored[key]])),set:async value=>{Object.assign(window.panelStored,value);if(value.settings)window.savedPanelSettings=value.settings;window.onStorageChanged?.(value,'local')}}}};window.panelErrors=[];window.addEventListener('error',e=>panelErrors.push(e.message));window.addEventListener('unhandledrejection',e=>panelErrors.push(String(e.reason)));` });
  await b.call('Emulation.setDeviceMetricsOverride', { width: 420, height: 1050, deviceScaleFactor: 1, mobile: false });
  await b.call('Page.navigate', { url: pathToFileURL(resolve(ROOT, 'extension/panel.html')).href });
  for (let i = 0; i < 30; i++) {
    if (await b.evaluate('document.querySelector("#version")?.textContent.length > 0')) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.deepEqual(await b.evaluate('window.panelErrors'), []);
  assert.equal(await b.evaluate('document.querySelector("#run").disabled'), true);
  assert.equal(await b.evaluate('document.querySelectorAll("[data-stage]").length'), 4);
  assert.equal(await b.evaluate('document.querySelector("#codexPath")'), null);
  assert.equal(await b.evaluate('document.querySelector("#contextRoot").value'), 'C:/Knowledge');
  await b.evaluate('document.querySelector("#load").click()');
  assert.deepEqual(await b.evaluate('window.savedPanelSettings'), { contextRoot: 'C:/Knowledge' });
  assert.deepEqual(await b.evaluate('window.lastPanelMessage'), { type: 'load', settings: { contextRoot: 'C:/Knowledge' } });
  assert.deepEqual(await b.evaluate('window.panelErrors'), []);
  assert.equal(await b.evaluate('document.querySelector("#agentBadge").textContent'), 'Agent not connected yet');
  for (const [connectionStatus, badge] of [['connecting', 'Agent connecting…'], ['error', 'Connection failed'], ['connected', 'Agent healthy']]) {
    const state = { ...initial, connectionStatus, connected: connectionStatus === 'connected', message: 'Specific connection details' };
    await b.evaluate('window.onPanelState(' + JSON.stringify({ type: 'state', state }) + ')');
    assert.equal(await b.evaluate('document.querySelector("#agentBadge").textContent'), badge);
    assert.equal(await b.evaluate('document.querySelector("#load").disabled'), connectionStatus === 'connecting');
    assert.equal(await b.evaluate('document.querySelector("#status").textContent'), state.message);
  }
  await b.evaluate('window.onPanelState(' + JSON.stringify({ type: 'state', state: initial }) + ')');
  for (let i = 0; i < 30; i++) {
    if (await b.evaluate('document.querySelector("#diagnosticOutput").textContent.includes("ui.click")')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.match(await b.evaluate('document.querySelector("#diagnosticOutput").textContent'), /ui.click load/);
  assert.doesNotMatch(await b.evaluate('document.querySelector("#diagnosticOutput").textContent'), /C:\/Knowledge/);
  await mkdir(resolve(ROOT, 'dist'), { recursive: true });
  const screenshot = await b.call('Page.captureScreenshot', { format: 'png' });
  await writeFile(resolve(ROOT, 'dist/panel-preview.png'), Buffer.from(screenshot.data, 'base64'));
});
