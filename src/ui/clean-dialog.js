// "Clean" dialog: choose what to remove, run it in the worker, verify with a re-scan,
// and download. Disclosure labels (tier B) stay locked until the user acknowledges the notice.

import { el, html, raw, $, $$ } from '../lib/dom.js';
import { icon } from './icons.js';
import { openModal } from './modal.js';
import { ring, pill, animateRings } from './render.js';
import { store, getResultFor, cleanFiles, saveCleaned, downloadBytes, saveSetting } from '../app/store.js';
import { planFor } from '../clean/catalog.js';
import { writeZip } from '../lib/zipwrite.js';
import { toast } from './toast.js';
import { plural } from '../lib/format.js';

export const LEGAL_NOTICE = [
  'These labels exist to tell people that content was made or edited with AI.',
  'Removing them can break the law or platform rules: China\'s labelling rules (GB 45438-2025) prohibit deleting AIGC labels, the EU AI Act requires deepfakes to be disclosed, and many schools, publishers and platforms require AI use to be declared.',
  'Only remove them from your own content, where you have the right to do so, and never to mislead people about how it was made. You are responsible for how the cleaned files are used.',
];

function checklist(plan, ack) {
  const A = plan.items.filter((i) => i.tier === 'A');
  const B = plan.items.filter((i) => i.tier === 'B');
  const row = (i, checked, disabled = false) => html`<label class="ck${disabled ? ' locked' : ''}">
    <input type="checkbox" name="item" value="${i.key}" ${checked ? raw('checked') : ''} ${disabled ? raw('disabled') : ''}>
    <span class="ck-box">${raw(icon('check'))}</span>
    <span class="ck-text"><b>${i.label}</b><small>${i.hint}</small></span>
    ${i.count ? html`<span class="count-badge">${i.count}</span>` : html`<span class="ck-opt">optional</span>`}
  </label>`;
  return html`
    ${A.length ? html`<section class="clean-sec"><div class="group-title">${raw(icon('sparkles'))}Clean-up</div>${A.map((i) => row(i, !i.optional))}</section>` : ''}
    ${B.length ? html`<section class="clean-sec tier-b" data-ack="${ack}">
      <div class="group-title">${raw(icon('shield-alert'))}Disclosure labels</div>
      ${ack ? B.map((i) => row(i, true)) : html`
        <div class="lock-card">
          <div class="row" style="align-items:flex-start;gap:12px">${raw(icon('lock'))}<div>
            <b>${plural(B.length, 'label type')} found: ${B.map((i) => i.label).join(', ')}</b>
            <p class="muted">These tell viewers the content is AI-made. Unlock only for your own content.</p>
          </div></div>
          <button class="btn btn-sm" data-unlock>${raw(icon('lock'))}Unlock label removal…</button>
        </div>`}
    </section>` : ''}`;
}

function extras(plan) {
  return html`
    ${plan.notes.map((n) => html`<div class="notice" data-tone="info">${raw(icon('info'))}<span>${n}</span></div>`)}
    ${plan.manual.length || plan.unremovable.length ? html`<details class="why clean-more"><summary>${raw(icon('chevron-right'))}Can't be removed automatically (${plan.manual.length + plan.unremovable.length})</summary>
      ${plan.manual.length ? html`<p class="muted" style="margin-top:8px">These phrases change the meaning of the text, so edit them yourself:</p><ul class="clean-list">${plan.manual.map((m) => html`<li><b>${m.label}</b> — “${m.text}”<small>${m.where}</small></li>`)}</ul>` : ''}
      <ul class="clean-list">${plan.unremovable.map((u) => html`<li><b>${u.label}</b><small>${u.why}</small></li>`)}</ul>
    </details>` : ''}`;
}

function ackPanel() {
  return el(html`<div class="ack">
    <div class="row" style="gap:10px;align-items:flex-start">${raw(icon('alert-triangle'))}<div>
      <b>Before you remove AI disclosure labels</b>
      ${LEGAL_NOTICE.map((p) => html`<p>${p}</p>`)}
    </div></div>
    <label class="ck"><input type="checkbox" data-ackbox><span class="ck-box">${raw(icon('check'))}</span><span class="ck-text"><b>I understand and take responsibility</b><small>You can revoke this later in Guide → Settings.</small></span></label>
    <div class="row" style="justify-content:flex-end"><button class="btn btn-sm" data-ack-cancel>Cancel</button><button class="btn btn-sm btn-danger" data-ack-ok disabled>Unlock</button></div>
  </div>`);
}

