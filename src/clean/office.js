// DOCX / XLSX / PPTX / ODF cleaner: rewrites the package with cleaned XML parts.
import { decodeUtf8, encodeUtf8 } from '../lib/bytes.js';
import { writeZip } from '../lib/zipwrite.js';
import { SHEET_AI_FUNCTIONS } from '../scan/rules.js';
import { cleanText, manualPhrases, mergeCounts } from './text.js';
import { editXmp } from './meta.js';

const AI_NAME = /^\s*(?:microsoft\s+|github\s+)?(?:copilot|chatgpt|openai|gemini|google gemini|claude|anthropic|ai assistant|ai|meta ai|grok|perplexity)\s*$/i;
const AI_PROP = /\b(ai|genai|copilot|chatgpt|llm|gpt|generated)\b/i;
const TEXT_PART = /^(word\/(document|header\d*|footer\d*|footnotes|endnotes|comments\w*)\.xml|ppt\/(slides\/slide|notesSlides\/notesSlide|comments\/\w+)\d*\.xml|xl\/(sharedStrings|comments\d*|threadedComments\/[^/]+)\.xml|xl\/worksheets\/sheet\d+\.xml|content\.xml|styles\.xml)$/;
const AUTHOR_PART = /^(word\/(document|comments\w*|people)\.xml|ppt\/(commentAuthors|authors)\.xml|xl\/persons\/person\.xml|xl\/threadedComments\/[^/]+\.xml)$/;

function blankElement(xml, tag, test) {
  let n = 0;
  const re = new RegExp(`(<${tag}\\b[^>]*>)([^<]*)(</${tag}>)`, 'g');
  xml = xml.replace(re, (m, a, v, c) => { if (v && test(v)) { n++; return a + c; } return m; });
  return { xml, n };
}

