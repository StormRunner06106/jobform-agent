(() => {
  const revision = 4;
  if (globalThis.jobformScanner?.revision === revision) return;
  const documentKey = [...crypto.getRandomValues(new Uint8Array(16))].map(n => n.toString(16).padStart(2, '0')).join('');
  const ids = new WeakMap(), entries = new Map(), generated = new Map(), edited = new WeakSet(), applying = new WeakSet();
  let counter = 0;
  const idFor = el => { if (!ids.has(el)) ids.set(el, `${documentKey}:${++counter}`); return ids.get(el); };
  const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]');
  const text = el => (el?.textContent ?? '').trim().replace(/\s+/g, ' ');
  const labelText = node => { const copy = node.cloneNode(true); copy.querySelectorAll('input,select,textarea,button').forEach(el => el.remove()); return text(copy); };
  const label = el => [...(el.labels ?? [])].map(labelText).join(' ') || el.getAttribute('aria-label') || (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).map(id => text(document.getElementById(id))).join(' ').trim() || el.placeholder || el.name || 'Unlabelled question';
  const value = el => el.matches('button[aria-pressed]') ? el.getAttribute('aria-pressed') === 'true' : el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.tagName === 'SELECT' && el.multiple ? [...el.selectedOptions].map(o => o.value) : el.value;
  const signature = elements => JSON.stringify(elements.map(value));
  const trackEdit = e => { if (e.isTrusted && !applying.has(e.target)) edited.add(e.target); };
  document.addEventListener('input', trackEdit, true);
  document.addEventListener('change', trackEdit, true);
  document.addEventListener('click', e => { const button = e.target.closest('button[aria-pressed]'); if (button && e.isTrusted && !applying.has(button)) edited.add(button); }, true);
  const ashbyCustom = '.ashby-application-form-input-yesno,.ashby-application-form-input-checkbox-group';
  const interactive = el => visible(el) || ((el.type === 'checkbox' || el.type === 'radio') && [...(el.labels ?? [])].some(visible));
  const controls = root => [...root.querySelectorAll(`input,textarea,select,[role="combobox"],${ashbyCustom}`)].filter(el =>
    visible(el) && !el.disabled && !el.readOnly && !el.closest('.ashby-application-form-autofill-uploader') &&
    !el.parentElement?.closest(ashbyCustom) && !['hidden', 'submit', 'button', 'reset', 'password', 'image'].includes(el.type));
  function regions() {
    // Ashby renders sections, optional demographic questions and Submit as siblings in a tab panel.
    const ashby = [...document.querySelectorAll('.ashby-application-form-container')].map(root => root.closest('[role="tabpanel"]') ?? root);
    const candidates = [...new Set([...ashby, ...document.querySelectorAll('form,[role="form"]')])];
    let roots = candidates.filter(root => !candidates.some(other => other !== root && other.contains(root)) && controls(root).length);
    if (!roots.length && /job|apply|application/i.test(document.title + text(document.querySelector('h1')))) roots = [document.querySelector('main') ?? document.body].filter(r => controls(r).length >= 2);
    return roots.filter(r => !r.querySelector('input[type="password"]')).map(root => ({ id: idFor(root), title: ashby.includes(root) ? 'Application form' : text(root.querySelector('h1,h2,h3,legend')) || root.getAttribute('aria-label') || 'Application form', count: controls(root).length, root }));
  }
  function scan(regionId) {
    const candidates = regions();
    const region = candidates.find(r => r.id === regionId) ?? (candidates.length === 1 ? candidates[0] : null);
    const result = { documentKey, url: location.href, title: document.title, regions: candidates.map(({ root, ...r }) => r), questions: [], regionId: region?.id, hasFrames: document.querySelectorAll('iframe,frame').length };
    if (!region) return result;
    const list = controls(region.root), grouped = new Set();
    for (const el of list) {
      if (grouped.has(el)) continue;
      let elements = [el];
      const yesNo = el.matches('.ashby-application-form-input-yesno');
      const checkboxGroup = el.matches('.ashby-application-form-input-checkbox-group');
      if (yesNo) elements = [...el.querySelectorAll('button[data-option][aria-pressed]')];
      if (checkboxGroup) elements = [...el.querySelectorAll('input[type="checkbox"]')];
      if (!elements.length) continue;
      if (el.type === 'radio') elements = list.filter(other => other.type === 'radio' && other.name === el.name && (el.name || other === el));
      elements.forEach(e => grouped.add(e));
      const id = idFor(el);
      const custom = el.matches(ashbyCustom);
      const ashbyField = el.closest('.ashby-application-form-field-entry,fieldset');
      const ashbyTitle = ashbyField?.querySelector('.ashby-application-form-question-title');
      const groupLabel = text(el.closest('fieldset')?.querySelector('legend')) || text(ashbyTitle);
      const kind = yesNo ? 'one' : checkboxGroup ? 'many' : el.type === 'radio' || (el.tagName === 'SELECT' && !el.multiple) ? 'one' : el.tagName === 'SELECT' ? 'many' : el.type === 'checkbox' ? 'boolean' : el.type === 'file' ? 'upload' : el.getAttribute('role') === 'combobox' && el.tagName !== 'SELECT' ? 'unsupported' : 'text';
      const questionLabel = (custom ? text(ashbyTitle) || groupLabel : '') || (el.type === 'radio' ? groupLabel : '') || label(el);
      const helpNodes = (el.getAttribute('aria-describedby') ?? '').split(/\s+/).map(x => document.getElementById(x));
      const help = helpNodes.map(text).join(' ').slice(0, 1500);
      const required = elements.some(e => e.required || e.getAttribute('aria-required') === 'true') || Boolean(ashbyTitle && [...ashbyTitle.classList].some(name => name.startsWith('_required_')));
      const options = kind === 'one' || kind === 'many' ? (el.tagName === 'SELECT' ? [...el.options].map((o, i) => ({ id: `${id}:o${i}`, label: text(o), disabled: o.disabled || o.value === '', value: o.value })) : elements.map((o, i) => ({ id: `${id}:o${i}`, label: yesNo ? text(o) : label(o), disabled: o.disabled, value: yesNo ? o.dataset.option : o.value }))) : [];
      let filled = custom ? elements.some(e => value(e) === true) : kind === 'one' ? el.type === 'radio' ? elements.some(e => e.checked) : Boolean(el.value && !el.selectedOptions[0]?.disabled) : kind === 'many' ? [...el.selectedOptions].some(o => o.value && !o.disabled) : kind === 'boolean' ? el.checked : kind === 'upload' ? false : String(el.value ?? '').trim().length > 0;
      let minLength = el.minLength > 0 ? el.minLength : 0;
      const strictMinimum = help.match(/(?:more than|over)\s+([\d,]+)\s+characters/i);
      const minimum = help.match(/(?:at least|minimum(?: of)?)\s+([\d,]+)\s+characters/i);
      if (strictMinimum || minimum) minLength = Math.max(minLength, Number((strictMinimum ?? minimum)[1].replaceAll(',', '')) + (strictMinimum ? 1 : 0));
      const maxLength = el.maxLength > 0 ? el.maxLength : 0;
      const invalid = elements.some(e => e.validity && !e.validity.valid) || (kind === 'text' && filled && (String(el.value).length < minLength || (maxLength && String(el.value).length > maxLength))) || el.getAttribute('aria-invalid') === 'true';
      const uploadState = kind === 'upload' ? el.files?.length ? 'Selected — verify upload on the page' : 'Upload or verify existing attachment' : null;
      const manual = kind === 'upload' || kind === 'unsupported' || ((kind === 'boolean' || custom) && !filled && /agree|consent|certif|terms|attest/i.test(questionLabel));
      const last = generated.get(id);
      const userEdited = elements.some(e => edited.has(e));
      const owned = last !== undefined && !userEdited;
      const mismatch = owned && last !== signature(elements);
      const optionalUnchecked = kind === 'boolean' && !required && !filled;
      const state = manual ? 'needs-user' : mismatch ? 'pending' : optionalUnchecked ? 'optional' : filled && !invalid ? 'complete' : last !== undefined && userEdited ? 'needs-user' : filled && !owned ? 'prefilled-invalid' : 'pending';
      const completion = state === 'complete' ? owned ? 'Filled and verified on page' : userEdited ? 'User answer · preserved' : 'Already filled · preserved' : state === 'optional' ? 'Optional · unchecked' : '';
      const q = { id, kind, label: questionLabel.slice(0, 400), placeholder: el.placeholder ?? '', help, required, minLength, maxLength, min: el.min ?? '', max: el.max ?? '', pattern: el.pattern ?? '', options, state, completion, currentValue: kind === 'upload' ? uploadState : elements.map(value), feedback: mismatch ? 'The page did not retain the full answer. Retry needed.' : invalid ? (el.validationMessage || 'The page reports an invalid answer.') : last !== undefined && userEdited && state === 'needs-user' ? 'Changed by you · review on the page.' : '', uploadState };
      entries.set(id, { elements, snapshot: signature(elements), q, region: region.root });
      result.questions.push(q);
    }
    return result;
  }
  async function apply(results) {
    const outcomes = [];
    for (const answer of results) {
      const entry = entries.get(answer.id);
      if (!entry || answer.disposition !== 'fill') continue;
      const { elements, snapshot, q } = entry;
      if (!elements.every(el => el.isConnected && interactive(el) && !el.disabled) || signature(elements) !== snapshot || q.state !== 'pending' || (generated.has(q.id) && elements.some(el => edited.has(el)))) { outcomes.push({ id: q.id, state: 'preserved', reason: 'Field changed since scanning.' }); continue; }
      const el = elements[0];
      let expected;
      let dispatch = true;
      if (q.kind === 'text') {
        if (typeof answer.value !== 'string' || answer.value.length < q.minLength || (q.maxLength && answer.value.length > q.maxLength)) throw new Error('Invalid text answer.');
        const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, answer.value);
        expected = [answer.value];
      } else if (q.kind === 'boolean') {
        if (typeof answer.value !== 'boolean') throw new Error('Invalid checkbox answer.');
        if (el.checked !== answer.value) { applying.add(el); try { el.click(); } finally { applying.delete(el); } }
        expected = [answer.value]; dispatch = false;
      } else if (q.kind === 'one' || q.kind === 'many') {
        const selected = q.kind === 'many' ? answer.value : [answer.value];
        if (!Array.isArray(selected) || selected.some(id => !q.options.some(o => o.id === id && !o.disabled))) throw new Error('Invalid option answer.');
        if (q.kind === 'many' && q.required && !selected.length) throw new Error('Required choice group needs an answer.');
        if (el.tagName === 'SELECT') {
          [...el.options].forEach((o, i) => { o.selected = selected.includes(q.options[i].id); });
          const values = q.options.filter(o => selected.includes(o.id)).map(o => o.value);
          expected = [el.multiple ? values : values[0]];
        } else {
          expected = elements.map((o, i) => selected.includes(q.options[i].id));
          for (const [i, o] of elements.entries()) {
            applying.add(o);
            try {
              if (o.type === 'checkbox') { if (o.checked !== expected[i]) o.click(); }
              else if (expected[i] && value(o) !== true) o.click();
            } finally { applying.delete(o); }
          }
          dispatch = false;
        }
      } else continue;
      if (dispatch) for (const target of elements) { target.dispatchEvent(new Event('input', { bubbles: true })); target.dispatchEvent(new Event('change', { bubbles: true })); }
      generated.set(q.id, JSON.stringify(expected));
      // Allow controlled components and delayed validation to react before claiming success.
      await new Promise(resolve => setTimeout(resolve, 800));
      const retained = generated.get(q.id) === signature(elements) && elements.every(e => e.isConnected && (!e.validity || e.validity.valid));
      outcomes.push({ id: q.id, state: retained ? 'filled' : 'retry-pending', reason: retained ? 'Verified on page' : 'Page rejected or changed the value' });
    }
    return outcomes;
  }
  function finish(regionId) {
    const region = regions().find(r => r.id === regionId);
    if (!region) throw new Error('Form region changed.');
    const buttons = [...region.root.querySelectorAll('button,input[type="submit"]')].filter(e => visible(e) && !e.disabled);
    const submit = buttons.find(e => /submit|send application|apply now/i.test(text(e) || e.value));
    const next = buttons.find(e => /next|continue/i.test(text(e) || e.value));
    const target = submit ?? next;
    target?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' });
    return { target: submit ? 'submit' : next ? 'next' : 'unknown' };
  }
  globalThis.jobformScanner = { revision, scan, apply, finish };
})();
