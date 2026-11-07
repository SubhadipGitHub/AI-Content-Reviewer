// Versioned signature catalogue. Bump RULES_VERSION whenever signatures change so
// the Library can offer "re-scan with updated rules".

export const RULES_VERSION = '2026.11.1';

/** Strength weights feed score.js. */
export const WEIGHTS = { strong: 0.85, moderate: 0.4, weak: 0.12 };

/** Generative tools whose names in metadata (Software, Producer, CreatorTool, generator…) are a strong signal. */
export const AI_TOOLS = [
  // image / video
  { re: /\bdall[\s·.-]?e\b/i, name: 'DALL·E (OpenAI)' },
  { re: /\bgpt[- ]?image|gpt-4o image|sora\b/i, name: 'OpenAI image/video' },
  { re: /\bmidjourney\b/i, name: 'Midjourney' },
  { re: /\bstable[\s-]?diffusion|\bsdxl\b|\bsd3(\.5)?\b|automatic1111|\bforge\b.*\bwebui\b/i, name: 'Stable Diffusion' },
  { re: /\bcomfyui\b/i, name: 'ComfyUI' },
  { re: /\binvokeai\b/i, name: 'InvokeAI' },
  { re: /\bnovelai\b/i, name: 'NovelAI' },
  { re: /\bfirefly\b/i, name: 'Adobe Firefly', loose: true },
  { re: /\bimagen\b|made with google ai|\bgemini\b|\bsynthid\b|nano[\s-]?banana/i, name: 'Google Imagen / Gemini', loose: true },
  { re: /\bbing image creator|microsoft designer|\bdesigner\.microsoft/i, name: 'Microsoft Designer / Bing' },
  { re: /\bleonardo\.?ai\b/i, name: 'Leonardo.Ai' },
  { re: /\bideogram\b/i, name: 'Ideogram' },
  { re: /\bflux(\.1)?[\s-](dev|schnell|pro|kontext)|black forest labs/i, name: 'FLUX (Black Forest Labs)' },
  { re: /\bgrok\b|\baurora\b.*\bxai\b|\bx\.ai\b/i, name: 'xAI Grok / Aurora', loose: true },
  { re: /\brunway(ml)?\b|\bgen-[234]\b/i, name: 'Runway', loose: true },
  { re: /\bpika(\.art| labs)\b|\bluma (ai|dream machine)\b|\bkling\b|\bveo ?\d?\b/i, name: 'AI video generator', loose: true },
  { re: /\bcanva (magic|ai)|magic media\b/i, name: 'Canva Magic Media' },
  { re: /\bplayground ?(ai|v\d)\b|\bnightcafe\b|\bdreamstudio\b|\bartbreeder\b|\bcraiyon\b/i, name: 'AI image service' },
  // text / documents / slides
  { re: /\bchatgpt\b|\bopenai\b/i, name: 'ChatGPT / OpenAI' },
  { re: /\bclaude(\.ai)?\b|\banthropic\b/i, name: 'Claude (Anthropic)', loose: true },
  { re: /\bcopilot\b/i, name: 'Microsoft Copilot', loose: true },
  { re: /\bgamma(\.app)?\b/i, name: 'Gamma', loose: true },
  { re: /\btome(\.app)?\b/i, name: 'Tome', loose: true },
  { re: /\bbeautiful\.ai\b/i, name: 'Beautiful.ai' },
  { re: /\bjasper(\.ai)?\b/i, name: 'Jasper', loose: true },
  { re: /\bnotion ai\b/i, name: 'Notion AI' },
  { re: /\bperplexity\b/i, name: 'Perplexity', loose: true },
  { re: /\bwritesonic|copy\.ai|rytr|quillbot|wordtune|sudowrite\b/i, name: 'AI writing assistant' },
  { re: /\bdeepseek|mistral ai|le chat|\bqwen\b|\bllama\b/i, name: 'LLM assistant', loose: true },
  // audio
  { re: /\bsuno\b|\budio\b|elevenlabs|\bmurf\.ai\b|\bplay\.ht\b/i, name: 'AI audio generator', loose: true },
  // sites
  { re: /\bv0\.dev\b|\blovable\b|\bbolt\.new\b|framer ai|durable\.co|\bwix adi\b|10web ai/i, name: 'AI site builder', loose: true },
];

