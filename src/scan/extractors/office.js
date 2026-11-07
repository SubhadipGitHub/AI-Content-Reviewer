// OOXML (docx/xlsx/pptx) and OpenDocument (odt/ods/odp) extraction.

import { decodeUtf8 } from '../../lib/bytes.js';
import { decodeEntities, analyzeProse } from './text.js';
import { checkFields } from '../detectors/metadata.js';
import { detectArtifacts } from '../detectors/text-artifacts.js';
import { finding } from '../findings.js';
import { SHEET_AI_FUNCTIONS } from '../rules.js';

const TEXT_CAP = 4 * 1024 * 1024;

function xmlFields(xml) {
  const out = {};
  for (const m of xml.matchAll(/<(?:[\w]+:)?(\w+)(?:\s[^>]*)?>([^<]{1,2000})<\/(?:[\w]+:)?\1>/g)) {
    out[m[1]] = decodeEntities(m[2].trim());
  }
  return out;
}

function customProps(xml) {
  const out = {};
  for (const m of xml.matchAll(/<property[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/property>/g)) {
    out[decodeEntities(m[1])] = decodeEntities(m[2].replace(/<[^>]+>/g, '').trim());
  }
  return out;
}

/** Visible text from WordprocessingML / DrawingML / SpreadsheetML. */
function wordText(xml) {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>|<\/w:p>|<\/a:p>/g, '\n')
      .replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, '')
      .replace(/<[^>]+>/g, ''),
  );
}

async function readText(zip, entry, cap = TEXT_CAP) {
  try { return decodeUtf8(await zip.read(entry, cap)); } catch { return ''; }
}

/**
 * @param {{entries: any[], read: Function}} zip
 * @param {'docx'|'xlsx'|'pptx'|'odf'} kind
 */
