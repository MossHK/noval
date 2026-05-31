(function () {
    'use strict';

    var STORAGE_KEY = 'openScriptStudio.current.v1';
    var HANDOFF_IMPORT_KEY = 'openScriptStudio.handoff.v1';
    var GLOBAL_LANGUAGE_KEY = 'preferred-language';
    var activeTab = 'overview';
    var pollTimer = null;
    var SUPPORTED_UPLOAD_EXTS = ['txt', 'md', 'markdown', 'json', 'docx', 'epub'];
    var MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

    function normalizeStudioLang(value) {
        var lang = String(value || '').toLowerCase();
        if (lang.indexOf('zh') === 0) return 'zh';
        if (lang.indexOf('ja') === 0) return 'ja';
        if (lang.indexOf('es') === 0) return 'es';
        return 'en';
    }

    var state = {
        lang: normalizeStudioLang(localStorage.getItem(GLOBAL_LANGUAGE_KEY) || 'en'),
        settings: {
            targetMarket: 'north_america',
            adaptationLevel: 'medium',
            genre: '都市奇幻、复仇、逆袭',
            audience: '海外短剧和漫剧观众',
            tone: '电影感、强钩子、快节奏、情绪直接',
            notes: ''
        },
        sources: {
            plot: '',
            characters: '',
            world: ''
        },
        result: null,
        logs: []
    };

    var sourceLabels = {
        zh: {
            plot: '主剧情参考',
            characters: '人物设定参考',
            world: '世界观/技能参考'
        },
        en: {
            plot: 'Main Plot Reference',
            characters: 'Character Reference',
            world: 'World / Skill Reference'
        },
        ja: {
            plot: 'メインストーリー参考',
            characters: 'キャラクター設定参考',
            world: '世界観 / スキル参考'
        },
        es: {
            plot: 'Referencia de trama principal',
            characters: 'Referencia de personajes',
            world: 'Referencia de mundo / habilidades'
        }
    };

    var scriptLabels = {
        zh: {
            title: '剧本标题',
            format: '格式',
            duration: '目标时长',
            premise: '剧本前提',
            episode: '第 {n} 集',
            synopsis: '简介',
            scene: '场 {n}',
            location: '地点',
            time: '时间',
            characters: '出场人物',
            action: '动作/剧情',
            dialogue: '对白',
            narration: '旁白',
            visual: '视觉提示',
            hook: '结尾钩子',
            missing: '当前结果还没有完整剧本。请重新生成一次，新的结果会包含完整剧本正文。'
        },
        en: {
            title: 'Script Title',
            format: 'Format',
            duration: 'Target Duration',
            premise: 'Premise',
            episode: 'Episode {n}',
            synopsis: 'Synopsis',
            scene: 'Scene {n}',
            location: 'Location',
            time: 'Time',
            characters: 'Characters',
            action: 'Action / Story',
            dialogue: 'Dialogue',
            narration: 'Narration',
            visual: 'Visual Notes',
            hook: 'Ending Hook',
            missing: 'This result does not include a full script yet. Generate again to include the new full-script draft.'
        },
        ja: {
            title: '脚本タイトル',
            format: '形式',
            duration: '想定尺',
            premise: '前提',
            episode: '第 {n} 話',
            synopsis: '概要',
            scene: 'シーン {n}',
            location: '場所',
            time: '時間',
            characters: '登場人物',
            action: 'アクション / 展開',
            dialogue: 'セリフ',
            narration: 'ナレーション',
            visual: 'ビジュアルメモ',
            hook: 'ラストフック',
            missing: '現在の結果には完全な脚本が含まれていません。もう一度生成すると完全脚本が追加されます。'
        },
        es: {
            title: 'Título del guion',
            format: 'Formato',
            duration: 'Duración objetivo',
            premise: 'Premisa',
            episode: 'Episodio {n}',
            synopsis: 'Sinopsis',
            scene: 'Escena {n}',
            location: 'Lugar',
            time: 'Tiempo',
            characters: 'Personajes',
            action: 'Acción / historia',
            dialogue: 'Diálogo',
            narration: 'Narración',
            visual: 'Notas visuales',
            hook: 'Gancho final',
            missing: 'Este resultado aún no incluye un guion completo. Genera de nuevo para incluir el nuevo borrador completo.'
        }
    };

    var i18n = {
        zh: {
            'header.kicker': 'Open Script Studio',
            'header.title': '剧本创作',
            'header.subtitle': '把中文网文、剧本和设定素材改造成适合海外漫剧开发的原创方案。',
            'action.save': '保存进度',
            'action.clear': '清空',
            'action.upload': '上传',
            'action.generate': '生成改编方案',
            'action.exportHandoff': '导出交接文本',
            'action.saveHandoff': '保存交接包',
            'action.copy': '复制',
            'settings.title': '创作方向',
            'settings.market': '目标市场',
            'settings.level': '改造强度',
            'settings.genre': '类型',
            'settings.audience': '目标受众',
            'settings.tone': '语气风格',
            'settings.notes': '补充要求',
            'settings.notesPlaceholder': '例如：人物名要欧美化，但保留修真等级感；技能系统要更像黑暗奇幻。',
            'market.north_america': '北美',
            'market.europe': '欧洲',
            'market.global': '全球英语用户',
            'market.custom': '自定义',
            'level.light': '轻度：保留原味',
            'level.medium': '中度：本地化包装',
            'level.heavy': '重度：重建世界观',
            'sources.title': '参考素材',
            'source.plot': '主剧情参考',
            'source.plotHint': '情节、冲突、爽点',
            'source.plotPlaceholder': '粘贴主剧情或小说片段...',
            'source.characters': '人物设定参考',
            'source.charactersHint': '可选；为空会按目标受众原创角色',
            'source.charactersPlaceholder': '可选：粘贴人物表、角色小传或另一个剧本的人物设定；不填会自动创作。',
            'source.world': '世界观/技能参考',
            'source.worldHint': '可选；为空会按目标受众原创世界观',
            'source.worldPlaceholder': '可选：粘贴世界观、技能体系、道具、组织设定；不填会自动创作。',
            'status.idleTitle': '等待素材',
            'status.idleText': '填写主剧情即可生成；人物设定和世界观为空时会按目标受众自动创作。',
            'status.runningTitle': '正在生成方案',
            'status.runningText': '正在分析素材、改造设定并组织完整剧本与制作交接文本。',
            'status.doneTitle': '方案已生成',
            'status.doneText': '可以检查完整剧本、改造映射、人物和剧情节拍，再导出交接文本。',
            'status.errorTitle': '生成失败',
            'tab.overview': '总览',
            'tab.mapping': '改造映射',
            'tab.characters': '人物',
            'tab.world': '世界观',
            'tab.beats': '剧情节拍',
            'tab.script': '完整剧本',
            'tab.drama': '制作交接',
            'empty.title': '还没有生成方案',
            'empty.text': '这里会显示改造策略、完整剧本、人物圣经、世界观规则和交接提示词。',
            'export.title': '制作交接文本',
            'log.title': '进度消息'
        },
        en: {
            'header.kicker': 'Open Script Studio',
            'header.title': 'Script Studio',
            'header.subtitle': 'Transform story drafts and reference bibles into original, overseas-ready drama concepts.',
            'action.save': 'Save',
            'action.clear': 'Clear',
            'action.upload': 'Upload',
            'action.generate': 'Generate Plan',
            'action.exportHandoff': 'Export Handoff',
            'action.saveHandoff': 'Save Handoff',
            'action.copy': 'Copy',
            'settings.title': 'Creative Direction',
            'settings.market': 'Target Market',
            'settings.level': 'Adaptation Level',
            'settings.genre': 'Genre',
            'settings.audience': 'Audience',
            'settings.tone': 'Tone',
            'settings.notes': 'Extra Notes',
            'settings.notesPlaceholder': 'Example: Westernize names, keep a cultivation-like ranking, make skills feel dark-fantasy.',
            'market.north_america': 'North America',
            'market.europe': 'Europe',
            'market.global': 'Global English',
            'market.custom': 'Custom',
            'level.light': 'Light: keep original flavor',
            'level.medium': 'Medium: localized packaging',
            'level.heavy': 'Heavy: rebuild the world',
            'sources.title': 'Reference Sources',
            'source.plot': 'Main Plot Reference',
            'source.plotHint': 'Plot, conflict, hooks',
            'source.plotPlaceholder': 'Paste the main story or novel excerpt...',
            'source.characters': 'Character Reference',
            'source.charactersHint': 'Optional; empty fields are generated for the audience',
            'source.charactersPlaceholder': 'Optional: paste bios or another character bible; leave blank to generate.',
            'source.world': 'World / Skill Reference',
            'source.worldHint': 'Optional; empty fields are generated for the audience',
            'source.worldPlaceholder': 'Optional: paste worldbuilding, skills, props, or factions; leave blank to generate.',
            'status.idleTitle': 'Waiting for Sources',
            'status.idleText': 'A main plot is enough; missing characters and world rules will be generated for the target audience.',
            'status.runningTitle': 'Generating Plan',
            'status.runningText': 'Analyzing sources, adapting world rules, and drafting the full script plus Production handoff text.',
            'status.doneTitle': 'Plan Ready',
            'status.doneText': 'Review the full script, mappings, characters, and story beats before exporting to Production Handoff.',
            'status.errorTitle': 'Generation Failed',
            'tab.overview': 'Overview',
            'tab.mapping': 'Mapping',
            'tab.characters': 'Characters',
            'tab.world': 'World',
            'tab.beats': 'Beats',
            'tab.script': 'Full Script',
            'tab.drama': 'Production Handoff',
            'empty.title': 'No plan yet',
            'empty.text': 'Adaptation strategy, full script, character bible, world rules, and production handoff prompts will appear here.',
            'export.title': 'Production Handoff',
            'log.title': 'Progress'
        },
        ja: {
            'header.kicker': 'Open Script Studio',
            'header.title': 'Script Studio',
            'header.subtitle': '中国語の小説、脚本、設定資料を海外向けドラマ企画に変換します。',
            'action.save': '保存',
            'action.clear': 'クリア',
            'action.upload': 'アップロード',
            'action.generate': '企画を生成',
            'action.exportHandoff': '制作へ書き出し',
            'action.saveHandoff': '制作交接を保存',
            'action.copy': 'コピー',
            'settings.title': '制作方針',
            'settings.market': '対象市場',
            'settings.level': '改稿レベル',
            'settings.genre': 'ジャンル',
            'settings.audience': '対象視聴者',
            'settings.tone': 'トーン',
            'settings.notes': '追加要望',
            'settings.notesPlaceholder': '例：名前は欧米向けにしつつ、修行ランク感は残す。スキル体系はダークファンタジー寄りにする。',
            'market.north_america': '北米',
            'market.europe': 'ヨーロッパ',
            'market.global': 'グローバル英語圏',
            'market.custom': 'カスタム',
            'level.light': '軽め：原作感を残す',
            'level.medium': '中程度：ローカライズ',
            'level.heavy': '強め：世界観を再構築',
            'sources.title': '参考素材',
            'source.plot': 'メインストーリー参考',
            'source.plotHint': '展開、対立、フック',
            'source.plotPlaceholder': 'メインストーリーや小説の抜粋を貼り付け...',
            'source.characters': 'キャラクター参考',
            'source.charactersHint': '任意。空欄なら対象視聴者向けに生成',
            'source.charactersPlaceholder': '任意：人物表やキャラクター設定を貼り付け。空欄なら自動生成します。',
            'source.world': '世界観 / スキル参考',
            'source.worldHint': '任意。空欄なら対象視聴者向けに生成',
            'source.worldPlaceholder': '任意：世界観、スキル体系、道具、組織設定を貼り付け。空欄なら自動生成します。',
            'status.idleTitle': '素材待ち',
            'status.idleText': 'メインストーリーだけでも生成できます。人物と世界観は空欄なら対象視聴者向けに自動生成します。',
            'status.runningTitle': '企画を生成中',
            'status.runningText': '素材を分析し、設定を改稿して完全脚本と制作向け引き継ぎ文を作成しています。',
            'status.doneTitle': '企画が完成しました',
            'status.doneText': '完全脚本、改稿マッピング、人物、ストーリービートを確認してから制作へ書き出せます。',
            'status.errorTitle': '生成に失敗しました',
            'tab.overview': '概要',
            'tab.mapping': '改稿マッピング',
            'tab.characters': '人物',
            'tab.world': '世界観',
            'tab.beats': 'ビート',
            'tab.script': '完全脚本',
            'tab.drama': '制作引き継ぎ',
            'empty.title': 'まだ企画がありません',
            'empty.text': '改稿方針、完全脚本、人物バイブル、世界観ルール、制作向けプロンプトがここに表示されます。',
            'export.title': '制作引き継ぎ文',
            'log.title': '進捗'
        },
        es: {
            'header.kicker': 'Open Script Studio',
            'header.title': 'Script Studio',
            'header.subtitle': 'Convierte novelas, guiones y biblias de referencia en conceptos originales listos para el mercado internacional.',
            'action.save': 'Guardar',
            'action.clear': 'Limpiar',
            'action.upload': 'Subir',
            'action.generate': 'Generar plan',
            'action.exportHandoff': 'Exportar traspaso',
            'action.saveHandoff': 'Guardar traspaso',
            'action.copy': 'Copiar',
            'settings.title': 'Dirección creativa',
            'settings.market': 'Mercado objetivo',
            'settings.level': 'Nivel de adaptación',
            'settings.genre': 'Género',
            'settings.audience': 'Audiencia',
            'settings.tone': 'Tono',
            'settings.notes': 'Notas adicionales',
            'settings.notesPlaceholder': 'Ejemplo: occidentalizar nombres, conservar una sensación de rangos de cultivo y hacer que las habilidades parezcan fantasía oscura.',
            'market.north_america': 'Norteamérica',
            'market.europe': 'Europa',
            'market.global': 'Inglés global',
            'market.custom': 'Personalizado',
            'level.light': 'Ligero: conservar sabor original',
            'level.medium': 'Medio: localización',
            'level.heavy': 'Intenso: reconstruir el mundo',
            'sources.title': 'Fuentes de referencia',
            'source.plot': 'Referencia de trama principal',
            'source.plotHint': 'Trama, conflicto, ganchos',
            'source.plotPlaceholder': 'Pega la historia principal o un fragmento de la novela...',
            'source.characters': 'Referencia de personajes',
            'source.charactersHint': 'Opcional; vacío se genera para la audiencia',
            'source.charactersPlaceholder': 'Opcional: pega biografías o una biblia de personajes; déjalo vacío para generar.',
            'source.world': 'Referencia de mundo / habilidades',
            'source.worldHint': 'Opcional; vacío se genera para la audiencia',
            'source.worldPlaceholder': 'Opcional: pega worldbuilding, habilidades, objetos o facciones; déjalo vacío para generar.',
            'status.idleTitle': 'Esperando fuentes',
            'status.idleText': 'La trama principal basta; los personajes y el mundo se generarán para la audiencia objetivo si faltan.',
            'status.runningTitle': 'Generando plan',
            'status.runningText': 'Analizando fuentes, adaptando reglas del mundo y redactando el guion completo más el traspaso de producción.',
            'status.doneTitle': 'Plan listo',
            'status.doneText': 'Revisa el guion completo, mapeos, personajes y beats antes de exportar a Production Handoff.',
            'status.errorTitle': 'Error de generación',
            'tab.overview': 'Resumen',
            'tab.mapping': 'Mapeo',
            'tab.characters': 'Personajes',
            'tab.world': 'Mundo',
            'tab.beats': 'Beats',
            'tab.script': 'Guion completo',
            'tab.drama': 'Traspaso de producción',
            'empty.title': 'Aún no hay plan',
            'empty.text': 'Aquí aparecerán la estrategia de adaptación, el guion completo, la biblia de personajes, las reglas del mundo y los prompts de traspaso.',
            'export.title': 'Traspaso de producción',
            'log.title': 'Progreso'
        }
    };

    function $(selector, root) {
        return (root || document).querySelector(selector);
    }

    function $all(selector, root) {
        return Array.prototype.slice.call((root || document).querySelectorAll(selector));
    }

    function text(key) {
        return (i18n[state.lang] && i18n[state.lang][key]) || i18n.en[key] || i18n.zh[key] || key;
    }

    function scriptLabel(key, value) {
        var labels = scriptLabels[state.lang] || scriptLabels.en;
        return String(labels[key] || scriptLabels.en[key] || key).replace('{n}', value == null ? '' : value);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatTime(dateValue) {
        var date = dateValue ? new Date(dateValue) : new Date();
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function addLog(message) {
        state.logs = state.logs || [];
        state.logs.unshift({ at: new Date().toISOString(), message: message });
        state.logs = state.logs.slice(0, 80);
        renderLogs();
        saveLocal();
    }

    function renderLogs(remoteLogs) {
        if (Array.isArray(remoteLogs)) {
            var merged = remoteLogs.map(function (item) {
                return { at: item.at || new Date().toISOString(), message: item.message || String(item) };
            }).reverse().concat(state.logs || []);
            var seen = {};
            state.logs = merged.filter(function (item) {
                var key = item.at + '|' + item.message;
                if (seen[key]) return false;
                seen[key] = true;
                return true;
            }).slice(0, 80);
        }
        var list = $('#logList');
        if (!list) return;
        if (!state.logs || !state.logs.length) {
            list.innerHTML = '<div class="log-item"><time>--:--</time><span>' + escapeHtml(state.lang === 'zh' ? '暂无进度消息' : 'No progress yet') + '</span></div>';
            return;
        }
        list.innerHTML = state.logs.map(function (item) {
            return '<div class="log-item"><time>' + escapeHtml(formatTime(item.at)) + '</time><span>' + escapeHtml(item.message) + '</span></div>';
        }).join('');
    }

    function setStatus(status, progress, errorText) {
        var badge = $('#statusBadge');
        var fill = $('#progressFill');
        var title = $('#statusTitle');
        var body = $('#statusText');
        if (badge) badge.textContent = status || 'idle';
        if (fill) fill.style.width = Math.max(0, Math.min(100, Number(progress || 0))) + '%';
        if (!title || !body) return;
        if (status === 'running' || status === 'queued') {
            title.textContent = text('status.runningTitle');
            body.textContent = text('status.runningText');
        } else if (status === 'done') {
            title.textContent = text('status.doneTitle');
            body.textContent = text('status.doneText');
        } else if (status === 'error') {
            title.textContent = text('status.errorTitle');
            body.textContent = errorText || (state.lang === 'zh' ? '请稍后重试。' : 'Please try again later.');
        } else {
            title.textContent = text('status.idleTitle');
            body.textContent = text('status.idleText');
        }
    }

    function applyLanguage(lang) {
        state.lang = normalizeStudioLang(lang || state.lang || 'en');
        localStorage.setItem(GLOBAL_LANGUAGE_KEY, state.lang);
        document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : state.lang;
        $all('[data-studio-i18n]').forEach(function (el) {
            el.textContent = text(el.getAttribute('data-studio-i18n'));
        });
        $all('[data-studio-i18n-placeholder]').forEach(function (el) {
            el.setAttribute('placeholder', text(el.getAttribute('data-studio-i18n-placeholder')));
        });
        $all('[data-lang]').forEach(function (btn) {
            btn.classList.toggle('active', btn.getAttribute('data-lang') === state.lang);
        });
        setStatus(state.result ? 'done' : 'idle', state.result ? 100 : 0);
        renderResult();
        renderLogs();
        saveLocal();
    }

    function collectStateFromDom() {
        state.settings = {
            targetMarket: $('#targetMarket').value,
            adaptationLevel: $('#adaptationLevel').value,
            genre: $('#genre').value.trim(),
            audience: $('#audience').value.trim(),
            tone: $('#tone').value.trim(),
            notes: $('#notes').value.trim()
        };
        state.sources = {};
        $all('[data-source-text]').forEach(function (textarea) {
            state.sources[textarea.getAttribute('data-source-text')] = textarea.value;
        });
        return state;
    }

    function applyStateToDom() {
        $('#targetMarket').value = state.settings.targetMarket || 'north_america';
        $('#adaptationLevel').value = state.settings.adaptationLevel || 'medium';
        $('#genre').value = state.settings.genre || '';
        $('#audience').value = state.settings.audience || '';
        $('#tone').value = state.settings.tone || '';
        $('#notes').value = state.settings.notes || '';
        Object.keys(state.sources || {}).forEach(function (key) {
            var textarea = $('[data-source-text="' + key + '"]');
            if (textarea) textarea.value = state.sources[key] || '';
        });
        updateCounters();
    }

    function markClientUpdated() {
        state.clientUpdatedAt = new Date().toISOString();
    }

    function saveLocal(markDirty) {
        try {
            if (markDirty) markClientUpdated();
            collectStateFromDom();
            var payload = JSON.stringify(state);
            if (payload.length < 900000) {
                localStorage.setItem(STORAGE_KEY, payload);
            }
        } catch (error) {
            // Browser storage may be unavailable or full; server-side save still works.
        }
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            var parsed = JSON.parse(raw);
            state = Object.assign({}, state, parsed, {
                settings: Object.assign({}, state.settings, parsed.settings || {}),
                sources: Object.assign({}, state.sources, parsed.sources || {})
            });
        } catch (error) {
            localStorage.removeItem(STORAGE_KEY);
        }
    }

    function apiFetch(url, options) {
        var nextOptions = Object.assign({
            credentials: 'include',
            cache: 'no-store',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache',
                'Content-Type': 'application/json'
            }
        }, options || {});
        nextOptions.headers = Object.assign({
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache',
            'Content-Type': 'application/json'
        }, (options && options.headers) || {});
        return fetch(url, Object.assign({
            credentials: 'include',
            cache: 'no-store'
        }, nextOptions)).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (!response.ok || data.success === false) {
                    throw new Error(data.error || data.message || ('HTTP ' + response.status));
                }
                return data;
            });
        });
    }

    function saveServer(showToast) {
        collectStateFromDom();
        return apiFetch('/api/script-studio/project/current', {
            method: 'PUT',
            body: JSON.stringify({ project: state })
        }).then(function (data) {
            if (data.project && data.project.serverSavedAt) {
                state.serverSavedAt = data.project.serverSavedAt;
                state.serverUser = data.project.serverUser || state.serverUser;
                saveLocal(false);
            }
            if (showToast) addLog(state.lang === 'zh' ? '进度已保存。' : 'Progress saved.');
        }).catch(function (error) {
            addLog((state.lang === 'zh' ? '保存失败：' : 'Save failed: ') + error.message);
        });
    }

    function loadServer() {
        return apiFetch('/api/script-studio/project/current')
            .then(function (data) {
                if (!data.project) return;
                var remoteTime = Date.parse(data.project.serverSavedAt || 0);
                var localTime = Date.parse(state.clientUpdatedAt || state.serverSavedAt || 0);
                if (remoteTime > localTime) {
                    state = Object.assign({}, state, data.project, {
                        settings: Object.assign({}, state.settings, data.project.settings || {}),
                        sources: Object.assign({}, state.sources, data.project.sources || {})
                    });
                    state.lang = normalizeStudioLang(localStorage.getItem(GLOBAL_LANGUAGE_KEY) || state.lang || 'en');
                    applyStateToDom();
                    applyLanguage(state.lang || 'en');
                    renderResult();
                }
            })
            .catch(function () {
                renderLogs();
            });
    }

    function updateCounters() {
        $all('[data-source-text]').forEach(function (textarea) {
            var key = textarea.getAttribute('data-source-text');
            var count = $('[data-source-count="' + key + '"]');
            if (count) {
                count.textContent = (textarea.value || '').length.toLocaleString() + ' chars';
            }
        });
    }

    function sourceMaterials() {
        collectStateFromDom();
        return Object.keys(state.sources || {}).map(function (key) {
            return {
                role: key,
                title: sourceLabels[state.lang][key] || key,
                text: state.sources[key] || ''
            };
        }).filter(function (item) {
            return item.text.trim().length > 0;
        });
    }

    function renderList(items) {
        if (!Array.isArray(items) || !items.length) return '<p>' + escapeHtml(state.lang === 'zh' ? '暂无' : 'None yet') + '</p>';
        return '<ul>' + items.map(function (item) {
            return '<li>' + escapeHtml(typeof item === 'string' ? item : JSON.stringify(item)) + '</li>';
        }).join('') + '</ul>';
    }

    function renderTable(rows, columns) {
        if (!Array.isArray(rows) || !rows.length) return '<p>' + escapeHtml(state.lang === 'zh' ? '暂无' : 'None yet') + '</p>';
        return '<table class="result-table"><thead><tr>' + columns.map(function (col) {
            return '<th>' + escapeHtml(col.label) + '</th>';
        }).join('') + '</tr></thead><tbody>' + rows.map(function (row) {
            return '<tr>' + columns.map(function (col) {
                return '<td>' + escapeHtml(row[col.key] || '') + '</td>';
            }).join('') + '</tr>';
        }).join('') + '</tbody></table>';
    }

    function card(title, body) {
        return '<article class="result-card"><h3>' + escapeHtml(title) + '</h3>' + body + '</article>';
    }

    function renderOverview(result) {
        return '<div class="result-stack">' +
            card(state.lang === 'zh' ? '项目标题' : 'Project Title', '<p>' + escapeHtml(result.project_title || '') + '</p>') +
            card(state.lang === 'zh' ? '一句话简介' : 'Logline', '<p>' + escapeHtml(result.logline || '') + '</p>') +
            card(state.lang === 'zh' ? '改造策略' : 'Adaptation Strategy', '<p>' + escapeHtml(result.adaptation_strategy || '') + '</p>') +
            card(state.lang === 'zh' ? '全球化注意点' : 'Globalization Notes', renderList(result.globalization_notes)) +
            '</div>';
    }

    function renderMapping(result) {
        return '<div class="result-stack">' + card(
            state.lang === 'zh' ? '映射表' : 'Mapping Table',
            renderTable(result.mapping_table, [
                { key: 'source', label: state.lang === 'zh' ? '原素材' : 'Source' },
                { key: 'adapted', label: state.lang === 'zh' ? '改造后' : 'Adapted' },
                { key: 'type', label: state.lang === 'zh' ? '类型' : 'Type' },
                { key: 'rationale', label: state.lang === 'zh' ? '理由' : 'Rationale' }
            ])
        ) + '</div>';
    }

    function renderCharacters(result) {
        var rows = result.character_bible || [];
        return '<div class="result-stack">' + rows.map(function (character) {
            var body = [
                '<p><strong>Role:</strong> ' + escapeHtml(character.role || '') + '</p>',
                '<p><strong>Visual:</strong> ' + escapeHtml(character.visual || '') + '</p>',
                '<p><strong>Motivation:</strong> ' + escapeHtml(character.motivation || '') + '</p>',
                '<p><strong>Arc:</strong> ' + escapeHtml(character.arc || '') + '</p>'
            ].join('');
            return card(character.name || (state.lang === 'zh' ? '未命名人物' : 'Unnamed Character'), body);
        }).join('') + '</div>';
    }

    function renderWorld(result) {
        var world = result.world_bible || {};
        var codex = result.skill_item_codex || [];
        return '<div class="result-stack">' +
            card(state.lang === 'zh' ? '世界设定' : 'Setting', '<p>' + escapeHtml(world.setting || '') + '</p>') +
            card(state.lang === 'zh' ? '势力' : 'Factions', renderList(world.factions)) +
            card(state.lang === 'zh' ? '力量体系' : 'Power System', '<p>' + escapeHtml(world.power_system || '') + '</p>') +
            card(state.lang === 'zh' ? '禁忌规则' : 'Taboo Rules', renderList(world.taboo_rules)) +
            card(state.lang === 'zh' ? '技能/物品' : 'Skills / Items', renderTable(codex, [
                { key: 'name', label: state.lang === 'zh' ? '名称' : 'Name' },
                { key: 'category', label: state.lang === 'zh' ? '类别' : 'Category' },
                { key: 'rule', label: state.lang === 'zh' ? '规则' : 'Rule' },
                { key: 'visual', label: state.lang === 'zh' ? '视觉' : 'Visual' }
            ])) +
            '</div>';
    }

    function renderBeats(result) {
        var rows = result.episode_beats || [];
        return '<div class="result-stack">' + rows.map(function (beat) {
            var characters = Array.isArray(beat.characters) ? beat.characters : [];
            var body = [
                '<p>' + escapeHtml(beat.summary || '') + '</p>',
                '<p><strong>Hook:</strong> ' + escapeHtml(beat.hook || '') + '</p>',
                '<div class="pill-list">' + characters.map(function (name) { return '<span class="pill">' + escapeHtml(name) + '</span>'; }).join('') + '</div>',
                '<p><strong>Visual:</strong> ' + escapeHtml(beat.visual_notes || '') + '</p>'
            ].join('');
            return card(String(beat.index || '') + ' ' + (beat.title || ''), body);
        }).join('') + '</div>';
    }

    function renderScriptMeta(label, value) {
        if (!value) return '';
        return '<span><strong>' + escapeHtml(label) + ':</strong> ' + escapeHtml(value) + '</span>';
    }

    function renderDialogue(lines) {
        if (!Array.isArray(lines) || !lines.length) return '';
        return '<div class="dialogue-list"><strong>' + escapeHtml(scriptLabel('dialogue')) + '</strong>' + lines.map(function (line) {
            if (typeof line === 'string') {
                return '<p class="dialogue-line">' + escapeHtml(line) + '</p>';
            }
            var speaker = line && (line.speaker || line.name) ? line.speaker || line.name : '';
            var value = line && (line.line || line.text || line.dialogue) ? line.line || line.text || line.dialogue : '';
            return '<p class="dialogue-line">' + (speaker ? '<b>' + escapeHtml(speaker) + ':</b> ' : '') + escapeHtml(value) + '</p>';
        }).join('') + '</div>';
    }

    function renderScriptScene(scene, index) {
        scene = scene || {};
        var characters = Array.isArray(scene.characters) ? scene.characters : [];
        return '<section class="script-scene">' +
            '<h4>' + escapeHtml(scriptLabel('scene', scene.scene || index + 1) + (scene.title ? ': ' + scene.title : '')) + '</h4>' +
            '<div class="script-meta">' +
            renderScriptMeta(scriptLabel('location'), scene.location) +
            renderScriptMeta(scriptLabel('time'), scene.time) +
            renderScriptMeta(scriptLabel('characters'), characters.join(', ')) +
            '</div>' +
            (scene.action ? '<p><strong>' + escapeHtml(scriptLabel('action')) + ':</strong> ' + escapeHtml(scene.action) + '</p>' : '') +
            renderDialogue(scene.dialogue) +
            (scene.narration ? '<p><strong>' + escapeHtml(scriptLabel('narration')) + ':</strong> ' + escapeHtml(scene.narration) + '</p>' : '') +
            (scene.visual_notes ? '<p><strong>' + escapeHtml(scriptLabel('visual')) + ':</strong> ' + escapeHtml(scene.visual_notes) + '</p>' : '') +
            (scene.ending_hook ? '<p><strong>' + escapeHtml(scriptLabel('hook')) + ':</strong> ' + escapeHtml(scene.ending_hook) + '</p>' : '') +
            '</section>';
    }

    function renderAdaptedScript(result) {
        var script = result.adapted_script || result.full_script;
        if (!script) {
            return '<div class="result-stack">' + card(text('tab.script'), '<p>' + escapeHtml(scriptLabel('missing')) + '</p>') + '</div>';
        }
        if (typeof script === 'string') {
            return '<div class="result-stack">' + card(text('tab.script'), '<pre class="script-text-block">' + escapeHtml(script) + '</pre>') + '</div>';
        }
        var episodes = Array.isArray(script.episodes) && script.episodes.length
            ? script.episodes
            : Array.isArray(script.scenes) && script.scenes.length
                ? [{ episode: 1, title: script.title || text('tab.script'), scenes: script.scenes }]
                : [];
        var meta = [
            renderScriptMeta(scriptLabel('title'), script.title),
            renderScriptMeta(scriptLabel('format'), script.format),
            renderScriptMeta(scriptLabel('duration'), script.target_duration),
            renderScriptMeta(scriptLabel('premise'), script.premise)
        ].join('');
        var episodeHtml = episodes.map(function (episode, episodeIndex) {
            episode = episode || {};
            var scenes = Array.isArray(episode.scenes) ? episode.scenes : [];
            return '<article class="result-card script-episode">' +
                '<h3>' + escapeHtml(scriptLabel('episode', episode.episode || episodeIndex + 1) + (episode.title ? ': ' + episode.title : '')) + '</h3>' +
                (episode.synopsis ? '<p><strong>' + escapeHtml(scriptLabel('synopsis')) + ':</strong> ' + escapeHtml(episode.synopsis) + '</p>' : '') +
                scenes.map(renderScriptScene).join('') +
                '</article>';
        }).join('');
        return '<div class="result-stack">' +
            '<article class="result-card"><h3>' + escapeHtml(text('tab.script')) + '</h3><div class="script-meta script-meta-hero">' + meta + '</div></article>' +
            (episodeHtml || card(text('tab.script'), '<p>' + escapeHtml(scriptLabel('missing')) + '</p>')) +
            '</div>';
    }

    function renderDrama(result) {
        var handoff = result.handoff_to_drama || {};
        return '<div class="result-stack">' +
            card(state.lang === 'zh' ? '交接提示词' : 'Handoff Prompt', '<p>' + escapeHtml(handoff.drama_prompt || '') + '</p>') +
            card(state.lang === 'zh' ? '提示词规则' : 'Prompt Rules', renderList(handoff.prompt_rules)) +
            card(state.lang === 'zh' ? '风险提醒' : 'Warnings', renderList(handoff.warnings)) +
            card(state.lang === 'zh' ? '开场场景' : 'Opening Scenes', renderList((result.opening_scenes || []).map(function (scene, index) {
                return (index + 1) + '. ' + (scene.title || '') + ' - ' + (scene.story || '') + ' ' + (scene.narration || '');
            }))) +
            '</div>';
    }

    function renderResult() {
        var result = state.result;
        var empty = $('#resultEmpty');
        var content = $('#resultContent');
        var exportBtn = $('#exportHandoffBtn');
        if (!result) {
            if (empty) empty.classList.remove('hidden');
            if (content) content.classList.add('hidden');
            if (exportBtn) exportBtn.disabled = true;
            if ($('#exportPanel')) $('#exportPanel').classList.add('hidden');
            if ($('#exportText')) $('#exportText').value = '';
            return;
        }
        if (empty) empty.classList.add('hidden');
        if (content) content.classList.remove('hidden');
        if (exportBtn) exportBtn.disabled = false;
        var html = '';
        if (activeTab === 'mapping') html = renderMapping(result);
        else if (activeTab === 'characters') html = renderCharacters(result);
        else if (activeTab === 'world') html = renderWorld(result);
        else if (activeTab === 'beats') html = renderBeats(result);
        else if (activeTab === 'script') html = renderAdaptedScript(result);
        else if (activeTab === 'drama') html = renderDrama(result);
        else html = renderOverview(result);
        content.innerHTML = html;
    }

    function startJob() {
        var materials = sourceMaterials();
        if (!materials.length) {
            addLog(state.lang === 'zh' ? '请先填写或上传至少一份参考素材。' : 'Add at least one reference source first.');
            return;
        }
        var button = $('#generateBtn');
        button.disabled = true;
        setStatus('queued', 5);
        addLog(state.lang === 'zh' ? '已提交剧本创作任务。' : 'Script job submitted.');
        apiFetch('/api/script-studio/jobs', {
            method: 'POST',
            body: JSON.stringify({
                language: state.lang,
                targetMarket: state.settings.targetMarket,
                adaptationLevel: state.settings.adaptationLevel,
                genre: state.settings.genre,
                audience: state.settings.audience,
                tone: state.settings.tone,
                notes: state.settings.notes,
                sourceMaterials: materials,
                project: state
            })
        }).then(function (data) {
            pollJob(data.jobId);
        }).catch(function (error) {
            button.disabled = false;
            setStatus('error', 100, error.message);
            addLog((state.lang === 'zh' ? '提交失败：' : 'Submit failed: ') + error.message);
        });
    }

    function pollJob(jobId) {
        if (pollTimer) clearTimeout(pollTimer);
        apiFetch('/api/script-studio/jobs/' + encodeURIComponent(jobId))
            .then(function (job) {
                setStatus(job.status, job.progress, job.error);
                renderLogs(job.logs || []);
                if (job.status === 'done') {
                    state.result = job.result;
                    $('#generateBtn').disabled = false;
                    setStatus('done', 100);
                    renderResult();
                    saveLocal();
                    saveServer(false);
                    return;
                }
                if (job.status === 'error') {
                    $('#generateBtn').disabled = false;
                    setStatus('error', 100, job.error);
                    addLog((state.lang === 'zh' ? '任务失败：' : 'Job failed: ') + (job.error || 'unknown'));
                    return;
                }
                pollTimer = setTimeout(function () { pollJob(jobId); }, 2500);
            })
            .catch(function (error) {
                $('#generateBtn').disabled = false;
                setStatus('error', 100, error.message);
                addLog((state.lang === 'zh' ? '查询失败：' : 'Polling failed: ') + error.message);
            });
    }

    function uploadSource(key, file) {
        if (!file) return;
        var ext = String(file.name || '').split('.').pop().toLowerCase();
        if (!ext || SUPPORTED_UPLOAD_EXTS.indexOf(ext) === -1) {
            addLog(state.lang === 'zh'
                ? '读取失败：当前支持 txt、md、markdown、json、docx、epub。PDF 或旧版 doc 请先另存为 txt/md/docx。'
                : 'Read failed: supported files are txt, md, markdown, json, docx, and epub. Please convert PDF or legacy doc files first.');
            return;
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            addLog(state.lang === 'zh'
                ? '读取失败：文件不能超过 ' + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB。'
                : 'Read failed: file must be under ' + Math.round(MAX_UPLOAD_BYTES / 1024 / 1024) + 'MB.');
            return;
        }
        var form = new FormData();
        form.append('script', file);
        addLog((state.lang === 'zh' ? '正在读取文件：' : 'Reading file: ') + file.name);
        fetch('/api/script-studio/script/read', {
            method: 'POST',
            credentials: 'include',
            body: form
        }).then(function (response) {
            return response.json().catch(function () { return {}; }).then(function (data) {
                if (!response.ok || data.success === false) throw new Error(data.error || 'Upload failed');
                return data;
            });
        }).then(function (data) {
            var textarea = $('[data-source-text="' + key + '"]');
            if (textarea) textarea.value = data.text || '';
            updateCounters();
            saveLocal(true);
            addLog((state.lang === 'zh' ? '已读取：' : 'Loaded: ') + data.filename + ' (' + Number(data.length || 0).toLocaleString() + ' chars)');
            saveServer(false);
        }).catch(function (error) {
            addLog((state.lang === 'zh' ? '读取失败：' : 'Read failed: ') + error.message);
        });
    }

    function exportHandoff() {
        if (!state.result) return;
        return apiFetch('/api/script-studio/export-handoff', {
            method: 'POST',
            body: JSON.stringify({ result: state.result, project: state })
        }).then(function (data) {
            $('#exportPanel').classList.remove('hidden');
            $('#exportText').value = data.text || '';
            state.productionHandoffText = data.text || '';
            state.productionPrefill = data.productionPrefill || null;
            saveLocal();
            addLog(state.lang === 'zh' ? '已生成制作交接文本。' : 'Production handoff text is ready.');
            return data;
        }).catch(function (error) {
            addLog((state.lang === 'zh' ? '导出失败：' : 'Export failed: ') + error.message);
            throw error;
        });
    }

    function storeHandoffImport(data) {
        var prefill = data && data.productionPrefill ? data.productionPrefill : state.productionPrefill;
        if (!prefill || !prefill.scriptText) {
            throw new Error(state.lang === 'zh' ? '没有可保存的交接内容' : 'No production handoff content to save');
        }
        var payload = Object.assign({}, prefill, {
            id: 'script_studio_' + Date.now(),
            importedAt: new Date().toISOString()
        });
        localStorage.setItem(HANDOFF_IMPORT_KEY, JSON.stringify(payload));
        return payload;
    }

    function saveHandoff() {
        if (!state.result) return;
        var button = $('#saveHandoffBtn');
        if (button) button.disabled = true;
        exportHandoff().then(function (data) {
            storeHandoffImport(data);
            if (button) button.disabled = false;
            addLog(state.lang === 'zh' ? '交接包已保存到本地浏览器。' : 'Handoff package saved in local browser storage.');
        }).catch(function (error) {
            if (button) button.disabled = false;
            addLog((state.lang === 'zh' ? '保存失败：' : 'Save failed: ') + error.message);
        });
    }

    function bindEvents() {
        var saveTimer = null;
        var serverSaveTimer = null;
        $all('[data-lang]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var lang = normalizeStudioLang(btn.getAttribute('data-lang'));
                applyLanguage(lang);
            });
        });
        $all('input, select, textarea').forEach(function (el) {
            el.addEventListener('input', function () {
                updateCounters();
                clearTimeout(saveTimer);
                saveTimer = setTimeout(function () { saveLocal(true); }, 500);
                clearTimeout(serverSaveTimer);
                serverSaveTimer = setTimeout(function () { saveServer(false); }, 1800);
            });
            el.addEventListener('change', function () {
                updateCounters();
                saveLocal(true);
                clearTimeout(serverSaveTimer);
                serverSaveTimer = setTimeout(function () { saveServer(false); }, 800);
            });
        });
        $all('[data-source-file]').forEach(function (input) {
            input.addEventListener('change', function () {
                uploadSource(input.getAttribute('data-source-file'), input.files && input.files[0]);
                input.value = '';
            });
        });
        $all('[data-tab]').forEach(function (btn) {
            btn.addEventListener('click', function () {
                activeTab = btn.getAttribute('data-tab');
                $all('[data-tab]').forEach(function (tab) {
                    tab.classList.toggle('active', tab === btn);
                });
                renderResult();
            });
        });
        $('#saveBtn').addEventListener('click', function () { saveServer(true); });
        $('#generateBtn').addEventListener('click', startJob);
        $('#exportHandoffBtn').addEventListener('click', function () {
            exportHandoff().catch(function () {});
        });
        $('#saveHandoffBtn').addEventListener('click', saveHandoff);
        $('#copyExportBtn').addEventListener('click', function () {
            var value = $('#exportText').value || '';
            navigator.clipboard.writeText(value).then(function () {
                addLog(state.lang === 'zh' ? '交接文本已复制。' : 'Handoff text copied.');
            });
        });
        $('#resetBtn').addEventListener('click', function () {
            var ok = window.confirm(state.lang === 'zh' ? '确认清空当前页面内容？' : 'Clear the current page?');
            if (!ok) return;
            localStorage.removeItem(STORAGE_KEY);
            state.result = null;
            state.logs = [];
            state.sources = { plot: '', characters: '', world: '' };
            applyStateToDom();
            renderResult();
            renderLogs();
            setStatus('idle', 0);
            saveServer(false);
        });
    }

    function init() {
        loadLocal();
        state.lang = normalizeStudioLang(localStorage.getItem(GLOBAL_LANGUAGE_KEY) || state.lang || 'en');
        applyStateToDom();
        applyLanguage(state.lang || 'en');
        bindEvents();
        updateCounters();
        renderResult();
        renderLogs();
        loadServer();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