/** Generation parameters written into free-text metadata fields by image generators. */
export const GEN_PARAMS = [
  { re: /Steps: \d+, Sampler: [^,\n]+,[\s\S]{0,80}?CFG scale: [\d.]+, Seed: \d+/i, name: 'Stable Diffusion generation parameters' },
  { re: /Negative prompt: /i, name: 'Stable Diffusion negative prompt' },
  { re: /(?:^|\s)--(?:ar \d+:\d+|v \d|niji|stylize \d+|chaos \d+|sref )[\s\S]{0,200}?Job ID: [0-9a-f-]{36}/i, name: 'Midjourney prompt and job ID' },
  { re: /"(?:class_type|ckpt_name|KSampler|CheckpointLoaderSimple)"/, name: 'ComfyUI workflow graph' },
  { re: /"(?:prompt|uc|steps|scale|sampler|n_samples|noise_schedule)"\s*:[\s\S]{0,400}"(?:sampler|steps|scale)"/i, name: 'Generator settings JSON (NovelAI-style)' },
];

/** Tools that are not themselves generative but often appear in scripted/automated output: weak only. */
export const SCRIPTED_GENERATORS = [
  { re: /python-docx|python-pptx|openpyxl|xlsxwriter|docx\.js|officegen|pandoc|apache poi|exceljs|sheetjs/i, name: 'Programmatic document generator' },
  { re: /reportlab|wkhtmltopdf|weasyprint|puppeteer|playwright|headless ?chrome|skia\/pdf|pdfkit|fpdf|jspdf/i, name: 'Programmatic PDF generator' },
];

/** IPTC digital source types (XMP Iptc4xmpExt:DigitalSourceType). */
export const IPTC_SOURCE_TYPES = [
  { key: 'trainedAlgorithmicMedia', strength: 'strong', label: 'Created by generative AI' },
  { key: 'compositeWithTrainedAlgorithmicMedia', strength: 'strong', label: 'Edited/composited with generative AI' },
  { key: 'algorithmicallyEnhanced', strength: 'moderate', label: 'Enhanced by an algorithm' },
  { key: 'algorithmicMedia', strength: 'moderate', label: 'Created purely by an algorithm' },
  { key: 'compositeSynthetic', strength: 'moderate', label: 'Composite including synthetic elements' },
];

/** PNG text chunk keys written by generative UIs. */
export const PNG_AI_KEYS = [
  { key: /^parameters$/i, tool: 'Automatic1111 / Forge (Stable Diffusion)' },
  { key: /^prompt$/i, tool: 'ComfyUI' },
  { key: /^workflow$/i, tool: 'ComfyUI' },
  { key: /^(dream|sd-metadata|invokeai_metadata|invokeai_graph)$/i, tool: 'InvokeAI' },
  { key: /^(negative_prompt|cfg_scale|sampler|seed)$/i, tool: 'Stable Diffusion UI' },
  { key: /^(generation_data|ai_metadata|aigc)$/i, tool: 'AI generator' },
];

/** Image dimensions frequently produced by generators (only used as a weak, corroborating signal). */
export const AI_DIMENSIONS = new Set([
  '512x512', '768x768', '1024x1024', '1536x1536', '2048x2048',
  '1792x1024', '1024x1792', '1536x1024', '1024x1536',
  '832x1216', '1216x832', '896x1152', '1152x896', '768x1344', '1344x768', '640x1536', '1536x640',
  '512x768', '768x512', '1456x816', '816x1456', '1232x928', '928x1232', '2912x1632', '1632x2912',
]);

/**
 * Chatbot residue in text. These come from copy/paste out of chat interfaces and are
 * near-certain identifiers when found in a deliverable.
 */
