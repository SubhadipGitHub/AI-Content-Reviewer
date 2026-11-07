import { AI_TOOLS, SCRIPTED_GENERATORS, IPTC_SOURCE_TYPES, GEN_PARAMS } from '../rules.js';
import { finding } from '../findings.js';
import { indexOfBytes, extractStrings, decodeUtf8 } from '../../lib/bytes.js';

const STRICT_TOOLS = AI_TOOLS.filter((t) => !t.loose);

/** Fields that name the software that produced a file. */
const SOFTWARE_FIELDS = /^(software|producer|creator|creatortool|xmp:creatortool|application|appname|generator|meta:generator|claim_generator|softwareagent|credit|photoshop:credit|tool|program|encoder|encoded_by|tsse|madewith|ai|aigc)$/i;
/** Free-text fields: only high-specificity signatures are matched here. */
const FREE_TEXT_FIELDS = /^(comment|comments|description|imagedescription|usercomment|xpcomment|xpsubject|xpkeywords|keywords|subject|title|source|caption|parameters|software_params)$/i;
/** Fields that name a person — only flag when the whole value is an AI product name. */
const PERSON_FIELDS = /^(author|artist|dc:creator|lastmodifiedby|byline|xpauthor|manager|company)$/i;
const PERSON_AI = /^\s*(?:chatgpt|openai|microsoft copilot|copilot|github copilot|gemini|google gemini|bard|claude|anthropic|midjourney|dall[\s·.-]?e(?: \d)?|stable diffusion|firefly|adobe firefly|ai|a\.i\.|artificial intelligence|grok|perplexity|meta ai)\s*$/i;
const GENERIC_AI_TEXT = /\b(?:ai[- ]generated|generated (?:by|with|using) (?:ai|artificial intelligence)|created (?:with|by|using) (?:ai|artificial intelligence|generative ai)|made with ai|synthetic(?:ally generated)? (?:image|media|content))\b/i;

/**
 * Check a map of metadata fields for AI tool names.
 * @param {Record<string,string>} fields
 * @param {string} source e.g. "EXIF", "PDF Info dictionary"
 */
export function checkFields(fields, source) {
  const out = [];
  const seen = new Set();
  for (const [rawKey, rawVal] of Object.entries(fields)) {
    if (rawVal == null) continue;
    const val = String(rawVal).slice(0, 2000);
    const key = rawKey.split('/').pop();
    if (SOFTWARE_FIELDS.test(key) || /software|generator|tool|producer/i.test(key)) {
      const tool = AI_TOOLS.find((t) => t.re.test(val));
      if (tool && !seen.has(tool.name)) {
        seen.add(tool.name);
        out.push(finding({
          id: `meta.tool.${tool.name.replace(/\W+/g, '-').toLowerCase()}`,
          category: 'metadata',
          strength: 'strong',
          title: `${source} names ${tool.name}`,
          detail: `${rawKey}: ${val.length > 160 ? val.slice(0, 160) + '…' : val}`,
          why: 'Applications record their own name in file metadata. A generative-AI product here means the file was produced or exported by that tool.',
          evidence: [{ text: `${rawKey} = ${val.slice(0, 300)}` }],
          location: source,
        }));
        continue;
      }
      if (GENERIC_AI_TEXT.test(val) && !seen.has('generic')) {
        seen.add('generic');
        out.push(finding({
          id: 'meta.ai-label', category: 'metadata', strength: 'strong',
          title: `${source} labels the content as AI-generated`,
          detail: `${rawKey}: ${val.slice(0, 160)}`,
          why: 'Some tools and platforms write an explicit "AI generated" label into metadata.',
          evidence: [{ text: `${rawKey} = ${val.slice(0, 300)}` }], location: source,
        }));
        continue;
      }
      const scripted = SCRIPTED_GENERATORS.find((t) => t.re.test(val));
      if (scripted && !seen.has(scripted.name)) {
        seen.add(scripted.name);
        out.push(finding({
          id: `meta.scripted.${scripted.name.replace(/\W+/g, '-').toLowerCase()}`,
          category: 'metadata', strength: 'weak',
          title: `${scripted.name} in ${source}`,
          detail: `${rawKey}: ${val.slice(0, 160)}`,
          why: 'The file was produced by code rather than an office application. That is common in AI pipelines (e.g. an LLM writing a report through python-docx) but also in ordinary automation.',
          evidence: [{ text: `${rawKey} = ${val.slice(0, 300)}` }], location: source,
        }));
      }
    } else if (FREE_TEXT_FIELDS.test(key)) {
      const gp = GEN_PARAMS.find((g) => g.re.test(val));
      const label = GENERIC_AI_TEXT.test(val);
      const tool = STRICT_TOOLS.find((t) => t.re.test(val));
      const hit = gp?.name || (label && 'an explicit AI-generated label') || (tool && tool.name);
      if (hit && !seen.has(hit)) {
        seen.add(hit);
        out.push(finding({
          id: `meta.text.${hit.replace(/\W+/g, '-').toLowerCase()}`, category: 'metadata',
          strength: gp || label ? 'strong' : 'moderate',
          title: gp ? `${gp.name} in ${source}` : `${source} ${rawKey} mentions ${hit}`,
          detail: `${rawKey}: ${val.length > 200 ? val.slice(0, 200) + '…' : val}`,
          why: gp ? 'Image generators store the prompt, sampler, seed and model settings in metadata. These parameters only exist for generated images.' : 'A descriptive metadata field mentions an AI generator or labels the content as AI-made.',
          evidence: [{ text: `${rawKey} = ${val.slice(0, 400)}` }], location: source,
        }));
      }
    } else if (PERSON_FIELDS.test(key) && PERSON_AI.test(val)) {
      out.push(finding({
        id: `meta.person.${key.toLowerCase()}`, category: 'metadata', strength: 'strong',
        title: `${source}: ${rawKey} is "${val.trim()}"`,
        detail: `The author/editor field is set to an AI product rather than a person.`,
        why: 'When an AI assistant edits a document (for example Copilot in Word) or a generator exports a file, its name can be recorded as the author or last editor.',
        evidence: [{ text: `${rawKey} = ${val}` }], location: source,
      }));
    }
  }
  return out;
}

