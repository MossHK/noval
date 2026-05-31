const express = require('express');
const axios = require('axios');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { TextDecoder } = require('util');

const router = express.Router();
const MAX_UPLOAD_BYTES = Number(process.env.SCRIPT_STUDIO_UPLOAD_LIMIT || 20 * 1024 * 1024);
const SUPPORTED_UPLOAD_EXTS = ['.txt', '.md', '.markdown', '.json', '.docx', '.epub'];
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_UPLOAD_BYTES },
});
const uploadScript = upload.single('script');

const DEFAULT_MODEL = process.env.SCRIPT_STUDIO_MODEL || process.env.ANTHROPIC_MODEL || process.env.OPENAI_MODEL || 'claude-3-5-sonnet-latest';
const JSON_REPAIR_MODEL = process.env.SCRIPT_STUDIO_JSON_REPAIR_MODEL || DEFAULT_MODEL;
const PLANNER_TIMEOUT_MS = Number(process.env.SCRIPT_STUDIO_TIMEOUT_MS || 600000);
const PLANNER_MAX_TOKENS = Number(process.env.SCRIPT_STUDIO_MAX_TOKENS || 9000);
const MAX_SOURCE_CHARS = Number(process.env.SCRIPT_STUDIO_MAX_SOURCE_CHARS || 120000);
const MAX_TOTAL_CHARS = Number(process.env.SCRIPT_STUDIO_MAX_TOTAL_CHARS || 320000);
const MAX_RAW_SOURCE_CHARS = Number(process.env.SCRIPT_STUDIO_MAX_RAW_SOURCE_CHARS || 2000000);
const ANTHROPIC_MESSAGE_CHAR_LIMIT = Number(process.env.SCRIPT_STUDIO_ANTHROPIC_MESSAGE_CHARS || 380000);
const ANTHROPIC_API_BASE = (process.env.ANTHROPIC_API_BASE || 'https://api.anthropic.com').replace(/\/$/, '');
const OPENAI_API_BASE = (process.env.OPENAI_API_BASE || 'https://api.openai.com/v1').replace(/\/$/, '');
const JOBS = new Map();

function getUidFromReq(req) {
    return cleanString(req.get('x-script-studio-user') || process.env.SCRIPT_STUDIO_USER_ID || 'local', 120);
}

function getEmailFromReq(req) {
    return cleanString(req.get('x-script-studio-email') || process.env.SCRIPT_STUDIO_USER_EMAIL || '', 240);
}

function getClientIp(req) {
    return req.ip || req.socket && req.socket.remoteAddress || '';
}

function requireUser(req, res, next) {
    req.scriptStudioUser = {
        uid: getUidFromReq(req),
        email: getEmailFromReq(req),
    };
    return next();
}

function noStore(_req, res, next) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.set('Surrogate-Control', 'no-store');
    return next();
}

router.use('/api/script-studio', noStore);

function uploadReadError(message) {
    return {
        success: false,
        error: message,
        publicError: message,
    };
}

function stateRoot() {
    return process.env.SCRIPT_STUDIO_STATE_DIR || path.join(process.cwd(), 'data', 'projects');
}

function userStateDir(uid) {
    const hash = crypto.createHash('sha256').update(String(uid)).digest('hex').slice(0, 32);
    return path.join(stateRoot(), hash);
}

function currentProjectFile(req) {
    return path.join(userStateDir(getUidFromReq(req)), 'current.json');
}

async function readCurrentProject(req) {
    try {
        const raw = await fs.readFile(currentProjectFile(req), 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
    }
}

async function writeCurrentProject(req, project) {
    const uid = getUidFromReq(req);
    const dir = userStateDir(uid);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const payload = {
        ...(project || {}),
        serverSavedAt: new Date().toISOString(),
        serverUser: {
            uid,
            email: getEmailFromReq(req),
        },
    };
    await fs.writeFile(currentProjectFile(req), JSON.stringify(payload, null, 2), { mode: 0o600 });
    return payload;
}

function modelProvider(model) {
    const configured = String(process.env.SCRIPT_STUDIO_PROVIDER || '').toLowerCase();
    if (configured === 'anthropic' || configured === 'openai') return configured;
    return /^claude\b/i.test(String(model || '')) ? 'anthropic' : 'openai';
}

function normalizeBearer(key) {
    const value = String(key || '').trim();
    if (!value) return '';
    return /^Bearer\s+/i.test(value) ? value : `Bearer ${value}`;
}

function providerApiKey(provider) {
    return provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY || '' : process.env.OPENAI_API_KEY || '';
}

function providerHeaders(provider, req) {
    const headers = {
        'Content-Type': 'application/json',
        'X-Real-IP': getClientIp(req),
        'X-Open-Script-Studio': '1',
    };
    const key = providerApiKey(provider);
    if (provider === 'anthropic') {
        headers['anthropic-version'] = process.env.ANTHROPIC_VERSION || '2023-06-01';
        const beta = process.env.ANTHROPIC_BETA || 'prompt-caching-2024-07-31';
        if (beta && beta !== '0') headers['anthropic-beta'] = beta;
        if (key) headers['x-api-key'] = key;
    } else if (key) {
        headers.Authorization = normalizeBearer(key);
    }
    return headers;
}

function decodeTextBuffer(buffer) {
    const encodings = ['utf-8', 'gb18030', 'gbk', 'big5', 'latin1'];
    let bestText = buffer.toString('utf8');
    let bestScore = (bestText.match(/\uFFFD/g) || []).length;
    for (const encoding of encodings) {
        try {
            const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
            const score = (text.match(/\uFFFD/g) || []).length;
            if (score < bestScore) {
                bestScore = score;
                bestText = text;
            }
        } catch (error) {
            // Unsupported iconv encodings vary by Node build; fall back to UTF-8.
        }
    }
    return bestText.replace(/^\uFEFF/, '');
}

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
            const code = parseInt(hex, 16);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        })
        .replace(/&#(\d+);/g, (_, decimal) => {
            const code = parseInt(decimal, 10);
            return Number.isFinite(code) ? String.fromCodePoint(code) : _;
        })
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function xmlTextToPlainText(xml) {
    return decodeXmlEntities(String(xml || '')
        .replace(/<w:tab\/>/g, '\t')
        .replace(/<w:br\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, ''))
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function readZipEntry(zipfile, entry) {
    return new Promise((resolve, reject) => {
        zipfile.openReadStream(entry, (streamError, stream) => {
            if (streamError) {
                reject(streamError);
                return;
            }
            const chunks = [];
            stream.on('data', chunk => chunks.push(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(Buffer.concat(chunks)));
        });
    });
}

function requireZipReader(kind) {
    try {
        return require('yauzl');
    } catch (error) {
        throw new Error(`${kind} parsing is not available on this server. Please export the file as txt or md.`);
    }
}

async function extractDocxText(buffer) {
    const yauzl = requireZipReader('DOCX');
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zipfile) => {
            if (openError) {
                reject(new Error('Could not open DOCX file. Please check that it is a valid .docx document.'));
                return;
            }
            const parts = [];
            zipfile.readEntry();
            zipfile.on('entry', entry => {
                const name = entry.fileName || '';
                const wanted = name === 'word/document.xml' || /^word\/(header|footer)\d+\.xml$/.test(name);
                if (!wanted) {
                    zipfile.readEntry();
                    return;
                }
                readZipEntry(zipfile, entry)
                    .then(entryBuffer => {
                        const text = xmlTextToPlainText(entryBuffer.toString('utf8'));
                        if (text) parts.push(text);
                        zipfile.readEntry();
                    })
                    .catch(reject);
            });
            zipfile.on('end', () => {
                const text = parts.join('\n\n').trim();
                if (!text) {
                    reject(new Error('No readable text found in the DOCX file.'));
                    return;
                }
                resolve(text);
            });
            zipfile.on('error', reject);
        });
    });
}