function resultView(results) {
  const ok = results.filter((r) => r.changed);
  const single = results.length === 1 ? results[0] : null;
  if (single?.error) return html`<div class="clean-done"><h2>Couldn't clean this file</h2><p class="muted">${single.error}</p></div>`;
  if (!ok.length) return html`<div class="clean-done"><h2>Nothing was changed</h2><p class="muted">None of the selected identifiers could be removed from ${results.length > 1 ? 'these files' : 'this file'}. ${results.flatMap((r) => r.report?.notes || []).slice(0, 2).join(' ')}</p></div>`;
  if (single) {
    const r = single;
    return html`<div class="clean-done">
      <div class="before-after">${ring(r.before.score, r.before.verdict, 'lg', 'before')}<span class="ba-arrow">${raw(icon('arrow-right'))}</span>${ring(r.after.score, r.after.verdict, 'lg', 'after')}</div>
      <div style="text-align:center">${pill(r.after.verdict)}<p class="muted" style="margin-top:6px">Saved as <b>${r.outName}</b></p></div>
      <ul class="clean-list ok">${r.report.removed.map((x) => html`<li>${raw(icon('check'))}<b>${x.label}</b><span class="count-badge">${x.count}</span></li>`)}</ul>
      ${r.after.left.length ? html`<div class="notice" data-tone="warning">${raw(icon('alert-triangle'))}<span><b>Still detected:</b> ${r.after.left.map((f) => f.title).join(' · ')}</span></div>` : ''}
      ${r.report.notes.map((n) => html`<div class="notice" data-tone="info">${raw(icon('info'))}<span>${n}</span></div>`)}
    </div>`;
  }
  return html`<div class="clean-done"><h2>${plural(ok.length, 'file')} cleaned</h2>
    <div class="ba-table">${results.map((r) => html`<div class="ba-row"><span class="r-name">${r.name}</span>${r.changed ? html`<span>${r.before.score} → <b>${r.after.score}</b></span>${pill(r.after.verdict, true)}` : html`<span class="muted">${r.error || 'unchanged'}</span>`}</div>`)}</div></div>`;
}

/** Open the clean dialog for one or more file ids. */
export async function openCleanDialog(ids) {
  const results = (await Promise.all(ids.map((id) => getResultFor(id)))).filter(Boolean);
  if (!results.length) return toast({ title: 'Nothing to clean', body: 'Scan results are not available for these files.', tone: 'info' });
  const plan = planFor(results);
  let ack = !!store.settings.labelRemovalAck;
  const content = el(html`<div class="clean">
    <div class="clean-head"><span class="dz-icon sm">${raw(icon('wand-2'))}</span><div><h2>Clean ${ids.length > 1 ? plural(ids.length, 'file') : `“${store.files.get(ids[0])?.name || results[0].name}”`}</h2><p class="muted">Choose what to remove. Originals are never changed; you get a cleaned copy.</p></div></div>
    <div class="clean-body"></div>
    <div class="clean-foot"><span class="muted" data-sel></span><div class="spacer"></div><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-go>${raw(icon('wand-2'))}Clean & download</button></div>
  </div>`);
  const body = $('.clean-body', content);
  const close = openModal(content, { label: 'Clean files' });
  const paint = () => {
    body.innerHTML = String(html`${plan.items.length ? checklist(plan, ack) : html`<div class="notice" data-tone="success">${raw(icon('circle-check-big'))}<span>No removable identifiers were found.</span></div>`}${extras(plan)}`);
    update();
  };
  const selected = () => $$('input[name="item"]:checked', body).map((x) => x.value);
  const update = () => {
    const n = selected().length;
    $('[data-sel]', content).textContent = n ? `${plural(n, 'item type')} selected` : 'Nothing selected';
    $('[data-go]', content).disabled = !n;
  };
  body.addEventListener('change', update);
  body.addEventListener('click', (e) => {
    if (!e.target.closest('[data-unlock]')) return;
    const panel = ackPanel();
    e.target.closest('.lock-card').replaceWith(panel);
    const box = $('[data-ackbox]', panel), okBtn = $('[data-ack-ok]', panel);
    box.addEventListener('change', () => { okBtn.disabled = !box.checked; });
    $('[data-ack-cancel]', panel).onclick = paint;
    okBtn.onclick = async () => { ack = true; await saveSetting('labelRemovalAck', true); paint(); };
  });
  $('[data-cancel]', content).onclick = () => close();
  $('[data-go]', content).onclick = async () => {
    const items = selected();
    const foot = $('.clean-foot', content);
    foot.innerHTML = '';
    body.innerHTML = String(html`<div class="clean-progress"><div class="progress indeterminate"><i></i></div><p class="muted" data-prog>Cleaning ${plural(ids.length, 'file')}…</p></div>`);
    const res = await cleanFiles(ids, items, (d, t) => { const p = $('[data-prog]', body); if (p) p.textContent = `Cleaned ${d} of ${t} — verifying with a fresh scan…`; });
    body.innerHTML = String(resultView(res));
    animateRings(body);
    const ok = res.filter((r) => r.changed);
    const download = async () => {
      if (ok.length === 1) downloadBytes(ok[0].bytes, ok[0].outName);
      else if (ok.length > 1) downloadBytes(await writeZip(ok.map((r) => ({ name: r.outName, data: r.bytes }))), 'cleaned-files.zip');
    };
    foot.innerHTML = String(html`${ok.length ? html`<button class="btn" data-save>${raw(icon('library'))}Save to Library</button><button class="btn" data-dl>${raw(icon('download'))}Download again</button>` : ''}<div class="spacer"></div><button class="btn btn-primary" data-done>Done</button>`);
    $('[data-done]', foot).onclick = () => close();
    $('[data-dl]', foot)?.addEventListener('click', download);
    $('[data-save]', foot)?.addEventListener('click', (e) => { saveCleaned(ok); e.currentTarget.disabled = true; e.currentTarget.textContent = 'Saved'; toast({ title: 'Cleaned copies added', body: 'They are being scanned and saved to your Library.', tone: 'success' }); });
    if (ok.length) download();
  };
  paint();
}