/** Find and parse XMP packets anywhere in the bytes. Returns raw XML strings. */
export function findXmp(bytes, max = 4) {
  const packets = [];
  let from = 0;
  while (packets.length < max) {
    const s = indexOfBytes(bytes, '<x:xmpmeta', from);
    if (s < 0) break;
    const e = indexOfBytes(bytes, '</x:xmpmeta>', s);
    if (e < 0) break;
    packets.push(decodeUtf8(bytes.subarray(s, e + 12)));
    from = e + 12;
  }
  return packets;
}

const XMP_FIELDS = [
  'xmp:CreatorTool', 'tiff:Software', 'photoshop:Credit', 'dc:creator', 'dc:description', 'exif:UserComment',
  'pdf:Producer', 'xmpMM:History', 'stEvt:softwareAgent', 'Iptc4xmpExt:DigitalSourceType', 'plus:DataMining',
  'Iptc4xmpExt:AISystemUsed', 'Iptc4xmpExt:AISystemVersionUsed', 'Iptc4xmpExt:AIPromptInformation', 'Iptc4xmpExt:AIPromptWriterName',
];

/** Pull interesting fields out of an XMP packet (attribute or element form). */
export function parseXmp(xml) {
  const fields = {};
  for (const name of XMP_FIELDS) {
    const esc = name.replace(/[.:]/g, (c) => '\\' + c);
    const attr = new RegExp(`${esc}="([^"]*)"`, 'g');
    const elem = new RegExp(`<${esc}[^>]*>([\\s\\S]*?)</${esc}>`, 'g');
    const vals = [];
    for (const m of xml.matchAll(attr)) vals.push(m[1]);
    for (const m of xml.matchAll(elem)) vals.push(m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    const v = vals.filter(Boolean).join(' | ');
    if (v) fields[name] = v.slice(0, 1000);
  }
  // DigitalSourceType can also appear as a full IPTC URI anywhere.
  const dst = xml.match(/digitalsourcetype\/(\w+)/i);
  if (dst && !fields['Iptc4xmpExt:DigitalSourceType']) fields['Iptc4xmpExt:DigitalSourceType'] = dst[1];
  return fields;
}

/** Findings from XMP fields, including IPTC DigitalSourceType and AI-system properties. */
export function checkXmp(xml, source = 'XMP metadata') {
  const f = parseXmp(xml);
  const out = [];
  const dst = f['Iptc4xmpExt:DigitalSourceType'];
  if (dst) {
    const t = IPTC_SOURCE_TYPES.find((x) => dst.includes(x.key));
    if (t) out.push(finding({
      id: `prov.iptc.${t.key}`, category: 'provenance', strength: t.strength,
      title: `IPTC Digital Source Type: ${t.label}`,
      detail: `DigitalSourceType = ${t.key}`,
      why: 'The IPTC DigitalSourceType property is the industry-standard label used by OpenAI, Google, Adobe, Meta, Midjourney and others to declare AI-generated media.',
      evidence: [{ text: dst.slice(0, 300) }], location: source,
    }));
  }
  for (const k of ['Iptc4xmpExt:AISystemUsed', 'Iptc4xmpExt:AIPromptInformation', 'Iptc4xmpExt:AIPromptWriterName']) {
    if (f[k]) out.push(finding({
      id: `prov.iptc.${k.split(':')[1]}`, category: 'provenance', strength: 'strong',
      title: `IPTC ${k.split(':')[1].replace(/([A-Z])/g, ' $1').trim()} recorded`,
      detail: f[k].slice(0, 300),
      why: 'IPTC 2025 added fields that record which AI system and prompt produced the media.',
      evidence: [{ text: `${k} = ${f[k].slice(0, 300)}` }], location: source,
    }));
  }
  const toolFields = {};
  for (const [k, v] of Object.entries(f)) if (!/DigitalSourceType|AISystem|AIPrompt/.test(k)) toolFields[k.replace(/^.*:/, '')] = v;
  // dc:creator is a person field; the others are software-ish.
  if (toolFields.creator) { toolFields.Author = toolFields.creator; delete toolFields.creator; }
  if (toolFields.History) { toolFields.softwareAgent = toolFields.History; delete toolFields.History; }
  out.push(...checkFields(toolFields, source));
  return { findings: out, fields: f };
}

/**
 * Detect C2PA / Content Credentials manifests (JUMBF boxes) in raw bytes and
 * extract the claim generator and any AI-related actions.
 */
export function checkC2pa(bytes, source = 'file') {
  let at = indexOfBytes(bytes, 'c2pa');
  const jumb = indexOfBytes(bytes, 'jumb');
  if (at < 0 || jumb < 0) return { findings: [], info: null };
  const start = Math.max(0, Math.min(at, jumb) - 64);
  const region = bytes.subarray(start, Math.min(bytes.length, start + 512 * 1024));
  const strs = extractStrings(region, 4, 200_000);
  const info = { generator: null, aiSource: null, actions: [] };
  const gen = strs.match(/claim_generator(?:_info)?[\s\S]{0,8}?(?:name[\s\S]{0,4}?)?([A-Za-z][\w .\-/()®™:,]{2,90})/);
  if (gen) info.generator = gen[1].trim();
  const src = strs.match(/digitalsourcetype\/(\w+)/i);
  if (src) info.aiSource = src[1];
  for (const a of strs.matchAll(/c2pa\.(created|edited|opened|placed|converted|transcoded|drawing|color_adjustments|resized|cropped|filtered)/g)) {
    if (!info.actions.includes(a[1])) info.actions.push(a[1]);
  }
  const tool = AI_TOOLS.find((t) => t.re.test(strs.slice(0, 50_000)));
  const aiSource = info.aiSource && IPTC_SOURCE_TYPES.find((x) => info.aiSource.includes(x.key));
  const out = [];
  if (aiSource || tool) {
    out.push(finding({
      id: 'prov.c2pa.ai', category: 'provenance', strength: 'strong',
      title: 'Content Credentials (C2PA) declare AI generation',
      detail: [
        info.generator && `Claim generator: ${info.generator}`,
        aiSource && `Digital source type: ${aiSource.key} (${aiSource.label})`,
        tool && `AI tool named in manifest: ${tool.name}`,
        info.actions.length && `Actions: ${info.actions.join(', ')}`,
      ].filter(Boolean).join('\n'),
      why: 'C2PA Content Credentials are cryptographically signed provenance records embedded by OpenAI, Adobe Firefly, Microsoft, Google and camera makers. An AI source type or generator inside the manifest is the strongest available evidence. (Signature validity is not verified offline.)',
      evidence: [{ text: (info.generator || tool?.name || 'C2PA manifest').slice(0, 200) }],
      location: source,
    }));
  } else {
    out.push(finding({
      id: 'prov.c2pa.present', category: 'provenance', strength: 'info',
      title: 'Content Credentials (C2PA) manifest present',
      detail: [info.generator && `Claim generator: ${info.generator}`, info.actions.length && `Actions: ${info.actions.join(', ')}`].filter(Boolean).join('\n') || 'Manifest found; no AI source declared.',
      why: 'The file carries a provenance manifest. It does not declare AI generation, which is a mildly reassuring sign for authenticity.',
      location: source,
    }));
  }
  return { findings: out, info };
}

/** Generic scan used by every binary format: XMP packets + C2PA + metadata strings. */
export function genericBinaryScan(bytes, source) {
  const out = [];
  const meta = {};
  for (const x of findXmp(bytes)) {
    const r = checkXmp(x, `${source} XMP`);
    out.push(...r.findings);
    Object.assign(meta, r.fields);
  }
  const c = checkC2pa(bytes, source);
  out.push(...c.findings);
  if (c.info) meta.c2pa = c.info;
  return { findings: out, meta };
}

// ───────── China TC260 AIGC implicit label (GB 45438-2025) ─────────
const TC260_FIELDS = ['Label', 'ContentProducer', 'ProduceID', 'ContentPropagator', 'PropagateID', 'ServiceProvider', 'ServiceUser'];
const TC260_PRODUCERS = [
  [/doubao|豆包|001191110102MACQD9K6/i, 'Doubao (ByteDance)'],
  [/jimeng|即梦/i, 'Jimeng (ByteDance)'],
  [/kling|可灵|kuaishou|快手/i, 'Kling (Kuaishou)'],
  [/qwen|tongyi|通义|千问|alibaba|阿里/i, 'Qwen / Tongyi (Alibaba)'],
  [/腾讯|tencent|yuanbao|元宝|hunyuan|混元/i, 'Tencent (Hunyuan / Yuanbao)'],
  [/baidu|百度|ernie|文心/i, 'Baidu (ERNIE)'],
  [/hailuo|海螺|minimax/i, 'Hailuo (MiniMax)'],
  [/picwish/i, 'PicWish'],
];

function decodeXmlEntities(s) {
  return s.replace(/&quot;|&#34;|&#x22;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function firstJsonObject(s) {
  const start = s.indexOf('{');
  if (start < 0 || start > 48) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; } }
  }
  return null;
}

