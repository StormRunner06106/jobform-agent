import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';

function Application() {
  const [data, setData] = useState({ name: 'Keep My Name', email: '', linkedin: '', java: '', split: '', sponsorship: null, sources: [], remote: false, country: '', languages: [], intro: '', start: '', gender: '', preservedRadio: 'Keep this choice', preservedChecks: ['Keep this selection'] });
  window.benchmarkState = data;
  const set = (key, value) => setData(old => ({ ...old, [key]: value }));
  const field = (key, title, type = 'text') => <div className="ashby-application-form-field-entry"><label className="ashby-application-form-question-title _required_fixture" htmlFor={key}>{title}</label><input id={key} name={key} type={type} required value={data[key]} onChange={e => set(key, e.target.value)} /></div>;
  const radios = (key, title, choices, required = true) => <fieldset id={`${key}-group`}><label className={`ashby-application-form-question-title ${required ? '_required_fixture' : ''}`}>{title}</label>{choices.map(choice => <label key={choice}><input type="radio" name={key} value={choice} required={required} checked={data[key] === choice} onChange={() => set(key, choice)} />{choice}</label>)}</fieldset>;
  const checks = (key, title, choices) => <fieldset id={`${key}-group`} className="ashby-application-form-input-checkbox-group"><label className="ashby-application-form-question-title _required_fixture">{title}</label>{choices.map(choice => <label key={choice}><span className="ashby-application-form-input-checkbox-group-option-checkbox"><input type="checkbox" name={choice} value={choice} checked={data[key].includes(choice)} onChange={e => set(key, e.target.checked ? [...data[key], choice] : data[key].filter(x => x !== choice))} /></span>{choice}</label>)}</fieldset>;
  return <div role="tabpanel">
    <h1>Senior Engineer</h1>
    <div className="ashby-application-form-autofill-uploader"><h2>Autofill from resume</h2><input type="file" /></div>
    <div className="ashby-application-form-container">
      {field('name', 'Full Name')}{field('email', 'Email', 'email')}{field('linkedin', 'LinkedIn URL', 'url')}{field('java', 'Java expertise from 1 to 5')}
      {radios('split', 'Backend / Frontend split', ['50/50 split', '70% Backend / 30% Frontend', '30% Backend / 70% Frontend'])}
      <div className="ashby-application-form-field-entry"><label className="ashby-application-form-question-title _required_fixture">Require sponsorship?</label><div className="ashby-application-form-input-yesno">{[['yes', true], ['no', false]].map(([key, val]) => <button key={key} type="button" data-option={key} aria-pressed={data.sponsorship === val} onClick={() => set('sponsorship', val)}>{key === 'yes' ? 'Yes' : 'No'}</button>)}<input type="checkbox" name="sponsorship" style={{ display: 'none' }} readOnly checked={data.sponsorship === true} /></div></div>
      {checks('sources', 'Referral sources', ['LinkedIn', 'Company Website', 'Other'])}
      <label><input id="remote" type="checkbox" required checked={data.remote} onChange={e => set('remote', e.target.checked)} />Available for remote work</label>
      <label>Country<select id="country" required value={data.country} onChange={e => set('country', e.target.value)}><option value="">Select…</option><option>Canada</option><option>Germany</option></select></label>
      <label>Programming languages<select id="languages" multiple required value={data.languages} onChange={e => set('languages', [...e.target.selectedOptions].map(o => o.value))}><option>JavaScript</option><option>Python</option><option>Rust</option></select></label>
      <label>Short introduction<textarea id="intro" required value={data.intro} onChange={e => set('intro', e.target.value)} /></label>
      {data.sponsorship === false && field('start', 'Earliest start date')}
      {radios('preservedRadio', 'Already selected radio', ['Keep this choice', 'Overwrite this choice'])}
      {checks('preservedChecks', 'Already selected checkboxes', ['Keep this selection', 'Overwrite this selection'])}
    </div>
    {radios('gender', 'Gender', ['Male', 'Female', 'Prefer not to say'], false)}
    <button id="submit" type="button" onClick={() => { window.benchmarkSubmitted = true; }}>Submit Application</button>
  </div>;
}
createRoot(document.getElementById('root')).render(<Application />);