export const TEXT_ARTIFACTS = [
  { id: 'oai-cite', re: /【\d+(?::\d+)?†[^】]{0,40}】/g, strength: 'strong', title: 'ChatGPT file-citation marker', why: 'ChatGPT inserts markers like 【4†source】 when answering from uploaded files. They survive copy/paste into documents.' },
  { id: 'oai-contentref', re: /:?contentReference\[oaicite:\d+\](\{index=\d+\})?/g, strength: 'strong', title: 'ChatGPT contentReference token', why: 'Internal ChatGPT citation tokens (oaicite) leak when answers are copied as raw text.' },
  { id: 'oai-entity', re: /\b(?:entity|image_group|turn\d+(?:search|view|news|file)\d+)\[["{][^\]\n]{0,80}\]/g, strength: 'strong', title: 'ChatGPT internal reference token', why: 'Tokens like turn0search3 are ChatGPT search references that leak on copy/paste.' },
  { id: 'utm-ai', re: /[?&]utm_source=(?:chatgpt\.com|openai|perplexity(?:\.ai)?|copilot\.microsoft\.com|claude\.ai|gemini)/gi, strength: 'strong', title: 'Link tagged as coming from an AI assistant', why: 'AI search assistants append utm_source=chatgpt.com (or similar) to links they cite.' },
  { id: 'as-an-ai', re: /\bas an ai(?: language model| assistant| model)?\b|\bi(?:'m| am) (?:just )?an ai\b|\bas a large language model\b/gi, strength: 'strong', title: '"As an AI language model" disclaimer', why: 'Model self-references are a classic sign that chatbot output was pasted without editing.' },
  { id: 'knowledge-cutoff', re: /\b(?:as of|since) my (?:last )?(?:knowledge (?:cutoff|update)|training(?: data)?(?: cut-?off)?)\b/gi, strength: 'strong', title: 'Knowledge-cutoff disclaimer', why: 'Only language models talk about their own training cutoff.' },
  { id: 'chat-ui', re: /\b(?:regenerate response|chatgpt said:|you said:|copy code|was this response (?:better|helpful)|chatgpt can make mistakes|claude can make mistakes|gemini may display inaccurate)\b/gi, strength: 'strong', title: 'Chat interface text copied along with the answer', why: 'Button labels and footers from chat UIs come along when a whole conversation is copied.' },
  { id: 'assistant-opener', re: /(?:^|\n)\s*(?:certainly|absolutely|of course|sure)[!,.]? (?:here(?:'s| is| are)|below is|i(?:'d| would) be (?:happy|glad))\b/gi, strength: 'moderate', title: 'Assistant-style opener', why: 'Openers like "Certainly! Here\'s…" are typical of chatbot replies addressed to the prompter.' },
  { id: 'assistant-closer', re: /\b(?:i hope this helps|let me know if you(?:'d like| need| want| have)|feel free to (?:ask|reach out|let me know)|would you like me to|happy to help further|hope that helps)\b/gi, strength: 'moderate', title: 'Assistant-style sign-off', why: 'Offers of further help addressed to "you" are chatbot conversation residue.' },
  { id: 'placeholder', re: /\[(?:insert|your|add|company|name of|specific|relevant|date|recipient)[^\]\n]{0,40}\]/gi, strength: 'moderate', title: 'Unfilled template placeholder', why: 'Placeholders such as [Insert company name] are left behind when AI-drafted templates are not fully edited.' },
  { id: 'meta-prompt', re: /\b(?:here(?:'s| is) (?:a|an|the) (?:revised|rewritten|improved|polished|refined|draft|updated) version|this (?:revised|rewritten) version)\b/gi, strength: 'moderate', title: 'Rewrite/revision preamble', why: 'Phrases describing "a revised version" are chatbot preambles to the requester.' },
];

/** Invisible / unusual Unicode that some generators and watermarking schemes emit. */
export const HIDDEN_CHARS = [
  { cp: 0x200b, name: 'ZERO WIDTH SPACE' },
  { cp: 0x200c, name: 'ZERO WIDTH NON-JOINER' },
  { cp: 0x200d, name: 'ZERO WIDTH JOINER' },
  { cp: 0x2060, name: 'WORD JOINER' },
  { cp: 0xfeff, name: 'ZERO WIDTH NO-BREAK SPACE (BOM)' },
  { cp: 0x202f, name: 'NARROW NO-BREAK SPACE' },
  { cp: 0x00ad, name: 'SOFT HYPHEN' },
  { cp: 0x2062, name: 'INVISIBLE TIMES' },
  { cp: 0x2063, name: 'INVISIBLE SEPARATOR' },
  { cp: 0x180e, name: 'MONGOLIAN VOWEL SEPARATOR' },
];

/** Vocabulary over-represented in LLM prose (stylometry only, never decisive alone). */
export const AI_VOCAB = [
  'delve', 'delves', 'delving', 'tapestry', 'testament', 'multifaceted', 'nuanced', 'intricate', 'intricacies',
  'seamless', 'seamlessly', 'leverage', 'leveraging', 'robust', 'pivotal', 'paramount', 'meticulous', 'meticulously',
  'realm', 'landscape', 'navigate', 'navigating', 'underscore', 'underscores', 'showcase', 'showcasing', 'foster',
  'fostering', 'holistic', 'synergy', 'elevate', 'empower', 'empowering', 'unleash', 'unlock', 'embark', 'journey',
  'vibrant', 'bustling', 'commendable', 'noteworthy', 'invaluable', 'transformative', 'cutting-edge', 'game-changer',
  'ever-evolving', 'ever-changing', 'harness', 'harnessing', 'crucial', 'additionally', 'furthermore', 'moreover',
  'comprehensive', 'streamline', 'endeavor', 'resonate', 'resonates', 'interplay', 'beacon', 'labyrinth', 'symphony',
];

export const AI_PHRASES = [
  /in today'?s (?:fast-paced|digital|ever-(?:changing|evolving)|modern) (?:world|landscape|age|era)/gi,
  /it(?:'s| is) (?:important|worth|crucial) (?:to note|noting|to remember|to consider) that/gi,
  /\bnot (?:just|only|merely) (?:a |an )?[\w-]+(?: [\w-]+)?,? but (?:also )?/gi,
  /\b(?:in conclusion|in summary|to sum up|overall),/gi,
  /\bwhether you(?:'re| are) an? [\w\s-]{3,30} or an? /gi,
  /\b(?:plays|play) a (?:crucial|pivotal|vital|key|significant) role\b/gi,
  /\bstands as a testament\b|\ba testament to\b/gi,
  /\bdive (?:deep|deeper) into\b|\blet'?s dive in\b/gi,
];

/** Code-level markers. */
export const CODE_MARKERS = [
  { re: /generated (?:by|with|using) (?:github )?(copilot|chatgpt|gpt-?\d[\w.-]*|claude(?: code)?|cursor|codeium|windsurf|tabnine|gemini|codewhisperer|amazon q|aider|devin|replit (?:ai|agent)|bolt|v0|lovable|openai codex|codex)/gi, strength: 'strong', title: 'Explicit AI-generated code marker' },
  { re: /🤖 generated with \[?claude code/gi, strength: 'strong', title: 'Claude Code attribution' },
  { re: /co-authored-by:\s*(?:claude|copilot|github copilot|chatgpt|cursor|aider|devin|gemini|codex)[^\n]*/gi, strength: 'strong', title: 'AI co-author trailer' },
  { re: /@generated[^\n]{0,60}\b(?:ai|llm|gpt|claude|copilot)\b/gi, strength: 'strong', title: '@generated tag naming an AI tool' },
  { re: /(?:#|\/\/|\/\*|<!--|--)\s*(?:this (?:code|function|script|file) (?:was )?(?:written|created|generated) (?:by|with) (?:ai|an ai|chatgpt|claude|copilot))/gi, strength: 'strong', title: 'Comment stating code was AI-written' },
  { re: /(?:#|\/\/)\s*example usage:?\s*$/gim, strength: 'weak', title: 'Tutorial-style "Example usage" block', style: true },
  { re: /(?:#|\/\/)\s*step \d+:/gi, strength: 'weak', title: 'Numbered "Step N:" comments', style: true },
  { re: /(?:your[_-]?api[_-]?key[_-]?here|<your[_-][\w-]+>|replace with your (?:actual|own) )/gi, strength: 'weak', title: 'Placeholder credentials/values', style: true },
  { re: /(?:#|\/\/)\s*(?:todo:?\s*)?(?:implement (?:the )?(?:actual|real|your) (?:logic|implementation)|add (?:your|more) (?:logic|code) here|rest of (?:the )?(?:code|implementation)|\.\.\. ?(?:existing|rest of) code)/gi, strength: 'moderate', title: 'AI scaffold / elided-code comment', style: true },
];

/** Files/folders inside an archive or repo that indicate AI coding tools were configured. */
export const REPO_MARKERS = [
  { re: /(^|\/)\.cursorrules$|(^|\/)\.cursor\//i, tool: 'Cursor' },
  { re: /(^|\/)CLAUDE\.md$|(^|\/)\.claude\//i, tool: 'Claude Code' },
  { re: /(^|\/)AGENTS\.md$/i, tool: 'AI coding agents (AGENTS.md)' },
  { re: /(^|\/)\.github\/copilot-instructions\.md$|(^|\/)\.github\/(?:instructions|prompts)\/[^/]+\.(?:instructions|prompt)\.md$/i, tool: 'GitHub Copilot' },
  { re: /(^|\/)\.aider[^/]*$/i, tool: 'Aider' },
  { re: /(^|\/)\.windsurfrules$|(^|\/)\.windsurf\//i, tool: 'Windsurf' },
  { re: /(^|\/)\.continue\//i, tool: 'Continue' },
  { re: /(^|\/)\.codeium\//i, tool: 'Codeium' },
  { re: /(^|\/)\.clinerules$|(^|\/)\.roo(?:rules|modes)?$|(^|\/)\.roo\//i, tool: 'Cline / Roo Code' },
  { re: /(^|\/)GEMINI\.md$|(^|\/)\.gemini\//i, tool: 'Gemini CLI' },
  { re: /(^|\/)\.bolt\/|(^|\/)\.lovable\/|(^|\/)\.replit-agent/i, tool: 'AI app builder' },
  { re: /(^|\/)\.kiro\//i, tool: 'Kiro' },
];

/** Spreadsheet AI functions (new Excel functions are stored with the _xlfn. prefix). */
export const SHEET_AI_FUNCTIONS = /(?:_xlfn\.)?\b(COPILOT|AI|GPT|OPENAI|CLAUDE|GEMINI|AI\.ASK|AI\.EXTRACT|AI\.TRANSLATE|LABS\.GENERATIVEAI|GPT_\w+)\s*\(/g;

export const CODE_EXTENSIONS = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'c', 'h', 'cc', 'cpp', 'hpp',
  'cs', 'php', 'swift', 'm', 'mm', 'sh', 'bash', 'zsh', 'ps1', 'sql', 'pls', 'plsql', 'pks', 'pkb', 'r', 'lua', 'dart',
  'vue', 'svelte', 'groovy', 'pl', 'ex', 'exs', 'erl', 'hs', 'clj', 'tf', 'yml', 'yaml', 'toml', 'gradle', 'xsl', 'xslt',
  'css', 'scss', 'less', 'ipynb',
]);

export const TEXT_EXTENSIONS = new Set([
  'txt', 'md', 'markdown', 'rst', 'csv', 'tsv', 'json', 'xml', 'html', 'htm', 'rtf', 'tex', 'log', 'ini', 'cfg', 'conf',
  'env', 'srt', 'vtt', 'eml', 'adoc', 'org', 'jsonl', 'ndjson', 'svg',
]);