/** Find a TC260 AIGC label in raw bytes or text (XMP element/attribute, PNG chunk, EXIF JSON, bare AIGC{…}). */
export function checkAigcLabel(bytesOrText, source) {
  const text = typeof bytesOrText === 'string' ? bytesOrText : decodeUtf8(bytesOrText.subarray(0, Math.min(bytesOrText.length, 8 << 20)));
  const re = /AIGC/g;
  let m, tries = 0;
  while ((m = re.exec(text)) && tries++ < 40) {
    const obj = firstJsonObject(decodeXmlEntities(text.slice(m.index + 4, m.index + 3000)));
    const label = obj && (obj.AIGC && typeof obj.AIGC === 'object' ? obj.AIGC : obj);
    if (!label || typeof label !== 'object' || !TC260_FIELDS.some((f) => f in label)) continue;
    const producer = String(label.ContentProducer || label.ServiceProvider || '');
    const named = TC260_PRODUCERS.find(([r]) => r.test(producer))?.[1];
    const isAi = String(label.Label ?? '1') !== '3';
    return [finding({
      id: 'prov.tc260', category: 'provenance', strength: isAi ? 'strong' : 'moderate',
      title: `China AIGC label${named ? ` — ${named}` : ''}`,
      detail: [
        `Label: ${label.Label ?? '—'}${String(label.Label) === '1' ? ' (AI-generated)' : String(label.Label) === '2' ? ' (possibly AI-generated)' : ''}`,
        producer && `Content producer: ${producer}`,
        label.ProduceID && `Production ID: ${label.ProduceID}`,
        label.ContentPropagator && `Propagator: ${label.ContentPropagator}`,
      ].filter(Boolean).join('\n'),
      why: 'Since September 2025, Chinese law (GB 45438-2025) requires AI services such as Doubao, Jimeng, Kling, Qwen and Hunyuan to embed this "AIGC" label in the metadata of everything they generate.',
      evidence: [{ text: JSON.stringify(label).slice(0, 400) }],
      location: source,
    })];
  }
  return [];
}
