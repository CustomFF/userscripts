// ==UserScript==
// @name         LinkedIn Settings Overview
// @name:ru      LinkedIn: Все настройки на одной странице
// @namespace    https://github.com/CustomFF/userscripts
// @version      1.0.0
// @description  All LinkedIn settings (account, visibility, data privacy, ads, services, notifications) on one page, with bulk changes and a one-click privacy lockdown.
// @description:ru Все настройки LinkedIn (аккаунт, видимость, данные, реклама, сервисы, уведомления) на одной странице, с массовыми изменениями и отключением сбора данных одной кнопкой.
// @author       DayDve
// @license      MPL-2.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @match        https://www.linkedin.com/*
// @grant        none
// @inject-into  content
// @keywords     linkedin, settings, privacy, notifications, preferences
// ==/UserScript==

/*
 * LinkedIn's settings live in two apps.
 *
 * Account, visibility, data privacy, ads and services are "setting cards" of the
 * settings API: one GET per category returns all its cards with their settings
 * (toggle, radio, dropdown or a group of checkboxes, each of those its own boolean
 * setting), and PUT /mysettings-api/settingsApiSettings/<key> changes one.
 *
 * Notifications are spread over 15 categories and ~80 sub-screens. Each
 * sub-screen's React Server Components data holds the state of its switches and
 * the settingsValueUpdateRequest that turns each one off and on.
 *
 * LinkedIn answers 429 to fast crawling, so the script reads everything one
 * request at a time, caches it and shows it on one page. Every change is a draft
 * until Apply sends the same requests LinkedIn's own controls send.
 */