export async function scanOffice(zip, kind, onProgress) {
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const findings = [];
  const meta = { kind };
  const get = (n) => byName.get(n);

  // ---- Document properties
  if (kind === 'odf') {
    const m = get('meta.xml');
    if (m) {
      const xml = await readText(zip, m, 1 << 20);
      const f = xmlFields(xml);
      const props = { generator: f.generator, Author: f['initial-creator'] || f.creator, title: f.title, description: f.description, subject: f.subject };
      for (const u of xml.matchAll(/<meta:user-defined[^>]*meta:name="([^"]+)"[^>]*>([^<]*)</g)) props[u[1]] = u[2];
      meta.properties = Object.fromEntries(Object.entries(props).filter(([, v]) => v));
      findings.push(...checkFields(meta.properties, 'Document properties'));
    }
  } else {
    const props = {};
    const core = get('docProps/core.xml');
    const app = get('docProps/app.xml');
    const custom = get('docProps/custom.xml');
    if (core) { const f = xmlFields(await readText(zip, core, 1 << 20)); Object.assign(props, { Author: f.creator, lastModifiedBy: f.lastModifiedBy, title: f.title, subject: f.subject, description: f.description, keywords: f.keywords }); }
    if (app) { const f = xmlFields(await readText(zip, app, 1 << 20)); Object.assign(props, { Application: f.Application, AppVersion: f.AppVersion, Company: f.Company, Template: f.Template, Manager: f.Manager }); }
    meta.properties = Object.fromEntries(Object.entries(props).filter(([, v]) => v));
    findings.push(...checkFields(meta.properties, 'Document properties'));
    if (custom) {
      const cp = customProps(await readText(zip, custom, 1 << 20));
      meta.customProperties = cp;
      const aiKeys = Object.entries(cp).filter(([k, v]) => /\b(ai|genai|copilot|chatgpt|llm|gpt|generated)\b/i.test(k) || /\bai[- ]generated\b/i.test(v));
      if (aiKeys.length) {
        findings.push(finding({
          id: 'meta.custom-ai', category: 'metadata', strength: 'strong',
          title: 'Custom document property references AI',
          detail: aiKeys.map(([k, v]) => `${k} = ${v}`).join('\n').slice(0, 600),
          why: 'Organisations and tools add custom properties (for example Microsoft Purview AI labels) to mark AI-generated documents.',
          evidence: aiKeys.slice(0, 3).map(([k, v]) => ({ text: `${k} = ${v}` })),
          location: 'docProps/custom.xml',
        }));
      }
      findings.push(...checkFields(cp, 'Custom properties'));
    }
  }

  // ---- Body text
  const parts = [];
  const authors = new Set();
  const addAuthors = (xml) => { for (const m of xml.matchAll(/\bw:author="([^"]+)"|<(?:p:)?cmAuthor[^>]*name="([^"]+)"/g)) authors.add(decodeEntities(m[1] || m[2])); };
  let text = '';
  const names = zip.entries.map((e) => e.name);

  if (kind === 'docx') {
    const order = ['word/document.xml', ...names.filter((n) => /^word\/(header|footer|footnotes|endnotes|comments)\d*\.xml$/.test(n))];
    for (const n of order) {
      const e = get(n); if (!e) continue;
      const xml = await readText(zip, e);
      addAuthors(xml);
      parts.push(wordText(xml));
    }
    text = parts.join('\n');
  } else if (kind === 'pptx') {
    const slides = names.filter((n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n))
      .sort((a, b) => parseInt(a.match(/\d+/g).pop()) - parseInt(b.match(/\d+/g).pop()));
    for (const n of slides) parts.push(wordText(await readText(zip, get(n))));
    for (const n of names.filter((n) => /^ppt\/comment(Author)?s?/.test(n))) addAuthors(await readText(zip, get(n), 1 << 20));
    meta.slides = slides.filter((n) => n.includes('/slides/')).length;
    text = parts.join('\n\n');
  } else if (kind === 'xlsx') {
    const ss = get('xl/sharedStrings.xml');
    if (ss) {
      const xml = await readText(zip, ss);
      text = [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, ''))).join('\n');
    }
    const wb = get('xl/workbook.xml');
    if (wb) meta.sheets = [...(await readText(zip, wb, 1 << 20)).matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((m) => decodeEntities(m[1]));
    // Formulas
    const formulaHits = new Map();
    const ev = [];
    const sheets = names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
    let formulas = 0;
    for (const [i, n] of sheets.entries()) {
      onProgress?.(`Reading sheet ${i + 1}/${sheets.length}`);
      const xml = await readText(zip, get(n), 64 << 20);
      for (const m of xml.matchAll(/<c r="([A-Z]+\d+)"[^>]*>(?:(?!<\/c>)[\s\S])*?<f[^>]*>([^<]*)<\/f>/g)) {
        formulas++;
        const f = decodeEntities(m[2]);
        SHEET_AI_FUNCTIONS.lastIndex = 0;
        let fm;
        while ((fm = SHEET_AI_FUNCTIONS.exec(f))) {
          const fn = fm[1].toUpperCase();
          if (fn === 'AI' && !/_xlfn\.AI|=?\bAI\s*\(\s*"/i.test(f)) continue; // avoid user-defined names
          formulaHits.set(fn, (formulaHits.get(fn) || 0) + 1);
          if (ev.length < 4) ev.push({ text: `${meta.sheets?.[i] || `Sheet${i + 1}`}!${m[1]}: =${f.replace(/_xlfn\./g, '').slice(0, 200)}` });
        }
      }
      for (const m of xml.matchAll(/<is>([\s\S]*?)<\/is>/g)) text += '\n' + decodeEntities(m[1].replace(/<[^>]+>/g, ''));
    }
    meta.formulas = formulas;
    if (formulaHits.size) {
      findings.push(finding({
        id: 'formula.ai', category: 'formula', strength: 'strong',
        title: `AI functions used in formulas (${[...formulaHits.keys()].join(', ')})`,
        detail: [...formulaHits.entries()].map(([k, v]) => `${k}() × ${v}`).join('\n'),
        why: 'Excel\'s COPILOT() function and add-in functions such as GPT() or AI() call a language model to generate cell values. Cells computed by them are AI-generated content.',
        evidence: ev, location: 'Worksheet formulas',
      }));
    }
    for (const n of names.filter((n) => /^xl\/(comments\d*|threadedComments\/[^/]+)\.xml$/.test(n))) {
      const xml = await readText(zip, get(n), 4 << 20);
      text += '\n' + wordText(xml);
    }
    for (const n of names.filter((n) => /^xl\/persons\/person\.xml$/.test(n))) {
      for (const m of (await readText(zip, get(n), 1 << 20)).matchAll(/displayName="([^"]+)"/g)) authors.add(decodeEntities(m[1]));
    }
  } else if (kind === 'odf') {
    const c = get('content.xml');
    if (c) text = wordText((await readText(zip, c)).replace(/<\/text:(p|h)>/g, '\n'));
  }

  meta.words = (text.match(/\S+/g) || []).length;
  if (authors.size) meta.reviewers = [...authors].slice(0, 20);
  const aiAuthors = [...authors].filter((a) => /^\s*(?:microsoft )?copilot|chatgpt|gemini|claude|\bai assistant\b/i.test(a));
  if (aiAuthors.length) {
    findings.push(finding({
      id: 'meta.ai-reviewer', category: 'metadata', strength: 'strong',
      title: `Edits or comments attributed to ${aiAuthors.join(', ')}`,
      detail: 'Tracked changes or comments in this file are authored by an AI assistant.',
      why: 'When Copilot or another assistant edits with track changes on, or leaves comments, its name is recorded as the author.',
      evidence: aiAuthors.map((a) => ({ text: `author = ${a}` })), location: 'Comments / tracked changes',
    }));
  }
  findings.push(...analyzeProse(text, kind === 'xlsx' ? 'cell text' : kind === 'pptx' ? 'slides' : 'document body'));

  // Hyperlinks live in relationship files; AI-cited links carry utm_source=chatgpt.com.
  for (const n of names.filter((n) => /_rels\/[^/]+\.rels$/.test(n) && !n.startsWith('_rels/')).slice(0, 50)) {
    const rel = await readText(zip, get(n), 1 << 20);
    const links = [...rel.matchAll(/Target="(https?:[^"]+)"/g)].map((m) => decodeEntities(m[1])).join('\n');
    if (links) findings.push(...detectArtifacts(links, 'hyperlinks'));
  }

  // Embedded media to recurse into
  const media = zip.entries.filter((e) => /^(word|ppt|xl)\/media\/|^Pictures\//.test(e.name) && !e.dir);
  return { findings, meta, text, media };
}