function removeElement(xml, tag) {
  let n = 0;
  xml = xml.replace(new RegExp(`<${tag}\\b[^>]*/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g'), () => { n++; return ''; });
  return { xml, n };
}

/** Replace AI-function formulas with their cached values. */
function formulasToValues(xml) {
  let n = 0;
  xml = xml.replace(/(<c\b[^>]*>)(?:(?!<\/c>)[\s\S])*?<\/c>/g, (cell) => {
    const f = cell.match(/<f\b[^>]*>([^<]*)<\/f>|<f\b[^>]*\/>/);
    if (!f || !f[1]) return cell;
    SHEET_AI_FUNCTIONS.lastIndex = 0;
    if (!SHEET_AI_FUNCTIONS.test(f[1].replace(/&quot;/g, '"'))) return cell;
    if (!/<v>[\s\S]*?<\/v>|<is>/.test(cell)) return cell; // no cached value: leave it
    n++;
    return cell.replace(f[0], '');
  });
  return { xml, n };
}

/**
 * @param {{entries: any[], read: Function}} zip
 * @param {'docx'|'xlsx'|'pptx'|'odf'} kind
 * @param {Set<string>} items
 * @param {(bytes: Uint8Array, name: string) => Promise<{bytes: Uint8Array, removed: object}>} cleanChild for embedded media
 */
export async function cleanOffice(zip, kind, items, cleanChild) {
  const removed = {};
  const manual = [];
  const notes = [];
  const out = [];
  let droppedCalcChain = false;
  const files = zip.entries.filter((e) => !e.dir);
  for (const e of files) {
    let data = await zip.read(e, 512 << 20);
    const name = e.name;
    const isXml = /\.(xml|rels)$/i.test(name);
    if (isXml) {
      let xml = decodeUtf8(data);
      const before = xml;
      // Document properties
      if (name === 'docProps/core.xml') {
        for (const tag of ['dc:creator', 'cp:lastModifiedBy']) {
          const r = blankElement(xml, tag, (v) => items.has('private') || (items.has('aiAuthors') && AI_NAME.test(v)));
          xml = r.xml;
          if (r.n) mergeCounts(removed, { [items.has('private') ? 'private' : 'aiAuthors']: r.n });
        }
        if (items.has('private')) for (const tag of ['cp:keywords', 'dc:description', 'cp:lastPrinted']) { const r = removeElement(xml, tag); xml = r.xml; if (r.n) mergeCounts(removed, { private: r.n }); }
      } else if (name === 'docProps/app.xml') {
        if (items.has('fingerprints')) for (const tag of ['Application', 'AppVersion', 'Template']) { const r = removeElement(xml, tag); xml = r.xml; if (r.n) mergeCounts(removed, { fingerprints: r.n }); }
        if (items.has('private')) for (const tag of ['Company', 'Manager']) { const r = removeElement(xml, tag); xml = r.xml; if (r.n) mergeCounts(removed, { private: r.n }); }
      } else if (name === 'docProps/custom.xml' && items.has('labels')) {
        xml = xml.replace(/<property\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/property>/g, (m, k, v) => {
          if (AI_PROP.test(k) || /\bai[- ]generated\b/i.test(v)) { mergeCounts(removed, { labels: 1 }); return ''; }
          return m;
        });
      } else if (name === 'meta.xml') {
        if (items.has('fingerprints')) { const r = removeElement(xml, 'meta:generator'); xml = r.xml; if (r.n) mergeCounts(removed, { fingerprints: r.n }); }
        if (items.has('private')) for (const tag of ['meta:initial-creator', 'dc:creator', 'meta:keyword']) { const r = removeElement(xml, tag); xml = r.xml; if (r.n) mergeCounts(removed, { private: r.n }); }
      } else if (/^(customXml\/item\d*\.xml|docProps\/.*xmp.*)$/i.test(name) && /x:xmpmeta/.test(xml)) {
        const r = editXmp(xml, items);
        xml = r.xml;
        mergeCounts(removed, r.removed);
      }
      // Body text, hyperlinks, comments
      if (TEXT_PART.test(name) || /_rels\/[^/]+\.rels$/.test(name)) {
        const r = cleanText(xml, items);
        xml = r.text;
        mergeCounts(removed, r.removed);
        if (TEXT_PART.test(name)) {
          const plain = xml.replace(/<\/w:p>|<\/a:p>|<\/text:p>/g, '\n').replace(/<[^>]+>/g, '');
          manual.push(...manualPhrases(plain, name.replace(/^.*\//, '')));
        }
      }
      if (items.has('aiAuthors') && AUTHOR_PART.test(name)) {
        xml = xml.replace(/\b(w:author|author|displayName|name)="([^"]*)"/g, (m, attr, v) => {
          if (AI_NAME.test(v)) { mergeCounts(removed, { aiAuthors: 1 }); return `${attr}=""`; }
          return m;
        });
      }
      if (items.has('formulas') && /^xl\/worksheets\/sheet\d+\.xml$/.test(name)) {
        const r = formulasToValues(xml);
        xml = r.xml;
        if (r.n) { mergeCounts(removed, { formulas: r.n }); droppedCalcChain = true; }
      }
      if (xml !== before) data = encodeUtf8(xml);
    } else if (/^(word|ppt|xl)\/media\/|^Pictures\//.test(name) && cleanChild) {
      const r = await cleanChild(data, name);
      if (r && r.bytes !== data) { data = r.bytes; mergeCounts(removed, r.removed); }
    }
    out.push({ name, data, store: name === 'mimetype' });
  }
  // Converted formulas invalidate the calculation chain: drop it so Excel rebuilds it cleanly.
  let final = out;
  if (droppedCalcChain) {
    final = out.filter((f) => f.name !== 'xl/calcChain.xml').map((f) => {
      if (f.name === '[Content_Types].xml' || f.name === 'xl/_rels/workbook.xml.rels') {
        const x = decodeUtf8(f.data).replace(/<(Override|Relationship)\b[^>]*calcChain[^>]*\/>/g, '');
        return { ...f, data: encodeUtf8(x) };
      }
      return f;
    });
    notes.push('AI formulas were replaced by their last calculated values; they will no longer recalculate.');
  }
  if (!Object.keys(removed).length) return { bytes: null, removed, manual, notes };
  return { bytes: await writeZip(final), removed, manual, notes };
}