(function() {
    'use strict';

    const BASE = '/mypreferences/d/';
    const UPDATE_REQUEST = 'com.linkedin.sdui.requests.settings.settingsValueUpdateRequest';
    const CACHE_KEY = 'li-settings-overview-cache';
    const CHANNELS = [['inapp', 'In-app'], ['push', 'Push'], ['email', 'Email']];
    const DELAY = 800;
    const SYNC_ESTIMATE = 'about 3 minutes';
    const NOTIFICATIONS = 'notifications';

    // Blocks in LinkedIn's order: [slug, name, API category]. "Sign in & security" has no settings,
    // only pages for passwords, e-mail addresses, sessions and so on, so it isn't here.
    const CARD_BLOCKS = [
        ['account', 'Account preferences', 'ACCOUNT'],
        ['profile-visibility', 'Visibility', 'PROFILE_VISIBILITY'],
        ['privacy', 'Data privacy', 'PRIVACY'],
        ['ads', 'Advertising data', 'ADS'],
        ['services', 'LinkedIn Services', 'SERVICES']
    ];

    // Cards no subcategory lists (ad targeting by gender and age): card -> subcategory to show it under.
    const EXTRA_CARDS = { ADS: { adsDemographics: 'ACTIVITY_AND_INFERRED_DATA' } };

    // "Privacy lockdown": everything LinkedIn uses to sell your data or to train on it, plus every
    // adsPrivacyAllow* setting. Each is set to its off state.
    const LOCKDOWN = new Set([
        'allowOrganizationToViewMemberPageVisits', 'allowEmailDataExportByConnections',
        'enableSharingOfPersonalAndEngagementDataWithBusinessUsers', 'enableMicrosoftPeopleCard',
        'blockThirdPartyDataSharing', 'allowAnonymizedDataResearch', 'allowDataForGenerativeAI', 'allowLrn',
        'tipsForUsingLinkedinViaEmail', 'allowProfileAndActivityDataForMarketingAds',
        'messagingSmartRepliesAndDataCollection', 'isWorkExperienceVisibleInMicrosoftWord',
        'allowConnections', 'allowCompaniesFollowed', 'allowGroupsJoined', 'allowPersonalizationWithProfileData',
        'allowPostalCode', 'allowLinkedInAudienceNetwork', 'allowUseOfThirdPartyData',
        'allowMemberActivityDataSharingForJobs', 'allowMemberActivityDataSharingForLearning',
        'allowLinkedInActivityData', 'allowIpToPersonalizeAds', 'allowAdsByAge', 'allowAdsByGender',
        'allowConversionTrackings', 'shareDataWithTrustedPartners',
        'advertisingCookieConsent', 'analyticsAndResearchCookieConsent'
    ]);
    const inLockdown = (c) => c.block !== NOTIFICATIONS && (LOCKDOWN.has(c.key) || c.key.startsWith('adsPrivacyAllow'));

    // "Essentials only" for notifications: things that wait for you get in-app + push, things that
    // concern you or may be useful get in-app only, email only where missing it costs something.
    // Everything else is turned off. Keys are notification sub-screen slugs: [in-app, push, email].
    const ESSENTIALS = {
        'direct-messages': [1, 1, 0],
        'inmail': [1, 1, 0],
        'messages-from-candidates': [1, 1, 1],
        'candidate-interviews': [1, 1, 1],
        'job-application-updates': [1, 1, 1],
        'mentions': [1, 1, 0],
        'invitations-to-connect': [1, 1, 0],
        'reminders': [1, 1, 0],
        'page-messaging': [1, 1, 0],
        'billing-reminders': [1, 1, 1],
        'job-alerts': [1, 0, 0],
        'candidate-recommendations': [1, 0, 0],
        'job-referrals': [1, 0, 0],
        'reminders-to-claim-jobs': [1, 0, 0],
        'new-connection-recommendations': [1, 0, 0],
        'new-follow-recommendations': [1, 0, 0],
        'profile-views': [1, 0, 0],
        'breaking-news': [1, 0, 0],
        'saved-jobs': [1, 0, 0],
        'job-post-updates': [1, 0, 0],
        'comments-and-reactions': [1, 0, 0],
        'shares': [1, 0, 0],
        'post-collaborations': [1, 0, 0],
        'new-followers': [1, 0, 0],
        'group-invitations': [1, 0, 0],
        'group-admin-updates': [1, 0, 0],
        'page-invitations': [1, 0, 0],
        'activity-on-your-pages': [1, 0, 0],
        'service-project-updates': [1, 0, 0],
        'reviews-for-your-services': [1, 0, 0],
        'invitations': [1, 0, 0],
        'event-speaker-invitations': [1, 0, 0],
        'event-organizer-updates': [1, 0, 0]
    };

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const el = (tag, props = {}, style = {}, children = []) => {
        const e = Object.assign(document.createElement(tag), props);
        Object.assign(e.style, style);
        e.append(...children);
        return e;
    };

    const plain = (html) => (html || '').replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&').replace(/&#61;/g, '=').replace(/&quot;/g, '"').trim();

    const csrf = () => (document.cookie.match(/(?:^|;\s*)JSESSIONID="?([^";]+)/) || [])[1];

    const apiHeaders = () => ({
        'csrf-token': csrf(),
        accept: 'application/vnd.linkedin.normalized+json+2.1',
        'x-restli-protocol-version': '2.0.0'
    });

    // ---- Loading -------------------------------------------------------------

    // Fetches with retries. When LinkedIn is throttling it answers 429, or 200 with none of the
    // expected content (parse returns nothing); both are retried with a growing pause.
    // optional: a missing resource (404/400) gives null instead of failing the whole sync.
    const fetchParsed = async (url, init, parse, optional = false) => {
        const path = url.replace(location.origin, '');
        for (let attempt = 1; ; attempt++) {
            const res = await fetch(url, { credentials: 'include', ...init });
            if (res.ok) {
                const result = parse(await res.text());
                if (result && Object.keys(result).length) return result;
            } else if (optional && (res.status === 404 || res.status === 400)) {
                return null;
            } else if (res.status !== 429) {
                throw new Error(`${path}: HTTP ${res.status}`);
            }
            if (attempt === 4) throw new Error(`${path}: LinkedIn is throttling requests`);
            await sleep(10000 * attempt);
        }
    };

    // A settings screen's React Server Components data (~12 KB over the wire).
    const screen = (path, parse) => fetchParsed(`${location.origin}/flagship-web${BASE}${path}/`,
        { headers: { 'x-li-rsc-stream': 'true' } }, parse);

    const api = (path, parse, optional) => fetchParsed(`${location.origin}/mysettings-api/${path}`,
        { headers: apiHeaders() }, (text) => parse(JSON.parse(text)), optional);

    // Runs step(item) for each item, one request at a time, reporting progress.
    const eachSlowly = async (items, label, progress, step) => {
        for (const [i, item] of items.entries()) {
            progress(`${label}: ${i + 1} of ${items.length}`, (i + 1) / items.length);
            await sleep(DELAY);
            await step(item);
        }
    };

    // Notification screens link to the next level as {"title":...,"url":...} navigation actions.
    const links = (rsc, kind) => {
        const out = new Map();
        const re = new RegExp(`"title":"((?:[^"\\\\]|\\\\.)*)","url":"${BASE}${kind}/([^/"]+)/"`, 'g');
        for (const m of rsc.matchAll(re)) if (!out.has(m[2])) out.set(m[2], JSON.parse(`"${m[1]}"`));
        return [...out].map(([slug, name]) => ({ slug, name }));
    };

    const PAYLOAD = /\{"settingIds":\[[^\]]*\],"valueTypes":\[[^\]]*\],"values":\[[^\]]*\],"categoryKey":"[^"]*"\}/g;

    // A notification sub-screen: each switch (found by its tracking name) with its state, which
    // lives in the screen's modelStates, and the payloads that turn it off and on.
    const parseNotificationScreen = (rsc) => {
        const marks = [...rsc.matchAll(/notification-subcategory-channel-([a-z]+)-toggle/g)];
        const switches = {};
        marks.forEach((m, i) => {
            const part = rsc.slice(m.index, i + 1 < marks.length ? marks[i + 1].index : m.index + 30000);
            const key = (part.match(/"id":"(notifChannel-[^"]+)"/) || [])[1];
            const state = key && rsc.match(new RegExp(`"id":"${key}"\\}\\}\\},"value":\\{"\\$case":"booleanValue","booleanValue":(true|false)`));
            const [off, on] = [...part.matchAll(PAYLOAD)].map(p => JSON.parse(p[0]));
            if (state && off && on) switches[m[1]] = { id: on.settingIds[0], value: state[1], off, on };
        });
        return switches;
    };

    // The setting as PUT expects it back: without nulls and the type marker.
    const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => v !== null && k !== '$type'));

    const bool = (key, label, value, body, onValue = 'true', offValue = 'false') =>
        ({ key, label, type: 'bool', value, onValue, offValue, body });

    // A setting card: its settings (and their child settings, e.g. the cookie types under
    // "Cookies") as controls. `by` resolves the URNs of the response's "included" entities.
    const parseCard = (card, by) => {
        const controls = [];
        const add = (urn, parent) => {
            const s = by[urn];
            if (!s) return;
            const label = [parent, plain(s.toggleLabel || s.name || s.primaryDescription || card.title)].filter(Boolean).join(': ');
            switch (s.settingDisplayType) {
                case 'CHECKBOX':
                    // Each checkbox is a boolean setting of its own, labelled by its option (the card
                    // title above says what they are about); multi-value lists (content languages, ad
                    // interest segments) have no keys and are left out.
                    for (const o of s.settingDisplayValues || []) {
                        if (!o.key || !o.settingType) continue;
                        controls.push(bool(o.key, plain(o.settingDisplayValue), String(!!o.selected),
                            { entityUrn: o.settingType, key: o.key, settingDisplayType: 'UNKNOWN', hasChild: false }));
                    }
                    break;
                case 'TOGGLE':
                    // Some toggles report the same on and off value; they are plain booleans.
                    controls.push(bool(s.key, label, s.value, clean(s),
                        ...(s.onValue === s.offValue ? [] : [s.onValue, s.offValue])));
                    break;
                case 'RADIO':
                case 'DROPDOWN':
                    if (s.settingDisplayValues) {
                        controls.push({
                            key: s.key, label, type: 'choice', value: s.value, body: clean(s),
                            options: s.settingDisplayValues.map(o => [o.value, plain(o.settingDisplayValue)])
                        });
                    }
            }
            for (const child of s['*childSettings'] || []) add(child, label);
        };
        for (const urn of card['*settings'] || []) add(urn, '');
        return controls.length ? { key: card.key, title: plain(card.title || card.name), sub: card.subcategoryKey, controls } : null;
    };

    const byUrn = (json) => Object.fromEntries((json.included || []).map(x => [x.entityUrn, x]));

    // One request per category returns all its cards; they are grouped by subcategory.
    const loadCardBlocks = async (progress) => {
        const categories = Object.fromEntries((await api('settingsApiCategories', j => j.included)).map(c => [c.key, c]));
        const blocks = [];
        await eachSlowly(CARD_BLOCKS, 'Reading settings', progress, async ([slug, name, key]) => {
            const subs = (categories[key]?.['*subcategories'] || []).map(urn => urn.split(':').pop());
            const cards = await api(`settingsApiSettingCards?q=subcategory&keys=List(${subs.join(',')})`, (j) => {
                const by = byUrn(j);
                return j.data['*elements'].map(urn => by[urn] && parseCard(by[urn], by)).filter(Boolean);
            });
            for (const [extra, sub] of Object.entries(EXTRA_CARDS[key] || {})) {
                await sleep(DELAY);
                const card = await api(`settingsApiSettingCards/${extra}`, j => parseCard(j.data, byUrn(j)), true);
                if (card) cards.push({ ...card, sub });
            }
            const groups = new Map();
            for (const card of cards) {
                const group = categories[card.sub]?.name || '';
                groups.set(group, [...(groups.get(group) || []), card]);
            }
            blocks.push({ slug, name, kind: 'cards', groups: [...groups].map(([name, cards]) => ({ name, cards })) });
        });
        return blocks;
    };

    // Notifications: categories, their sub-screens, then every sub-screen.
    const loadNotifications = async (progress) => {
        const cats = await screen('categories/notifications', rsc => links(rsc, 'notification-categories'));
        await eachSlowly(cats, 'Reading notification categories', progress, async (cat) => {
            cat.subs = await screen(`notification-categories/${cat.slug}`, rsc => links(rsc, 'notification-subcategories'));
        });
        await eachSlowly(cats.flatMap(c => c.subs), 'Reading notification settings', progress, async (sub) => {
            sub.switches = await screen(`notification-subcategories/${sub.slug}`, parseNotificationScreen);
        });
        return { slug: NOTIFICATIONS, name: 'Notifications', kind: NOTIFICATIONS, cats };
    };

    const load = async (progress) => [...await loadCardBlocks(progress), await loadNotifications(progress)];

    const readCache = () => {
        try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch (e) { return null; }
    };

    const writeCache = () => {
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ time: Date.now(), blocks })); } catch (e) { /* storage blocked */ }
    };

    // ---- Updating ------------------------------------------------------------

    const updateNotification = async (payload) => {
        const requestedArguments = {
            $type: 'proto.sdui.actions.requests.RequestedArguments',
            requestedStateKeys: [],
            payload,
            requestMetadata: { $type: 'proto.sdui.common.RequestMetadata' }
        };
        const res = await fetch(`${location.origin}/flagship-web/rsc-action/actions/server-request?sduiid=${UPDATE_REQUEST}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'csrf-token': csrf(), 'content-type': 'application/json', 'x-li-rsc-stream': 'true' },
            body: JSON.stringify({
                requestId: UPDATE_REQUEST,
                serverRequest: { requestId: UPDATE_REQUEST, requestedArguments, isApfcEnabled: false, isStreaming: false, rumPageKey: '' },
                states: [],
                requestedArguments: { ...requestedArguments, states: [], screenId: '', knownTemplateIds: [] }
            })
        });
        const text = await res.text();
        if (!res.ok || /"errors":\[\{/.test(text)) throw new Error(`HTTP ${res.status}`);
    };

    // Some settings are written with ?doCustomUpdate=true (LinkedIn's own page sends it for them) and
    // are rejected without it, others the other way round; a 400 is retried with it.
    const updateSetting = async (c, value) => {
        let res;
        for (const query of ['', '?doCustomUpdate=true']) {
            res = await fetch(`${location.origin}/mysettings-api/settingsApiSettings/${c.key}${query}`, {
                method: 'PUT',
                credentials: 'include',
                headers: { ...apiHeaders(), 'content-type': 'application/json' },
                body: JSON.stringify({ ...c.body, value })
            });
            if (res.status !== 400) break;
            await sleep(300);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
    };

    // ---- Model -----------------------------------------------------------------

    // Every editable thing is a control {uid, block, type, value, onValue, offValue, ...}: a card
    // setting or a notification switch, indexed in place in the loaded blocks, so applying a change
    // updates what gets cached. The page edits a draft (uid -> value) and Apply sends the difference.
    let blocks = null;
    let controls = new Map();
    let draft = new Map();

    const index = () => {
        controls = new Map();
        const add = (c, uid, props) => controls.set(uid, Object.assign(c, { uid }, props));
        for (const b of blocks) {
            if (b.kind === 'cards') {
                for (const g of b.groups) for (const card of g.cards) for (const c of card.controls) {
                    add(c, `card:${c.key}`, { block: b.slug });
                }
            } else {
                for (const cat of b.cats) for (const sub of cat.subs) for (const [channel, sw] of Object.entries(sub.switches || {})) {
                    add(sw, `notif:${sw.id}`, { block: b.slug, type: 'bool', onValue: 'true', offValue: 'false', channel, slug: sub.slug });
                }
            }
        }
        draft = new Map([...controls].map(([uid, c]) => [uid, c.value]));
    };

    const controlsOf = (block, channel) => [...controls.values()]
        .filter(c => (!block || c.block === block) && (!channel || c.channel === channel));

    const changedIn = (block) => controlsOf(block).filter(c => draft.get(c.uid) !== c.value);

    // Turning a notification off also turns off what LinkedIn links to it (in-app off turns push off).
    const setDraft = (c, value) => {
        draft.set(c.uid, value);
        if (c.block === NOTIFICATIONS && value === 'false') for (const id of c.off.settingIds) draft.set(`notif:${id}`, 'false');
    };

    const setBool = (c, on) => setDraft(c, on ? c.onValue : c.offValue);

    // ---- UI --------------------------------------------------------------------

    let overlay = null;
    let panelBody = null;
    let status = null;
    const topButtons = {};
    const blockButtons = new Map();

    const button = (text, onclick, primary) => el('button', { innerText: text, onclick }, {
        border: '1px solid #0a66c2', color: primary ? '#fff' : '#0a66c2', background: primary ? '#0a66c2' : '#fff',
        borderRadius: '16px', padding: '4px 14px', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap'
    });

    const enable = (btn, on) => {
        btn.disabled = !on;
        btn.style.opacity = on ? '1' : '0.4';
        btn.style.cursor = on ? 'pointer' : 'default';
    };

    // Shows the draft: inputs, changed rows highlighted, "check all" boxes, button states.
    const showDraft = () => {
        for (const input of overlay.querySelectorAll('[data-ctl]')) {
            const c = controls.get(input.dataset.ctl);
            const v = draft.get(c.uid);
            if (input.type === 'checkbox') input.checked = v === c.onValue;
            else input.value = v;
            (input.closest('[data-row]') || input.parentElement).style.background = v !== c.value ? '#fff3c4' : '';
        }
        for (const box of overlay.querySelectorAll('[data-group]')) {
            const list = controlsOf(box.dataset.group, box.dataset.channel).filter(c => c.type === 'bool');
            const on = list.filter(c => draft.get(c.uid) === c.onValue).length;
            box.checked = on > 0 && on === list.length;
            box.indeterminate = on > 0 && !box.checked;
        }
        for (const [block, { apply, reset, count }] of blockButtons) {
            const n = changedIn(block).length;
            enable(apply, n > 0);
            enable(reset, n > 0);
            count.innerText = n ? `${n} unsaved` : '';
        }
        const any = !!blocks && changedIn().length > 0;
        enable(topButtons.apply, any);
        enable(topButtons.reset, any);
        enable(topButtons.lockdown, !!blocks);
    };

    // A cover over the panel with a progress bar; it also blocks the page meanwhile.
    const showProgress = () => {
        const label = el('div', {}, { fontSize: '16px', fontWeight: '600', marginBottom: '12px', textAlign: 'center' });
        const bar = el('div', {}, { height: '100%', width: '0', background: '#0a66c2', transition: 'width 0.2s' });
        const cover = el('div', {}, {
            position: 'absolute', inset: '0', zIndex: '3', borderRadius: '8px', background: 'rgba(255,255,255,0.85)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center'
        }, [label, el('div', {}, { width: '60%', height: '8px', borderRadius: '4px', background: '#ddd', overflow: 'hidden' }, [bar])]);
        overlay.firstElementChild.append(cover);
        return {
            set: (text, fraction) => { label.innerText = text; bar.style.width = `${fraction * 100}%`; },
            done: () => cover.remove()
        };
    };

    // Sends the draft's changes one request at a time, so LinkedIn doesn't answer 429.
    // Offs go first: turning in-app off turns push off, and a push the draft keeps on is then
    // turned back on.
    const apply = async (block) => {
        const todo = changedIn(block).sort((a, b) => (draft.get(a.uid) === a.onValue) - (draft.get(b.uid) === b.onValue));
        const progress = showProgress();
        let failed = 0;
        for (const [i, c] of todo.entries()) {
            progress.set(`Applying changes: ${i + 1} of ${todo.length}`, (i + 1) / todo.length);
            const value = draft.get(c.uid);
            if (c.value === value) continue; // already switched by a linked setting
            try {
                if (c.block === NOTIFICATIONS) {
                    const payload = value === 'true' ? c.on : c.off;
                    await updateNotification(payload);
                    payload.settingIds.forEach((id, k) => {
                        const linked = controls.get(`notif:${id}`);
                        if (linked) linked.value = payload.values[k] === 'TRUE' ? 'true' : 'false';
                    });
                } else {
                    await updateSetting(c, value);
                    c.value = value;
                }
            } catch (e) {
                failed++;
            }
            await sleep(300);
        }
        writeCache();
        progress.done();
        showDraft();
        const left = changedIn(block).length;
        status.innerText = left ? `${left} changes were not applied${failed ? '' : ' (LinkedIn links these settings)'}` : 'Applied';
    };

    // Draft helpers bound to buttons; each redraws the draft.
    const edit = (fn) => (...args) => { fn(...args); showDraft(); };

    const reset = edit((block) => { for (const c of controlsOf(block)) draft.set(c.uid, c.value); });

    const lockdown = edit(() => { for (const c of controlsOf().filter(inLockdown)) setBool(c, false); });

    const essentials = edit(() => {
        for (const c of controlsOf(NOTIFICATIONS)) {
            // Set directly, without setDraft's linking: every switch gets its own value here.
            const want = ESSENTIALS[c.slug] || [0, 0, 0];
            draft.set(c.uid, want[CHANNELS.findIndex(([key]) => key === c.channel)] ? c.onValue : c.offValue);
        }
    });

    // "Check all" for a block or one notification channel of it.
    const groupBox = (block, channel) => {
        const box = el('input', { type: 'checkbox', title: 'Check or uncheck all' }, { cursor: 'pointer', width: '16px', height: '16px' });
        box.dataset.group = block;
        if (channel) box.dataset.channel = channel;
        box.onchange = edit(() => { for (const c of controlsOf(block, channel)) if (c.type === 'bool') setBool(c, box.checked); });
        return box;
    };

    const input = (c) => {
        const i = c.type === 'bool'
            ? el('input', { type: 'checkbox' }, { cursor: 'pointer', width: '16px', height: '16px', flex: 'none' })
            : el('select', {}, { maxWidth: '240px', flex: 'none' }, c.options.map(([value, label]) => el('option', { value, innerText: label })));
        i.onchange = edit(() => (c.type === 'bool' ? setBool(c, i.checked) : setDraft(c, i.value)));
        i.dataset.ctl = c.uid;
        return i;
    };

    const renderCards = (b, content) => {
        for (const g of b.groups) {
            if (g.name) content.append(el('div', { innerText: g.name }, { fontWeight: '700', margin: '14px 0 4px', color: '#444' }));
            for (const card of g.cards) {
                content.append(el('div', { innerText: card.title }, { fontWeight: '600', margin: '10px 0 2px 8px' }));
                for (const c of card.controls) {
                    const row = el('label', {}, {
                        display: 'flex', alignItems: 'center', gap: '10px', padding: '4px 8px 4px 20px',
                        borderBottom: '1px solid #f0f0f0', cursor: 'pointer'
                    }, [el('span', { innerText: c.label }, { flex: '1' }), input(c)]);
                    row.dataset.row = '1';
                    content.append(row);
                }
            }
        }
    };

    const renderNotifications = (b, content) => {
        const th = (children, style = {}) => el('th', {}, { padding: '6px 8px', textAlign: 'center', ...style }, children);
        const tbody = el('tbody');
        for (const cat of b.cats) {
            tbody.append(el('tr', {}, {}, [el('td', { colSpan: 4, innerText: cat.name },
                { padding: '14px 8px 4px', fontWeight: '700', color: '#444', borderBottom: '1px solid #ccc' })]));
            for (const sub of cat.subs) {
                const link = el('a', { href: `${BASE}notification-subcategories/${sub.slug}/`, target: '_blank', innerText: sub.name },
                    { color: 'inherit' });
                tbody.append(el('tr', {}, { borderBottom: '1px solid #f0f0f0' }, [
                    el('td', {}, { padding: '4px 8px 4px 20px' }, [link]),
                    ...CHANNELS.map(([key]) => {
                        const sw = sub.switches && sub.switches[key];
                        return el('td', {}, { textAlign: 'center', padding: '4px 8px' }, sw ? [input(sw)] : []);
                    })
                ]));
            }
        }
        const head = el('tr', {}, {}, [th([], { textAlign: 'left' }), ...CHANNELS.map(([key, label]) => th([label, el('br'), groupBox(b.slug, key)]))]);
        content.append(el('table', {}, { borderCollapse: 'collapse', width: '100%' }, [el('thead', {}, {}, [head]), tbody]));
    };

    // What a block header offers besides Apply and Reset.
    const blockTools = (b) => {
        if (b.kind === NOTIFICATIONS) return [button('Essentials only', essentials)];
        if (!controlsOf(b.slug).some(c => c.type === 'bool')) return [];
        return [el('label', { title: 'Check or uncheck all switches of this block' },
            { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px', fontWeight: '400', cursor: 'pointer' },
            [groupBox(b.slug), 'all'])];
    };

    // A block: a sticky header whose title collapses and expands the content.
    const renderBlock = (b) => {
        const content = el('div', {}, { padding: '4px 0 16px', fontSize: '14px' });
        if (b.kind === NOTIFICATIONS) renderNotifications(b, content); else renderCards(b, content);
        const arrow = el('span', { innerText: '▾' }, { display: 'inline-block', width: '14px' });
        const title = el('span', {}, { cursor: 'pointer', userSelect: 'none' }, [arrow, b.name]);
        title.onclick = () => {
            const hide = content.style.display !== 'none';
            content.style.display = hide ? 'none' : '';
            arrow.innerText = hide ? '▸' : '▾';
        };
        const buttons = {
            apply: button('Apply', () => apply(b.slug), true),
            reset: button('Reset', () => reset(b.slug)),
            count: el('span', {}, { color: '#b58100', fontSize: '13px', fontWeight: '400' })
        };
        blockButtons.set(b.slug, buttons);
        const header = el('div', {}, {
            display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', fontSize: '17px', fontWeight: '700',
            borderBottom: '1px solid #ddd', position: 'sticky', top: '0', background: '#fff', zIndex: '2'
        }, [title, buttons.count, el('span', {}, { flex: '1' }), ...blockTools(b), buttons.apply, buttons.reset]);
        return el('section', {}, {}, [header, content]);
    };

    const render = () => {
        index();
        blockButtons.clear();
        panelBody.replaceChildren(...blocks.map(renderBlock));
        showDraft();
    };

    const renderEmpty = () => {
        panelBody.replaceChildren(el('div', {}, {
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '12px',
            height: '100%', minHeight: '300px', textAlign: 'center', color: '#444'
        }, [
            el('div', { innerText: 'The settings are not loaded yet.' }, { fontSize: '16px' }),
            button('Build enhanced settings data', () => sync(false), true),
            el('div', { innerText: `Reads all your settings from LinkedIn one page at a time; takes ${SYNC_ESTIMATE}.` },
                { fontSize: '13px', color: '#666' })
        ]));
        showDraft();
    };

    const sync = async (ask) => {
        if (ask && !confirm(`Sync reads all your settings from LinkedIn one page at a time (about 100 requests) `
            + `and takes ${SYNC_ESTIMATE}. Unapplied changes will be lost. Continue?`)) return;
        const progress = showProgress();
        try {
            blocks = await load(progress.set);
            writeCache();
            status.innerText = 'Synced just now';
            render();
        } catch (e) {
            status.innerText = `Sync failed: ${e.message}. Try again in a minute.`;
        }
        progress.done();
    };

    const close = () => { if (overlay) overlay.style.display = 'none'; };

    const open = () => {
        if (overlay) { overlay.style.display = 'flex'; return; }
        status = el('span', {}, { color: '#666', fontSize: '13px' });
        panelBody = el('div', {}, { overflow: 'auto', flex: '1', padding: '0 20px 20px' });
        topButtons.lockdown = Object.assign(button('Privacy lockdown', lockdown), {
            title: 'Uncheck everything LinkedIn uses to sell or share your data or to train AI: ad personalization and '
                + 'targeting, advertising and analytics cookies, partner data, data for AI and research, marketing e-mails, '
                + 'visibility outside LinkedIn. Nothing changes until you press Apply.'
        });
        topButtons.apply = button('Apply all', () => apply(), true);
        topButtons.reset = button('Reset all', () => reset());
        const header = el('div', {}, {
            display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 20px', borderBottom: '1px solid #ddd', flexWrap: 'wrap'
        }, [
            el('b', { innerText: 'All LinkedIn settings' }, { fontSize: '18px' }),
            status,
            el('span', {}, { flex: '1' }),
            topButtons.lockdown, topButtons.apply, topButtons.reset,
            button('Sync data', () => sync(true)),
            button('Close', close)
        ]);
        const panel = el('div', {}, {
            position: 'relative', background: '#fff', color: '#000', borderRadius: '8px', width: 'min(1000px, 96vw)',
            height: '92vh', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(0,0,0,0.3)'
        }, [header, panelBody]);
        overlay = el('div', {}, {
            position: 'fixed', inset: '0', zIndex: '100000', background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }, [panel]);
        overlay.onclick = (e) => { if (e.target === overlay) close(); };
        document.body.append(overlay);

        const cache = readCache();
        if (cache && cache.blocks) {
            blocks = cache.blocks;
            status.innerText = `Synced ${new Date(cache.time).toLocaleString()}`;
            render();
        } else {
            renderEmpty();
        }
    };

    // ---- Entry -----------------------------------------------------------------

    // "All settings" in LinkedIn's settings menu, or a floating button when the menu isn't there.
    const ENTRY_ID = 'li-settings-overview-entry';
    const SLIDERS = 'M3 5h9v2H3zM16 5h5v2h-5zM12 3h2v6h-2zM3 11h3v2H3zM10 11h11v2H10zM6 9h2v6H6zM3 17h12v2H3zM19 17h2v2h-2zM15 15h2v6h-2z';

    // A copy of the Notifications item with our text and a "sliders" icon instead of the bell.
    const menuItem = (item) => {
        const node = item.cloneNode(true);
        for (const e of [node, ...node.querySelectorAll('*')]) {
            e.removeAttribute('href');
            e.removeAttribute('aria-current');
        }
        const text = [...node.querySelectorAll('*')].reverse().find(e => !e.children.length && e.textContent.trim());
        if (text) text.textContent = 'All settings';
        const svg = node.querySelector('svg');
        if (svg) {
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('fill', 'currentColor');
            path.setAttribute('d', SLIDERS);
            svg.removeAttribute('id');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.replaceChildren(path);
        }
        node.style.cursor = 'pointer';
        return node;
    };

    const floatingButton = () => el('button', { innerText: 'All settings' }, {
        position: 'fixed', right: '24px', bottom: '24px', zIndex: '99999', background: '#0a66c2', color: '#fff',
        border: 'none', borderRadius: '20px', padding: '10px 18px', fontWeight: '600', fontSize: '14px',
        cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)'
    });

    // Runs on every DOM change: LinkedIn is a single-page app and rebuilds its menu.
    const entry = () => {
        const existing = document.getElementById(ENTRY_ID);
        if (!location.pathname.startsWith('/mypreferences/')) {
            if (existing) existing.remove();
            close();
            return;
        }
        const menuLink = document.querySelector(`nav[aria-label="Settings"] li a[href*="${BASE}categories/notifications/"]`);
        if (existing && (existing.tagName === 'LI') === !!menuLink) return;
        if (existing) existing.remove();
        const node = menuLink ? menuItem(menuLink.closest('li')) : floatingButton();
        if (menuLink) menuLink.closest('li').after(node); else document.body.append(node);
        node.id = ENTRY_ID;
        node.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); open(); }, true);
    };

    new MutationObserver(entry).observe(document.body, { childList: true, subtree: true });
    entry();
})();