function htmlTextToPlainText(html) {
    const bodyMatch = String(html || '').match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const body = bodyMatch ? bodyMatch[1] : String(html || '');
    return decodeXmlEntities(body
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        .replace(/<style\b[\s\S]*?<\/style>/gi, '')
        .replace(/<svg\b[\s\S]*?<\/svg>/gi, '')
        .replace(/<head\b[\s\S]*?<\/head>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|section|article|chapter|h[1-6]|li|tr|blockquote)>/gi, '\n')
        .replace(/<li\b[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, ''))
        .replace(/\u00a0/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function parseXmlAttrs(tag) {
    const attrs = {};
    String(tag || '').replace(/([\w:-]+)\s*=\s*["']([^"']*)["']/g, (_, key, value) => {
        attrs[key] = decodeXmlEntities(value);
        return '';
    });
    return attrs;
}

function zipDirname(filePath) {
    const index = String(filePath || '').lastIndexOf('/');
    return index >= 0 ? filePath.slice(0, index + 1) : '';
}

function normalizeZipPath(filePath) {
    const parts = String(filePath || '')
        .replace(/\\/g, '/')
        .replace(/#.*$/, '')
        .split('/');
    const out = [];
    parts.forEach(part => {
        if (!part || part === '.') return;
        if (part === '..') out.pop();
        else {
            try {
                out.push(decodeURIComponent(part));
            } catch (error) {
                out.push(part);
            }
        }
    });
    return out.join('/');
}

function joinZipPath(base, href) {
    return normalizeZipPath(`${base || ''}${href || ''}`);
}

function collectEpubEntries(buffer) {
    const yauzl = requireZipReader('EPUB');
    return new Promise((resolve, reject) => {
        yauzl.fromBuffer(buffer, { lazyEntries: true }, (openError, zipfile) => {
            if (openError) {
                reject(new Error('Could not open EPUB file. Please check that it is a valid .epub document.'));
                return;
            }
            const entries = new Map();
            zipfile.readEntry();
            zipfile.on('entry', entry => {
                const name = normalizeZipPath(entry.fileName || '');
                const wanted = name === 'META-INF/container.xml'
                    || /\.opf$/i.test(name)
                    || /\.(xhtml|html|htm)$/i.test(name);
                if (!wanted || /\/$/.test(name)) {
                    zipfile.readEntry();
                    return;
                }
                readZipEntry(zipfile, entry)
                    .then(entryBuffer => {
                        entries.set(name, entryBuffer.toString('utf8'));
                        zipfile.readEntry();
                    })
                    .catch(reject);
            });
            zipfile.on('end', () => resolve(entries));
            zipfile.on('error', reject);
        });
    });
}

function epubChapterOrder(entries) {
    const container = entries.get('META-INF/container.xml') || '';
    const rootMatch = container.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["'][^>]*>/i);
    const rootPath = normalizeZipPath(rootMatch && rootMatch[1] || Array.from(entries.keys()).find(name => /\.opf$/i.test(name)) || '');
    const opf = rootPath ? entries.get(rootPath) || '' : '';
    const base = zipDirname(rootPath);
    const manifest = {};
    String(opf || '').replace(/<item\b[^>]*>/gi, tag => {
        const attrs = parseXmlAttrs(tag);
        if (!attrs.id || !attrs.href) return tag;
        const href = joinZipPath(base, attrs.href);
        const media = String(attrs['media-type'] || '').toLowerCase();
        if (/application\/xhtml\+xml|text\/html/.test(media) || /\.(xhtml|html|htm)$/i.test(href)) {
            manifest[attrs.id] = href;
        }
        return tag;
    });
    const ordered = [];
    String(opf || '').replace(/<itemref\b[^>]*>/gi, tag => {
        const attrs = parseXmlAttrs(tag);
        const href = attrs.idref && manifest[attrs.idref];
        if (href && entries.has(href)) ordered.push(href);
        return tag;
    });
    if (ordered.length) return Array.from(new Set(ordered));
    return Array.from(entries.keys()).filter(name => /\.(xhtml|html|htm)$/i.test(name)).sort();
}

async function extractEpubText(buffer) {
    const entries = await collectEpubEntries(buffer);
    const ordered = epubChapterOrder(entries);
    const parts = ordered
        .map(name => htmlTextToPlainText(entries.get(name) || ''))
        .filter(Boolean);
    const text = parts.join('\n\n').trim();
    if (!text) {
        throw new Error('No readable text found in the EPUB file.');
    }
    return text;
}

function cleanString(value, maxLength = 200000) {
    return String(value || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').slice(0, maxLength);
}

function trimSource(text, maxLength) {
    const value = cleanString(text, MAX_RAW_SOURCE_CHARS);
    if (value.length <= maxLength) return { text: value, truncated: false, originalLength: value.length };
    const markerBudget = 2200;
    const budget = Math.max(2500, maxLength - markerBudget);
    const sectionCount = budget >= 40000 ? 9 : budget >= 18000 ? 7 : 5;
    const sliceLength = Math.max(500, Math.floor(budget / sectionCount));
    const points = Array.from({ length: sectionCount }, (_, index) => (
        sectionCount === 1 ? 0 : index / (sectionCount - 1)
    ));
    const slices = points.map(point => {
        const start = point >= 1
            ? Math.max(0, value.length - sliceLength)
            : Math.max(0, Math.floor((value.length - sliceLength) * point));
        return { start, end: Math.min(value.length, start + sliceLength) };
    }).sort((a, b) => a.start - b.start);
    const merged = [];
    slices.forEach(slice => {
        const last = merged[merged.length - 1];
        if (last && slice.start <= last.end + 120) {
            last.end = Math.max(last.end, slice.end);
        } else {
            merged.push({ ...slice });
        }
    });
    const sampled = merged.map((slice, index) => [
        `[节选 ${index + 1}/${merged.length}，原文位置 ${slice.start + 1}-${slice.end} / ${value.length}]`,
        value.slice(slice.start, slice.end).trim(),
    ].filter(Boolean).join('\n')).join('\n\n[中间内容跳过，继续抽取后续章节]\n\n');
    return {
        text: sampled.slice(0, maxLength),
        truncated: true,
        originalLength: value.length,
    };
}

function normalizeSources(body) {
    const rawSources = Array.isArray(body.sourceMaterials) ? body.sourceMaterials : [];
    const fallback = body.mainScript ? [{ role: 'main', title: '主剧情', text: body.mainScript }] : [];
    const sources = (rawSources.length ? rawSources : fallback)
        .map((source, index) => ({
            role: cleanString(source.role || `source_${index + 1}`, 80),
            title: cleanString(source.title || `素材 ${index + 1}`, 120),
            text: cleanString(source.text || '', MAX_RAW_SOURCE_CHARS),
        }))
        .filter(source => source.text.trim());

    let total = 0;
    return sources.map(source => {
        const remaining = Math.max(3000, MAX_TOTAL_CHARS - total);
        const perSourceLimit = Math.min(MAX_SOURCE_CHARS, remaining);
        const trimmed = trimSource(source.text, perSourceLimit);
        total += trimmed.text.length;
        return {
            ...source,
            excerpt: trimmed.text,
            truncated: trimmed.truncated,
            originalLength: trimmed.originalLength,
        };
    });
}

function sourceHasRole(sources, patterns) {
    return sources.some(source => {
        const role = String(source.role || '').toLowerCase();
        const title = String(source.title || '').toLowerCase();
        return patterns.some(pattern => pattern.test(role) || pattern.test(title));
    });
}

function buildPlannerMessages(body) {
    const settings = {
        targetMarket: cleanString(body.targetMarket || 'global', 80),
        language: cleanString(body.language || 'zh', 20),
        genre: cleanString(body.genre || 'urban fantasy drama', 120),
        audience: cleanString(body.audience || 'overseas short drama viewers', 180),
        tone: cleanString(body.tone || 'cinematic, emotionally direct, addictive cliffhangers', 180),
        adaptationLevel: cleanString(body.adaptationLevel || 'medium', 40),
        notes: cleanString(body.notes || '', 3000),
    };
    const sources = normalizeSources(body);
    const hasPlotReference = sourceHasRole(sources, [/plot/, /main/, /story/, /剧情/, /故事/]);
    const hasCharacterReference = sourceHasRole(sources, [/character/, /cast/, /人物/, /角色/]);
    const hasWorldReference = sourceHasRole(sources, [/world/, /skill/, /power/, /setting/, /世界/, /技能/, /力量/, /设定/]);
    const sourceCoverage = [
        `主剧情参考: ${hasPlotReference ? '用户已提供，可参考情节结构和爽点节奏。' : '未明确提供；如素材中包含剧情，请自行识别。'}`,
        `人物设定参考: ${hasCharacterReference ? '用户已提供，可参考角色功能、关系和成长线。' : `未提供；必须根据目标受众“${settings.audience}”、类型、目标市场、主剧情和语气风格原创完整人物圣经。`}`,
        `世界观/技能参考: ${hasWorldReference ? '用户已提供，可参考世界机制、势力、物品和技能类型。' : `未提供；必须根据目标受众“${settings.audience}”、类型、目标市场、主剧情和语气风格原创世界观、势力、力量体系、技能/物品规则和视觉语言。`}`,
    ].join('\n');
    const payload = sources.map(source => [
        `### ${source.title}`,
        `role: ${source.role}`,
        `original_length: ${source.originalLength}`,
        `truncated: ${source.truncated ? 'yes' : 'no'}`,
        source.excerpt,
    ].join('\n')).join('\n\n');

    const system = [
        '你是资深短剧/漫剧剧本开发总监，擅长把中文网文、漫剧、短剧素材改造成面向海外观众的原创项目。',
        '你的任务是做“创作改造”，不是照搬。可以参考情节结构、人物功能、爽点节奏、世界观机制和技能类型，但必须输出新的命名、设定表达和本地化包装。',
        '重点处理人物、世界观、情节、物品、技能、势力、宇宙生态、文化语境、价值动机和视觉风格的欧美化/全球化。',
        '如果用户没有提供人物设定参考，必须根据目标受众、目标市场、类型、主剧情和语气风格原创人物圣经，不能留空或写“未提供”。',
        '如果用户没有提供世界观/技能参考，必须根据目标受众、目标市场、类型、主剧情和语气风格原创世界观、势力、力量体系、技能/物品规则和视觉语言，不能留空或写“未提供”。',
        '原创补全的内容要服务于目标受众的审美、文化熟悉度、情绪爽点和平台观看习惯，并在 reference_source 或 rationale 中标注为基于目标受众原创生成。',
        '保持故事钩子强、镜头友好、适合后续进入制作流程拆分分镜。',
        '只输出严格 JSON，不要 Markdown，不要代码块。',
    ].join('\n');

    const user = [
        '请根据以下素材生成一个可继续开发的“剧本创作方案”。',
        `目标市场: ${settings.targetMarket}`,
        `类型: ${settings.genre}`,
        `目标受众: ${settings.audience}`,
        `语气/风格: ${settings.tone}`,
        `改造强度: ${settings.adaptationLevel}`,
        `用户备注: ${settings.notes || '无'}`,
        '',
        '素材覆盖情况：',
        sourceCoverage,
        '',
        '缺失补全要求：',
        '- 如果人物设定参考缺失，character_bible 仍必须输出至少 4 个适合目标受众的核心角色，包含视觉、动机、弧光和角色关系功能。',
        '- 如果世界观/技能参考缺失，world_bible 与 skill_item_codex 仍必须输出完整、可拍、镜头友好的原创设定。',
        '- 不要把缺失参考当成失败；把它当成创作空间，但需要和已有主剧情、目标受众、市场与类型一致。',
        '- adapted_script 必须输出“完整改编剧本”正文，不是剧情节拍或简介。它需要包含可直接阅读和交给制作团队的分集/分场内容：动作、对白、旁白、视觉提示和结尾钩子。',
        '- 如果原始素材很长，不要逐章复述整部长篇；请生成覆盖本次改编方案核心开场剧情单元的完整第一版剧本，通常 3 个竖屏短剧/漫剧 episode，每集 3-5 场。每场都要有可拍的剧情正文和对白。',
        '- episode_beats 仍保留为较短剧情骨架；adapted_script 才是完整剧本正文。',
        '',
        '素材：',
        payload || '无有效素材',
        '',
        '输出 JSON schema：',
        JSON.stringify({
            project_title: 'string',
            logline: 'string',
            adaptation_strategy: 'string',
            globalization_notes: ['string'],
            source_analysis: {
                plot: ['string'],
                character_functions: ['string'],
                world_rules: ['string'],
                skills_items: ['string'],
                localization_risks: ['string'],
            },
            mapping_table: [
                { source: 'string', adapted: 'string', type: 'character|place|skill|item|faction|plot', rationale: 'string' }
            ],
            character_bible: [
                { name: 'string', role: 'string', visual: 'string', motivation: 'string', arc: 'string', reference_source: 'string' }
            ],
            world_bible: {
                setting: 'string',
                factions: ['string'],
                power_system: 'string',
                taboo_rules: ['string'],
                visual_language: 'string',
            },
            skill_item_codex: [
                { name: 'string', category: 'string', rule: 'string', visual: 'string' }
            ],
            episode_beats: [
                { index: 1, title: 'string', summary: 'string', hook: 'string', characters: ['string'], visual_notes: 'string' }
            ],
            adapted_script: {
                title: 'string',
                format: 'vertical short drama|comic drama',
                target_duration: 'string',
                premise: 'string',
                episodes: [
                    {
                        episode: 1,
                        title: 'string',
                        synopsis: 'string',
                        scenes: [
                            {
                                scene: 1,
                                title: 'string',
                                location: 'string',
                                time: 'string',
                                characters: ['string'],
                                action: 'string',
                                dialogue: [
                                    { speaker: 'string', line: 'string' }
                                ],
                                narration: 'string',
                                visual_notes: 'string',
                                ending_hook: 'string'
                            }
                        ]
                    }
                ]
            },
            opening_scenes: [
                { title: 'string', story: 'string', dialogue_notes: 'string', narration: 'string' }
            ],
            handoff_to_drama: {
                drama_prompt: 'string',
                prompt_rules: ['string'],
                warnings: ['string']
            }
        }, null, 2),
    ].join('\n');

    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

function stripJsonFence(text) {
    const value = String(text || '').trim();
    const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return fenced ? fenced[1].trim() : value;
}

function removeTrailingJsonCommas(text) {
    let out = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        if (inString) {
            out += char;
            if (escape) {
                escape = false;
            } else if (char === '\\') {
                escape = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            out += char;
            continue;
        }
        if (char === ',') {
            let j = i + 1;
            while (/\s/.test(text[j] || '')) j += 1;
            if (text[j] === '}' || text[j] === ']') continue;
        }
        out += char;
    }
    return out;
}

function insertMissingJsonCommas(text) {
    let out = '';
    let inString = false;
    let escape = false;
    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        out += char;
        if (inString) {
            if (escape) {
                escape = false;
            } else if (char === '\\') {
                escape = true;
            } else if (char === '"') {
                inString = false;
                let j = i + 1;
                while (/\s/.test(text[j] || '')) j += 1;
                let k = j + 1;
                while (/\s/.test(text[k] || '')) k += 1;
                if (text[j] === '"' && text[k] !== ':' && text[k] !== ',' && text[k] !== '}' && text[k] !== ']') {
                    out += ',';
                }
            }
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '}' || char === ']') {
            let j = i + 1;
            while (/\s/.test(text[j] || '')) j += 1;
            if (text[j] === '{' || text[j] === '[' || text[j] === '"') {
                out += ',';
            }
        }
    }
    return out;
}

function repairJsonCandidate(text) {
    return insertMissingJsonCommas(removeTrailingJsonCommas(text));
}

function extractJson(text) {
    const cleaned = stripJsonFence(text);
    let lastError;
    const tryParse = (candidate) => {
        try {
            return JSON.parse(candidate);
        } catch (error) {
            lastError = error;
        }
        const repaired = repairJsonCandidate(candidate);
        if (repaired !== candidate) {
            try {
                return JSON.parse(repaired);
            } catch (error) {
                lastError = error;
            }
        }
        return null;
    };
    const parsed = tryParse(cleaned);
    if (parsed) return parsed;
    try {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
            const sliced = cleaned.slice(start, end + 1);
            const slicedParsed = tryParse(sliced);
            if (slicedParsed) return slicedParsed;
        }
        throw lastError || new Error('Could not parse planner JSON');
    } catch (error) {
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start >= 0 && end > start) {
            const sliced = cleaned.slice(start, end + 1);
            const repaired = repairJsonCandidate(sliced);
            return JSON.parse(repaired);
        }
        throw error;
    }
}

function rawPlannerResponseMessage(response) {
    return response && response.data && (response.data.error && response.data.error.message || response.data.message || JSON.stringify(response.data));
}

function plannerResponseMessage(response) {
    const message = rawPlannerResponseMessage(response);
    if (response.status === 504 || /gateway time-out|gateway timeout/i.test(String(message || ''))) {
        return '模型服务处理超时，请稍后重试。';
    }
    if (response.status === 503 && /cpu overloaded|overloaded/i.test(String(message || ''))) {
        return '模型服务繁忙，请稍后重试。';
    }
    if (response.status === 503 && /model_not_found|无可用渠道|distributor/i.test(String(message || ''))) {
        return message;
    }
    return message;
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryPlannerResponse(response) {
    const message = rawPlannerResponseMessage(response);
    return response && response.status === 503 && /cpu overloaded|overloaded/i.test(String(message || ''));
}

async function postPlannerWithRetry(url, payload, options) {
    let response;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        response = await axios.post(url, payload, options);
        if (!shouldRetryPlannerResponse(response)) return response;
        await wait(1500 + attempt * 2500);
    }
    return response;
}

function shouldUseAnthropicMessages(model) {
    return modelProvider(model) === 'anthropic';
}

function anthropicTextBlock(content, cacheControl) {
    const block = {
        type: 'text',
        text: content,
    };
    if (cacheControl) block.cache_control = { type: 'ephemeral' };
    return block;
}

function anthropicPayload(messages, model, maxTokens) {
    const system = [];
    const converted = [];
    let cachedUserPrefix = false;
    (Array.isArray(messages) ? messages : []).forEach(message => {
        const role = message && message.role === 'assistant' ? 'assistant' : message && message.role === 'system' ? 'system' : 'user';
        const content = cleanString(message && message.content ? message.content : '', ANTHROPIC_MESSAGE_CHAR_LIMIT);
        if (!content) return;
        if (role === 'system') {
            system.push(content);
            return;
        }
        const shouldCache = role === 'user' && !cachedUserPrefix;
        if (shouldCache) cachedUserPrefix = true;
        converted.push({
            role,
            content: [anthropicTextBlock(content, shouldCache)],
        });
    });
    const payload = {
        model,
        max_tokens: maxTokens,
        messages: converted.length ? converted : [{ role: 'user', content: [anthropicTextBlock('Return a valid JSON object.', false)] }],
    };
    const systemText = system.join('\n\n');
    if (systemText) {
        payload.system = [anthropicTextBlock(cleanString(systemText, ANTHROPIC_MESSAGE_CHAR_LIMIT), true)];
    }
    return payload;
}

async function postPlanner(req, messages, temperature = 0.75, model = DEFAULT_MODEL, maxTokens = PLANNER_MAX_TOKENS) {
    const provider = modelProvider(model);
    const key = providerApiKey(provider);
    if (!key) {
        throw new Error(provider === 'anthropic' ? 'ANTHROPIC_API_KEY is not configured' : 'OPENAI_API_KEY is not configured');
    }
    if (provider === 'anthropic') {
        return postPlannerWithRetry(`${ANTHROPIC_API_BASE}/v1/messages`, anthropicPayload(messages, model, maxTokens), {
            headers: providerHeaders('anthropic', req),
            timeout: PLANNER_TIMEOUT_MS,
            validateStatus: () => true,
        });
    }
    const payload = {
        model,
        messages,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
    };
    payload.temperature = temperature;
    return postPlannerWithRetry(`${OPENAI_API_BASE}/chat/completions`, payload, {
        headers: providerHeaders('openai', req),
        timeout: PLANNER_TIMEOUT_MS,
        validateStatus: () => true,
    });
}

function plannerContent(response) {
    if (response.status < 200 || response.status >= 300) {
        const message = plannerResponseMessage(response);
        throw new Error(message || `Planner request failed: HTTP ${response.status}`);
    }
    const content = response.data && response.data.choices && response.data.choices[0]
        && response.data.choices[0].message && response.data.choices[0].message.content;
    const anthropicContent = response.data && Array.isArray(response.data.content)
        ? response.data.content.map(part => typeof part === 'string' ? part : part && part.text || '').join('')
        : response.data && typeof response.data.content === 'string' ? response.data.content : '';
    const value = content || anthropicContent;
    if (!value) {
        throw new Error('Planner returned an empty response');
    }
    return value;
}

async function repairPlannerJson(req, body, invalidContent, parseError) {
    const messages = buildPlannerMessages(body).concat([
        {
            role: 'assistant',
            content: String(invalidContent || '').slice(0, 30000),
        },
        {
            role: 'user',
            content: [
                '上一次输出不是合法 JSON，解析错误：',
                parseError.message,
                '请重新输出完整、可 JSON.parse 的 JSON 对象。',
                '不要 Markdown，不要代码块，不要解释。',
                '如果内容过长，可以压缩数组项数量，但必须保留 schema 的主要字段并闭合所有数组和对象。',
            ].join('\n'),
        },
    ]);
    const response = await postPlanner(req, messages, 0.2, JSON_REPAIR_MODEL, Math.max(PLANNER_MAX_TOKENS, 5000));
    return extractJson(plannerContent(response));
}

async function callPlanner(req, body) {
    const response = await postPlanner(req, buildPlannerMessages(body));
    const content = plannerContent(response);
    try {
        return extractJson(content);
    } catch (error) {
        return repairPlannerJson(req, body, content, error);
    }
}

function publicJob(job) {
    if (!job) return null;
    return {
        success: true,
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        error: job.error || '',
        result: job.result || null,
        logs: job.logs || [],
    };
}

function setJob(job, patch) {
    Object.assign(job, patch, { updatedAt: new Date().toISOString() });
    JOBS.set(job.id, job);
}

function normalizeList(items) {
    return Array.isArray(items) ? items.filter(item => item != null && String(item).trim()) : [];
}

function formatListBlock(title, items) {
    const values = normalizeList(items);
    if (!values.length) return '';
    return `${title}：\n${values.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}`;
}

function formatDialogueBlock(lines) {
    if (!Array.isArray(lines) || !lines.length) return '';
    const text = lines.map(line => {
        if (typeof line === 'string') return `    - ${line}`;
        const speaker = line && (line.speaker || line.name) ? line.speaker || line.name : '角色';
        const value = line && (line.line || line.text || line.dialogue) ? line.line || line.text || line.dialogue : '';
        return value ? `    - ${speaker}：${value}` : '';
    }).filter(Boolean).join('\n');
    return text ? `  对白：\n${text}` : '';
}

function formatAdaptedScript(adaptedScript) {
    if (!adaptedScript) return '';
    if (typeof adaptedScript === 'string') return adaptedScript;
    const episodes = Array.isArray(adaptedScript.episodes) && adaptedScript.episodes.length
        ? adaptedScript.episodes
        : Array.isArray(adaptedScript.scenes) && adaptedScript.scenes.length
            ? [{ episode: 1, title: adaptedScript.title || '完整剧本', scenes: adaptedScript.scenes }]
            : [];
    const header = [
        adaptedScript.title ? `剧本标题：${adaptedScript.title}` : '',
        adaptedScript.format ? `格式：${adaptedScript.format}` : '',
        adaptedScript.target_duration ? `目标时长：${adaptedScript.target_duration}` : '',
        adaptedScript.premise ? `前提：${adaptedScript.premise}` : '',
    ].filter(Boolean).join('\n');
    const episodeText = episodes.map((episode, episodeIndex) => {
        episode = episode || {};
        const scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
        const sceneText = scenes.map((scene, sceneIndex) => {
            scene = scene || {};
            return [
                `  场 ${scene.scene || sceneIndex + 1}：${scene.title || scene.location || '未命名场景'}`,
                scene.location ? `  地点：${scene.location}` : '',
                scene.time ? `  时间：${scene.time}` : '',
                normalizeList(scene.characters).length ? `  出场人物：${normalizeList(scene.characters).join('、')}` : '',
                scene.action ? `  动作/剧情：${scene.action}` : '',
                formatDialogueBlock(scene.dialogue),
                scene.narration ? `  旁白：${scene.narration}` : '',
                scene.visual_notes ? `  视觉提示：${scene.visual_notes}` : '',
                scene.ending_hook ? `  结尾钩子：${scene.ending_hook}` : '',
            ].filter(Boolean).join('\n');
        }).join('\n\n');
        return [
            `第 ${episode.episode || episodeIndex + 1} 集：${episode.title || ''}`.trim(),
            episode.synopsis ? `简介：${episode.synopsis}` : '',
            sceneText,
        ].filter(Boolean).join('\n');
    }).join('\n\n');
    return [header, episodeText].filter(Boolean).join('\n\n');
}

function buildProductionHandoffText(result) {
    const handoff = result.handoff_to_drama || {};
    const world = result.world_bible || {};
    const characters = Array.isArray(result.character_bible) ? result.character_bible : [];
    const codex = Array.isArray(result.skill_item_codex) ? result.skill_item_codex : [];
    const adaptedScriptText = formatAdaptedScript(result.adapted_script);

    return [
        result.project_title ? `标题：${result.project_title}` : '',
        result.logline ? `一句话简介：${result.logline}` : '',
        result.adaptation_strategy ? `改造策略：\n${result.adaptation_strategy}` : '',
        handoff.drama_prompt ? `制作交接提示词：\n${handoff.drama_prompt}` : '',
        formatListBlock('提示词规则', handoff.prompt_rules),
        formatListBlock('风险提醒', handoff.warnings),
        characters.length
            ? `人物圣经：\n${characters.map(character => [
                `- ${character.name || '未命名人物'} (${character.role || 'role pending'})`,
                character.visual ? `  视觉：${character.visual}` : '',
                character.motivation ? `  动机：${character.motivation}` : '',
                character.arc ? `  成长线：${character.arc}` : '',
            ].filter(Boolean).join('\n')).join('\n')}`
            : '',
        world.setting || world.power_system || normalizeList(world.factions).length
            ? [
                '世界观：',
                world.setting ? `设定：${world.setting}` : '',
                normalizeList(world.factions).length ? `势力：${normalizeList(world.factions).join('；')}` : '',
                world.power_system ? `力量体系：${world.power_system}` : '',
                normalizeList(world.taboo_rules).length ? `禁忌规则：${normalizeList(world.taboo_rules).join('；')}` : '',
                world.visual_language ? `视觉语言：${world.visual_language}` : '',
            ].filter(Boolean).join('\n')
            : '',
        codex.length
            ? `技能/物品规则：\n${codex.map(item => `- ${item.name || '未命名'}：${item.rule || ''}${item.visual ? `；视觉：${item.visual}` : ''}`).join('\n')}`
            : '',
        adaptedScriptText ? `完整改编剧本：\n${adaptedScriptText}` : '',
        Array.isArray(result.opening_scenes) && result.opening_scenes.length
            ? `开场场景：\n${result.opening_scenes.map((scene, i) => [
                `${i + 1}. ${scene.title || ''}`,
                scene.story || '',
                scene.dialogue_notes ? `对白提示：${scene.dialogue_notes}` : '',
                scene.narration ? `旁白：${scene.narration}` : '',
            ].filter(Boolean).join('\n')).join('\n\n')}`
            : '',
        Array.isArray(result.episode_beats) && result.episode_beats.length
            ? `剧情节拍：\n${result.episode_beats.map(beat => [
                `${beat.index || ''}. ${beat.title || ''} - ${beat.summary || ''}`,
                beat.hook ? `钩子：${beat.hook}` : '',
                beat.visual_notes ? `视觉：${beat.visual_notes}` : '',
            ].filter(Boolean).join('\n')).join('\n')}`
            : '',
    ].filter(Boolean).join('\n\n');
}

function buildProductionScriptText(result) {
    const openingScenes = Array.isArray(result.opening_scenes) ? result.opening_scenes : [];
    const episodeBeats = Array.isArray(result.episode_beats) ? result.episode_beats : [];
    const handoff = result.handoff_to_drama || {};
    const world = result.world_bible || {};
    const characters = Array.isArray(result.character_bible) ? result.character_bible : [];
    const codex = Array.isArray(result.skill_item_codex) ? result.skill_item_codex : [];
    const adaptedScriptText = formatAdaptedScript(result.adapted_script);
    const sceneText = openingScenes.length
        ? openingScenes.map((scene, index) => [
            `镜头 ${index + 1}：${scene.title || '未命名场景'}`,
            scene.story ? `画面/剧情：${scene.story}` : '',
            scene.dialogue_notes ? `对白提示：${scene.dialogue_notes}` : '',
            scene.narration ? `旁白：${scene.narration}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : '';
    const beatText = episodeBeats.length
        ? episodeBeats.map(beat => [
            `第 ${beat.index || ''} 段：${beat.title || ''}`,
            beat.summary || '',
            beat.hook ? `结尾钩子：${beat.hook}` : '',
            beat.visual_notes ? `视觉提示：${beat.visual_notes}` : '',
        ].filter(Boolean).join('\n')).join('\n\n')
        : '';
    const referenceText = [
        result.adaptation_strategy ? `改造策略：${result.adaptation_strategy}` : '',
        handoff.drama_prompt ? `整体提示词：${handoff.drama_prompt}` : '',
        normalizeList(handoff.prompt_rules).length ? `提示词规则：${normalizeList(handoff.prompt_rules).join('；')}` : '',
        characters.length
            ? `人物：${characters.map(character => `${character.name || '未命名人物'}-${character.role || ''}-${character.visual || ''}`).join('；')}`
            : '',
        world.setting ? `世界设定：${world.setting}` : '',
        world.power_system ? `力量体系：${world.power_system}` : '',
        world.visual_language ? `视觉语言：${world.visual_language}` : '',
        codex.length ? `技能/物品：${codex.map(item => `${item.name || '未命名'}-${item.rule || ''}`).join('；')}` : '',
    ].filter(Boolean).join('\n');

    return [
        result.project_title ? `# ${result.project_title}` : '# Script Studio Handoff',
        result.logline ? `一句话简介：${result.logline}` : '',
        adaptedScriptText ? `## 完整改编剧本\n${adaptedScriptText}` : '',
        sceneText ? `## 开场分镜与旁白\n${sceneText}` : '',
        beatText ? `## 后续剧情节拍\n${beatText}` : '',
        referenceText ? `## 制作参考\n${referenceText}` : '',
    ].filter(Boolean).join('\n\n');
}

function buildProductionPrefill(result, handoffText) {
    const title = cleanString(result.project_title || 'Script Studio Handoff', 160);
    return {
        version: 1,
        source: 'script-studio',
        importedAt: new Date().toISOString(),
        title,
        logline: cleanString(result.logline || '', 500),
        handoffText,
        scriptText: buildProductionScriptText(result),
        settings: {
            aspectRatio: '9:16',
            videoDuration: '6',
            videoSubtitles: true,
        },
        generationHints: {
            adaptationStrategy: result.adaptation_strategy || '',
            globalizationNotes: normalizeList(result.globalization_notes),
            characterBible: Array.isArray(result.character_bible) ? result.character_bible : [],
            worldBible: result.world_bible || {},
            skillItemCodex: Array.isArray(result.skill_item_codex) ? result.skill_item_codex : [],
            promptRules: result.handoff_to_drama && Array.isArray(result.handoff_to_drama.prompt_rules)
                ? result.handoff_to_drama.prompt_rules
                : [],
            warnings: result.handoff_to_drama && Array.isArray(result.handoff_to_drama.warnings)
                ? result.handoff_to_drama.warnings
                : [],
        },
    };
}

router.get('/api/script-studio/config', requireUser, (req, res) => {
    res.json({
        success: true,
        model: DEFAULT_MODEL,
        maxSourceChars: MAX_SOURCE_CHARS,
        maxTotalChars: MAX_TOTAL_CHARS,
        maxUploadBytes: MAX_UPLOAD_BYTES,
        supportedUploadTypes: SUPPORTED_UPLOAD_EXTS,
    });
});

router.get('/api/script-studio/project/current', requireUser, async (req, res) => {
    try {
        const project = await readCurrentProject(req);
        res.json({ success: true, project });
    } catch (error) {
        console.error('[SCRIPT_STUDIO] Read current project failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/api/script-studio/project/current', requireUser, async (req, res) => {
    try {
        const project = await writeCurrentProject(req, req.body && req.body.project ? req.body.project : req.body);
        res.json({ success: true, project });
    } catch (error) {
        console.error('[SCRIPT_STUDIO] Write current project failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/api/script-studio/script/read', requireUser, (req, res) => {
    uploadScript(req, res, async (uploadError) => {
        if (uploadError) {
            const message = uploadError.code === 'LIMIT_FILE_SIZE'
                ? `File is too large. Please upload a file under ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB.`
                : uploadError.message || 'Upload failed.';
            return res.status(uploadError.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json(uploadReadError(message));
        }
        try {
            if (!req.file) {
                return res.status(400).json(uploadReadError('No file uploaded'));
            }
            const ext = path.extname(req.file.originalname || '').toLowerCase();
            if (!SUPPORTED_UPLOAD_EXTS.includes(ext)) {
                return res.status(400).json(uploadReadError('Unsupported file type. Please upload txt, md, markdown, json, docx, or epub. PDF and legacy .doc files are not supported yet.'));
            }
            let text;
            if (ext === '.docx') {
                text = await extractDocxText(req.file.buffer);
            } else if (ext === '.epub') {
                text = await extractEpubText(req.file.buffer);
            } else {
                text = decodeTextBuffer(req.file.buffer);
            }
            res.json({
                success: true,
                filename: req.file.originalname,
                size: req.file.size,
                text,
                length: text.length,
            });
        } catch (error) {
            console.error('[SCRIPT_STUDIO] Read script failed:', error);
            res.status(400).json(uploadReadError(error.message || 'Could not read uploaded file.'));
        }
    });
});

router.post('/api/script-studio/jobs', requireUser, async (req, res) => {
    const uid = getUidFromReq(req);
    const body = req.body || {};
    if (!normalizeSources(body).length) {
        return res.status(400).json({ success: false, error: 'At least one source material is required' });
    }
    const requestContext = {
        user: req.user,
        cookies: req.cookies,
        headers: req.headers,
        ip: req.ip,
        socket: req.socket,
    };
    const job = {
        id: `script_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        uid,
        status: 'queued',
        progress: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        logs: [{ at: new Date().toISOString(), message: '任务已提交' }],
    };
    JOBS.set(job.id, job);
    res.json({ success: true, jobId: job.id, job: publicJob(job) });

    setImmediate(async () => {
        try {
            setJob(job, {
                status: 'running',
                progress: 20,
                logs: [...job.logs, { at: new Date().toISOString(), message: '正在分析素材和改造目标' }],
            });
            const result = await callPlanner(requestContext, body);
            setJob(job, {
                status: 'done',
                progress: 100,
                result,
                logs: [...job.logs, { at: new Date().toISOString(), message: '方案生成完成' }],
            });
            await writeCurrentProject(requestContext, {
                ...(body && body.project ? body.project : {}),
                settings: body && body.settings ? body.settings : {},
                sourceMaterials: Array.isArray(body.sourceMaterials) ? body.sourceMaterials : [],
                result,
                lastJobId: job.id,
            });
        } catch (error) {
            console.error('[SCRIPT_STUDIO] Job failed:', error);
            setJob(job, {
                status: 'error',
                progress: 100,
                error: error.message,
                logs: [...job.logs, { at: new Date().toISOString(), message: `失败：${error.message}` }],
            });
        }
    });
});

router.get('/api/script-studio/jobs/:jobId', requireUser, (req, res) => {
    const job = JOBS.get(req.params.jobId);
    if (!job || job.uid !== getUidFromReq(req)) {
        const message = '任务状态已过期或服务已重启，请重新提交改编任务。';
        return res.status(404).json({
            success: false,
            code: 'SCRIPT_STUDIO_JOB_NOT_FOUND',
            error: message,
            publicError: message,
        });
    }
    res.json(publicJob(job));
});

router.post('/api/script-studio/export-handoff', requireUser, async (req, res) => {
    try {
        const result = req.body && req.body.result ? req.body.result : {};
        const text = buildProductionHandoffText(result);
        const productionPrefill = buildProductionPrefill(result, text);
        const project = await writeCurrentProject(req, {
            ...(req.body && req.body.project ? req.body.project : {}),
            result,
            productionHandoffText: text,
            productionPrefill,
            exportedAt: new Date().toISOString(),
        });
        res.json({
            success: true,
            text,
            productionPrefill,
            project,
        });
    } catch (error) {
        console.error('[SCRIPT_STUDIO] Export handoff failed:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = {
    router,
};
