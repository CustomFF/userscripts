// ==UserScript==
// @name         LT VIISP -> Swedbank Auto
// @name:ru      LT VIISP -> Swedbank Auto
// @name:lt      LT VIISP -> Swedbank Auto
// @namespace    http://tampermonkey.net/
// @version      2.1.0
// @description  Automates Swedbank authentication on Lithuanian government portals.
// @description:ru Автоматизация авторизации через Swedbank на госпорталах Литвы.
// @description:lt Automatizuoja prisijungimą per Swedbank Lietuvos valstybiniuose portaluose.
// @author       DayDve
// @license      MPL-2.0
// @icon         data:image/gif;base64,R0lGODlhIAAgAOMIANMUAMdHBKNZAoBmADN/AE55AOyTGv3OKP///////////////////////////////yH5BAEKAAgALAAAAAAgACAAAAT+ECEyK702Yyw7+WAojmM3fQWRrmrLvqJHDEFt38Kt18NnfgKAcCg0HA4GYY0oFPh+A+bwiAQEglInRYYdBqjHWuFG1G5PXauRmhzQwuWnBOhdH5OCQu6ebMrRRWBhATMBdlUAWj8EQV+CAQApA4dHfnJ0AIIGAT1jBkZ2kIpcAJQAPR9uUY5IV38Te2BXKSE0hwajc4yHPAW0KoaaA7Q/AnabVmIqsWAGqIvMd62SrGyuZ3OrgkhOBaWaQs8yq5QBvnubhp/h2HNjanzmUYhM5u0oXTannvRx7Sc06g2IBUlKChPQmAhg1ocIqn/ucqyT2OxTOmIIdQFLB8mQx00vnwi9QnhBj5QsGDMuSlXw5EOVKi8sQwkCJkwRenqFsMnzBIhfI3uS9BlUqFGjEQAAOw==
// @match        *://migracija.lt/*
// @match        *://*.migracija.lt/*
// @match        *://*.sodra.lt/*
// @match        *://sodra.lt/*
// @match        *://*.esveikata.lt/*
// @match        *://*.epaslaugos.lt/*
// @match        *://sso-espbi.registrucentras.lt/*
// @match        *://log-in.swedbank.lt/*
// @match        *://www.swedbank.lt/banklink/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-start
// @keywords     esveikata, migracija, migris, sodra, lithuania, swedbank, viisp
// ==/UserScript==

/*
 * How it works: the button on each portal starts that portal's own login flow.
 * On every page of the flow after that the script calls the same API the page
 * itself would call and moves on at once, hiding the page behind a "logging
 * in" screen. The only page you see is the Swedbank login.
 *
 * The "▾" next to the button lists the Swedbank IDs you have logged in with
 * (the asmens kodas is kept too, for when the bank asks for it). Picking one
 * fills in and submits the Swedbank login as well, so the only thing left on
 * screen is the bank's code to confirm on the phone.
 *
 *   eSveikata  -> sso.esveikata.lt -> Keycloak (sso-espbi.registrucentras.lt):
 *                 straight to its "valdžios vartai" login link
 *              -> e. vartai: the Swedbank provider (providers API)
 *              -> Swedbank: login (manual), "Send the data"
 *              -> e. vartai: personal data transfer (redirect-information API)
 *              -> sso.esveikata.lt: the patient account (accounts API)
 *              -> pacientas.esveikata.lt/pp
 *   Migris     -> /auth/viisp-start (the site's own VIISP start page)
 *              -> e. vartai -> Swedbank -> e. vartai, as above
 *   Sodra      -> gyventojai.sodra.lt/sodra-login/info?systemId=1 (opens the
 *                 resident login session)
 *              -> its direct Swedbank banklink (id=10), no e. vartai at all
 *              -> Swedbank: login, "Send the data" -> Mano Sodra
 *
 * Each automatic step only runs while a flow started by our button is waiting
 * for exactly that step, so visiting those pages on your own behaves as usual.
 * If an API call fails, the page is shown and the step falls back to clicking
 * the page's own button.
 */
(function () {
    'use strict';

    const CONFIG = {
        KEY_STATE: 'unified_flow_state',
        KEY_ACCOUNTS: 'swed_accounts',
        KEY_HISTORY: 'swed_ids_history', // pre-2.0 list of bare IDs, read once
        FLOW_TTL_MS: 5 * 60 * 1000,
        ACCOUNTS_MAX: 5,
        BTN_TITLE: 'Auth via SB',
        COLOR: '#ec6800',

        MIGRIS_START: '/auth/viisp-start',
        SODRA_LOGIN: 'https://gyventojai.sodra.lt/sodra-login/info?systemId=1',
        SODRA_SWEDBANK: 'https://gyventojai.sodra.lt/sodra-login/send.form?id=10&type=bank',
        ESVEIKATA_LOGIN: 'https://sso.esveikata.lt/espbi-sso/oauth2/authorization/keycloak?portal=ESPBI',
        EVV_TICKET_KEY: 'ticketId', // where the e. vartai app keeps the ticket (localStorage)

        SB_ICON: `
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
               style="vertical-align: middle; margin-right: 8px; flex: none;">
           <path d="m8.6 7.5c0.57-1.6 2.6-2 4.1-1.7 0.88 0.6 2.2 0.48 2.9 1.2 0.51 0.62 0.76
                    1.4 1.1 2.1 0.97-0.18 1.3 0.87 1.5 1.4 0.81 0.39 2 1.8 0.97 2.5 0.6 1.1-0.57
                    1.7-1.6 1.6-0.97 0.014-2.1 0.13-3-0.4l-1.1-0.49c-0.55 0.88-0.11 2.1 0.97
                    2.1 0.29 1.4-1.7 0.68-2.4 0.59-0.78 0.085-3 0.72-2.4-0.69 1.1 5e-3 1.7-1.8
                    0.74-2-1.1 0.88-2.8 1.4-4.2 0.75-0.71-0.22-2.2-0.15-1.5-1.4-0.53-0.88
                    0.51-0.83 0.97-1.3 0.36-0.18 0.48-0.5 0.53-0.88 0.081-0.75 0.18-1.8 1.2-1.8
                    0.61-0.18 0.037-1.1 0.88-0.96 0.37-0.13 0.45-0.56 0.34-0.88z"
                 fill="#fff" stroke="none"/>
           <circle cx="12" cy="12" r="11" fill="none" stroke="#fff" stroke-width="2"/>
          </svg>`
    };

    // --- Flow state (shared between all the sites through GM storage) ---
    // { site, step, ts, ...data }: `step` is the next automatic action to do.
    const Flow = {
        get() {
            const s = GM_getValue(CONFIG.KEY_STATE, null);
            if (!s || !s.ts || Date.now() - s.ts > CONFIG.FLOW_TTL_MS) return null;
            return s;
        },
        start(site, step, data = {}) { GM_setValue(CONFIG.KEY_STATE, { ...data, site, step, ts: Date.now() }); },
        waiting(step) { return Flow.get()?.step === step; },
        // If `step` is the one waiting: returns the flow and moves it on to
        // `next` (null = nothing more to do). Otherwise returns null.
        take(step, next = null, data = {}) {
            const s = Flow.get();
            if (!s || s.step !== step) return null;
            Flow.start(s.site, typeof next === 'function' ? next(s.site) : next, { ...s, ...data });
            return s;
        },
        // Adds/changes data of the running flow without touching its step.
        update(data) {
            const s = Flow.get();
            if (s) GM_setValue(CONFIG.KEY_STATE, { ...s, ...data });
        },
        end() { GM_setValue(CONFIG.KEY_STATE, null); }
    };

    // --- Saved Swedbank logins: { id, ak, method }, newest first ---
    // id = Swedbank user ID, ak = asmens kodas (only asked while the bank
    // doesn't remember the ID), method = login tab (SIMPLE_ID / SMART_ID).
    // Recorded from the logins you type on the Swedbank page yourself.
    const Accounts = {
        list() {
            const a = GM_getValue(CONFIG.KEY_ACCOUNTS, null);
            if (a) return a;
            return GM_getValue(CONFIG.KEY_HISTORY, []).map((id) => ({ id }));
        },
        find(id) { return Accounts.list().find((a) => a.id === id) || null; },
        save(rec) {
            const old = Accounts.find(rec.id) || {};
            const fresh = Object.fromEntries(Object.entries(rec).filter(([, v]) => v));
            const list = [{ ...old, ...fresh }, ...Accounts.list().filter((a) => a.id !== rec.id)];
            GM_setValue(CONFIG.KEY_ACCOUNTS, list.slice(0, CONFIG.ACCOUNTS_MAX));
        },
        remove(id) { GM_setValue(CONFIG.KEY_ACCOUNTS, Accounts.list().filter((a) => a.id !== id)); }
    };

    // --- Helpers ---
    const el = (tag, props = {}, css = '') => {
        const e = document.createElement(tag);
        Object.assign(e, props);
        if (css) e.style.cssText = css;
        return e;
    };

    const ready = (fn) => {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
        else fn();
    };

    // Re-runs `fn` whenever the page changes (SPAs re-render their headers).
    const keep = (fn) => ready(() => {
        fn();
        new MutationObserver(fn).observe(document.body, { childList: true, subtree: true });
    });

    // Calls `cb` once with the first element matching `sel`.
    const waitFor = (sel, cb, timeoutMs = 20000) => ready(() => {
        const found = document.querySelector(sel);
        if (found) return cb(found);
        const obs = new MutationObserver(() => {
            const e = document.querySelector(sel);
            if (e) { obs.disconnect(); cb(e); }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), timeoutMs);
    });

    // Navigates by POSTing a form (what the sites themselves do between steps).
    const postForm = (action, fields) => {
        const form = el('form', { method: 'POST', action }, 'display: none;');
        for (const [name, value] of Object.entries(fields)) {
            form.appendChild(el('input', { type: 'hidden', name, value: value ?? '' }));
        }
        (document.body || document.documentElement).appendChild(form);
        form.submit();
    };

    // Same-origin call to the page's own API. Sends the XSRF header the
    // way Angular/AngularJS do when the site has set the XSRF-TOKEN cookie.
    const api = async (url, { method = 'GET', body, headers: extra = {} } = {}) => {
        const headers = { 'Accept': 'application/json, text/plain, */*', ...extra };
        const xsrf = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]+)/);
        if (xsrf) headers['X-XSRF-TOKEN'] = decodeURIComponent(xsrf[1]);
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const r = await fetch(url, {
            method, headers, credentials: 'same-origin',
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (!r.ok) throw new Error(`${method} ${url}: ${r.status}`);
        return r.json();
    };

    // e. vartai's API answers 400 without Content-Language (its app always sends it).
    const evv = (url, opts = {}) => api(url, { ...opts, headers: { 'Content-Language': 'lt' } });

    // Full-page "logging in" screen over the intermediate pages.
    const Overlay = {
        show(text) {
            let o = document.getElementById('swed-overlay');
            if (!o) {
                o = el('div', { id: 'swed-overlay' }, `
                    position: fixed !important; inset: 0 !important; z-index: 2147483647 !important;
                    background: #fff !important; display: flex !important; flex-direction: column;
                    align-items: center; justify-content: center; gap: 16px;
                    font: 600 18px/1.4 system-ui, sans-serif; color: #333;`);
                const badge = el('div', { innerHTML: CONFIG.SB_ICON }, `
                    background: ${CONFIG.COLOR}; border-radius: 50%; width: 56px; height: 56px;
                    display: flex; align-items: center; justify-content: center;`);
                badge.querySelector('svg').style.cssText = 'width: 32px; height: 32px; margin: 0;';
                const cancel = el('a', {
                    href: '#', textContent: '✕',
                    onclick: (e) => { e.preventDefault(); Flow.end(); Overlay.hide(); }
                }, 'position: absolute; top: 16px; right: 24px; color: #999; text-decoration: none; font-size: 22px;');
                o.append(badge, el('div', { id: 'swed-overlay-text' }), cancel);
                document.documentElement.appendChild(o);
            }
            o.querySelector('#swed-overlay-text').textContent = text;
        },
        hide() { document.getElementById('swed-overlay')?.remove(); }
    };

    // Our button with a "▾" part on its right that lists the saved Swedbank
    // IDs: the button logs in by hand, an ID from the list logs in as that ID.
    // `gap` is the space the button keeps after itself.
    const splitButton = (btn, site, step, gap = '10px') => {
        btn.addEventListener('click', () => Flow.start(site, step));
        btn.style.marginRight = gap;
        const arrow = el('span', {
            className: 'swed-acc-arrow', textContent: '▾', title: 'Swedbank ID',
            onclick: (e) => {
                e.preventDefault(); // it sits inside the button's link
                e.stopPropagation();
                AccountMenu.toggle(arrow, (id) => {
                    Flow.start(site, step, { account: id });
                    location.href = btn.href;
                });
            }
        }, `display: inline-flex; align-items: center; align-self: stretch;
            margin: -4px -6px -4px 12px; padding: 4px 6px 4px 10px;
            border-left: 1px solid rgba(255,255,255,.55);
            font-size: 15px; line-height: 1; cursor: pointer;`);
        btn.append(arrow);
        return arrow;
    };

    const AccountMenu = {
        close() { document.getElementById('swed-acc-menu')?.remove(); },
        toggle(arrow, pick) {
            const open = document.getElementById('swed-acc-menu');
            AccountMenu.close();
            if (open?.owner === arrow) return;

            const r = arrow.getBoundingClientRect();
            const menu = el('div', { id: 'swed-acc-menu' }, `
                position: fixed; top: ${r.bottom + 4}px; right: ${Math.max(8, innerWidth - r.right)}px;
                z-index: 2147483646; background: #fff; border: 1px solid #ddd; border-radius: 6px;
                box-shadow: 0 4px 16px rgba(0,0,0,.2); min-width: 180px; padding: 4px 0;
                font: 500 15px/1.3 system-ui, sans-serif; color: #333; text-align: left;`);
            menu.owner = arrow;
            const accounts = Accounts.list();
            if (!accounts.length) {
                menu.append(el('div', {
                    textContent: 'No saved Swedbank IDs yet: log in once with the button.'
                }, 'padding: 8px 12px; color: #888; max-width: 260px;'));
            }
            for (const acc of accounts) {
                const row = el('div', {}, 'display: flex; align-items: center;');
                const item = el('a', {
                    href: '#', textContent: acc.id,
                    title: acc.ak ? 'ID + asmens kodas' : 'ID',
                    onclick: (e) => { e.preventDefault(); AccountMenu.close(); pick(acc.id); }
                }, 'flex: 1; padding: 8px 12px; color: #333; text-decoration: none;');
                item.onmouseenter = () => { item.style.background = '#fdf0e6'; };
                item.onmouseleave = () => { item.style.background = ''; };
                const del = el('a', {
                    href: '#', textContent: '✕', title: 'Forget',
                    onclick: (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        Accounts.remove(acc.id);
                        AccountMenu.close();
                        AccountMenu.toggle(arrow, pick);
                    }
                }, 'padding: 8px 12px; color: #aaa; text-decoration: none;');
                row.append(item, del);
                menu.append(row);
            }
            menu.addEventListener('click', (e) => e.stopPropagation());
            document.body.append(menu);
            setTimeout(() => document.addEventListener('click', AccountMenu.close, { once: true }));
        }
    };

    // Sets an input's value the way typing does, so the page's own
    // handlers (validation, showing more fields) see it.
    const typeInto = (input, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    // Covers a page that moves on by itself; uncovers it if it doesn't.
    const coverFor = (text, ms = 20000) => {
        Overlay.show(text);
        setTimeout(() => Overlay.hide(), ms);
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Runs an automatic step behind the overlay; on failure shows the page
    // and lets `fallback` (clicking the page's own button) do the step.
    const auto = async (text, fn, fallback) => {
        Overlay.show(text);
        try {
            await fn();
        } catch (err) {
            console.warn('[LT VIISP]', err);
            Overlay.hide();
            if (fallback) fallback();
        }
    };

    // --- Sites ---
    const SITES = [
        {
            // Migris (Angular). Each visible "Prisijungti" header button gets
            // a twin that opens the site's own VIISP start page.
            match: (h) => h.endsWith('migracija.lt'),
            run() {
                if (location.pathname.startsWith(CONFIG.MIGRIS_START) && Flow.waiting('pick-bank')) {
                    coverFor('Migris → e. valdžios vartai…');
                }
                keep(() => {
                    document.querySelectorAll('.logged-out-button a[href="/auth/login"]').forEach((login) => {
                        const wrap = login.parentElement;
                        if (wrap.previousElementSibling?.classList.contains('swed-btn')) return;

                        const twin = wrap.cloneNode(true);
                        twin.classList.add('swed-btn');
                        twin.style.marginRight = '8px';
                        const a = twin.querySelector('a');
                        a.href = CONFIG.MIGRIS_START;
                        a.removeAttribute('aria-label');
                        a.style.cssText = `background-color: ${CONFIG.COLOR} !important; color: #fff !important;`;
                        a.querySelector('.mdc-button__label').innerHTML = `${CONFIG.SB_ICON}${CONFIG.BTN_TITLE}`;
                        wrap.parentElement.insertBefore(twin, wrap);
                        twin.style.display = 'inline-flex';
                        splitButton(a, 'migris', 'pick-bank', '0');
                    });
                });
            }
        },
        {
            // sodra.lt: a button next to "Prisijungti".
            // gyventojai.sodra.lt: the login session is open now -> go to
            // Sodra's own Swedbank banklink (that page posts itself to the bank).
            match: (h) => h === 'sodra.lt' || h.endsWith('.sodra.lt'),
            run() {
                if (location.hostname === 'gyventojai.sodra.lt') {
                    // Back from the bank: Sodra's "vyksta prisijungimas" page
                    // posts itself on to the account.
                    if (location.pathname.includes('/F0000.jspx')) {
                        if (Flow.take('sodra-home')) coverFor('Sodra → Mano Sodra…');
                        return;
                    }
                    if (!location.pathname.startsWith('/sodra-login/')) return;
                    // The page that posts Sodra's request on to Swedbank.
                    if (location.pathname.startsWith('/sodra-login/send.form')) {
                        if (Flow.get()?.site === 'sodra') coverFor('Sodra → Swedbank…');
                        return;
                    }
                    if (Flow.take('sodra-bank', 'send-data')) {
                        coverFor('Sodra → Swedbank…');
                        location.replace(CONFIG.SODRA_SWEDBANK);
                    }
                    return;
                }
                keep(() => {
                    const login = document.querySelector('.sodra-login__button');
                    const col = login?.closest('.col');
                    if (!col || document.getElementById('swed-sodra-wrapper')) return;

                    const twin = col.cloneNode(true);
                    twin.id = 'swed-sodra-wrapper';
                    const old = twin.querySelector('a, button');
                    const btn = el('a', {
                        href: CONFIG.SODRA_LOGIN,
                        className: 'c-sodra-button c-sodra-button--style-5',
                        innerHTML: `${CONFIG.SB_ICON}<span>${CONFIG.BTN_TITLE}</span>`
                    }, `background-color: ${CONFIG.COLOR}; border-color: ${CONFIG.COLOR};
                        display: inline-flex; align-items: center; justify-content: center;`);
                    if (old) old.replaceWith(btn); else twin.prepend(btn);
                    col.parentNode.insertBefore(twin, col);
                    splitButton(btn, 'sodra', 'sodra-bank');
                });
            }
        },
        {
            // eSveikata: the button is a twin of the site's own "Prisijungti"
            // link. After the login, the patient account is opened.
            match: (h) => h.endsWith('esveikata.lt'),
            run() {
                if (location.hostname === 'pacientas.esveikata.lt') {
                    if (Flow.get()?.site === 'esveikata') Flow.end();
                    return;
                }
                if (location.hostname === 'sso.esveikata.lt') {
                    // Every eSveikata flow ends here, after e. vartai or (with
                    // a live Keycloak session) straight from the button.
                    if (Flow.get()?.site !== 'esveikata') return;
                    // Account selection (#!/roles): what roleSelect() does.
                    auto('eSveikata → paciento portalas…', async () => {
                        const roles = await api('/espbi-sso/api/accounts');
                        const usable = roles.filter((r) => !(r.representedId && r.representationBlocked));
                        const role = usable.find((r) => r.type === 'PATIENT' && r.id === r.representedId) || usable[0];
                        if (!role) throw new Error('no account to open');
                        const res = await api('/espbi-sso/api/accounts', { method: 'POST', body: role });
                        if (!res?.url) throw new Error('no portal url');
                        Flow.end();
                        location.replace(res.url);
                    }, () => keep(() => {
                        const btn = [...document.querySelectorAll('button.btn-icon-square[ng-click*="roleSelect"]')]
                            .find((b) => !b.disabled && b.offsetParent);
                        if (btn && Flow.get()) { Flow.end(); btn.click(); }
                    }));
                    return;
                }
                if (location.hostname !== 'www.esveikata.lt' && location.hostname !== 'esveikata.lt') return;

                keep(() => {
                    if (!document.getElementById('swed-fix-css') && document.head) {
                        document.head.appendChild(el('style', {
                            id: 'swed-fix-css',
                            textContent: `@media (min-width: 1050px) {
                                ul.groups li { padding: 0 4px !important; }
                                a.logo { margin-right: 10px !important; }
                            }`
                        }));
                    }

                    // The header's "Prisijungti" on desktop and on mobile.
                    for (const b of [
                        {
                            before: 'header.dsk a.btn_reg', id: 'swed-dsk-btn', cls: 'btn btn_reg',
                            html: `<span style="position: absolute; left: 12px; top: 48%; transform: translateY(-50%);">${CONFIG.SB_ICON}</span><b>${CONFIG.BTN_TITLE}</b>`,
                            css: 'position: relative; padding-left: 45px; flex-direction: row; flex-wrap: nowrap;'
                        },
                        {
                            before: '.btns_mob a.btn_reg_mob', id: 'swed-mob-btn', cls: 'btn btn_reg_mob',
                            html: CONFIG.SB_ICON,
                            css: 'display: flex; justify-content: center; padding: 10px;'
                        }
                    ]) {
                        const login = document.querySelector(b.before);
                        if (!login || document.getElementById(b.id)) continue;
                        const btn = el('a', {
                            id: b.id, href: CONFIG.ESVEIKATA_LOGIN, className: b.cls, innerHTML: b.html
                        }, `background-color: ${CONFIG.COLOR}; color: white; border: none; background-image: none;
                            align-items: center; width: auto; ${b.css}`);
                        login.before(btn);
                        splitButton(btn, 'esveikata', 'keycloak');
                    }
                });
            }
        },
        {
            // eSveikata's Keycloak: go straight to its e. vartai login link
            // (the privacy-notice tick on that page only sets a cookie for
            // itself, which we set as well).
            match: (h) => h === 'sso-espbi.registrucentras.lt',
            run() {
                if (!Flow.waiting('keycloak')) return;
                coverFor('eSveikata → e. valdžios vartai…');
                waitFor('button.js-login-btn[data-login-url*="/broker/viisp/"]', (btn) => {
                    if (!Flow.take('keycloak', 'pick-bank')) return;
                    document.cookie = `termsAccepted=true; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax`;
                    location.replace(btn.dataset.loginUrl);
                });
            }
        },
        {
            // e. valdžios vartai (ap.epaslaugos.lt, Angular).
            match: (h) => h === 'ap.epaslaugos.lt',
            run() {
                // /<ticket>/login: ask for the Swedbank provider and post to it.
                // (The ticket also goes where the app itself keeps it, for the
                // fallbacks that use the app's own buttons.)
                const login = location.pathname.match(/^\/([0-9a-f-]{36})\/login/);
                if (login && Flow.waiting('pick-bank')) {
                    const ticket = login[1];
                    localStorage.setItem(CONFIG.EVV_TICKET_KEY, ticket);
                    auto('e. valdžios vartai → Swedbank…', async () => {
                        const p = await evv(`/app/api/authentication/providers/bank.swedbank.v2?ticket=${ticket}`);
                        if (!p?.url || !p.parameters) throw new Error('no Swedbank redirect');
                        Flow.take('pick-bank', 'send-data', { ticket });
                        if ((p.httpMethod || 'POST').toUpperCase() === 'GET') {
                            location.replace(`${p.url}?${new URLSearchParams(p.parameters)}`);
                        } else {
                            postForm(p.url, p.parameters);
                        }
                    }, () => waitFor('img[alt="Swedbank"]', (img) => {
                        const card = img.closest('button, a');
                        if (card && Flow.take('pick-bank', 'send-data', { ticket })) card.click();
                    }));
                    return;
                }

                // /auth-redirect: "Asmens duomenų perdavimas" -> back to the
                // service. Extra personal data is not shared (the page's default).
                if (location.pathname.startsWith('/auth-redirect') && Flow.waiting('consent')) {
                    auto('e. valdžios vartai → atgal į paslaugą…', async () => {
                        const ticket = Flow.get()?.ticket;
                        if (!ticket) throw new Error('no ticket');
                        const info = await evv(`/app/api/secure/external-portals/data-transfer-information?ticket=${ticket}`);
                        if (info.restrictedUser || info.userTypeValid === false) throw new Error('login not allowed here');
                        const r = await evv(`/app/api/secure/external-portals/redirect-information?ticket=${ticket}`, {
                            method: 'POST',
                            body: { extraUserInformationAgreement: false, extraProxyUserInformationAgreement: false }
                        });
                        if (!r?.returnUrl) throw new Error('no return url');
                        Flow.take('consent');
                        localStorage.removeItem(CONFIG.EVV_TICKET_KEY);
                        postForm(r.returnUrl, r.postProperties || {});
                    }, () => waitFor('app-external-auth-redirect .button-group app-button:last-of-type button:not([disabled])', (btn) => {
                        if (Flow.take('consent')) btn.click();
                    }));
                }
            }
        },
        {
            // Swedbank banklink: "Send the data" back to the service.
            match: (h) => h === 'www.swedbank.lt',
            run() {
                // "Please wait, you will be redirected": posts itself back.
                if (location.pathname.startsWith('/banklink/identify')) {
                    if (Flow.get()) coverFor('Swedbank → atgal į paslaugą…');
                    return;
                }
                if (!location.pathname.startsWith('/banklink/auth') || !Flow.waiting('send-data')) return;
                coverFor('Swedbank → atgal į paslaugą…');
                waitFor('input.button[onclick*="banklink.identify"][onclick*="redirect"]', (btn) => {
                    if (Flow.take('send-data', (site) => (site === 'sodra' ? 'sodra-home' : 'consent'))) btn.click();
                });
            }
        },
        {
            // Swedbank login (log-in.swedbank.lt). Remembers every ID (and
            // asmens kodas, when the bank asks for it) you log in with, and
            // logs in by itself when an ID was picked from our button's list:
            // all that stays on screen is the bank's code to confirm on the phone.
            match: (h) => h === 'log-in.swedbank.lt',
            run() {
                const FORMS = { SIMPLE_ID: 'form-simpleid', SMART_ID: 'form-smartid' };
                const methodOf = (uf) => Object.keys(FORMS).find((k) => FORMS[k] === uf?.getAttribute('name'));
                const clean = (v) => (v || '').replace(/\s+/g, '');

                // Record what is submitted (by you or by us).
                document.addEventListener('submit', (e) => {
                    const form = e.target;
                    const id = clean(form.querySelector?.('input[name="userId"]')?.value);
                    if (!id) return;
                    const idn = form.querySelector('input[name="identityNumber"]');
                    Accounts.save({
                        id,
                        ak: idn?.offsetParent ? clean(idn.value) : '',
                        method: methodOf(form.closest('ui-form'))
                    });
                }, true);

                const sel = 'input[name="userId"][type="text"]';
                waitFor(sel, async () => {
                    // Suggestions for the ID fields; a known ID also fills in
                    // its asmens kodas when the bank asks for one.
                    const list = el('datalist', { id: 'swed-history-datalist' });
                    list.append(...Accounts.list().map((a) => el('option', { value: a.id })));
                    document.body.appendChild(list);
                    document.querySelectorAll(sel).forEach((input) => {
                        input.setAttribute('list', list.id);
                        input.setAttribute('autocomplete', 'off');
                        input.addEventListener('input', () => setTimeout(() => {
                            const acc = Accounts.find(clean(input.value));
                            const idn = input.closest('form')?.querySelector('input[name="identityNumber"]');
                            if (acc?.ak && idn?.offsetParent && !idn.value) typeInto(idn, acc.ak);
                        }));
                    });

                    const flow = Flow.get();
                    const acc = flow?.account && Accounts.find(flow.account);
                    if (!acc) {
                        if (flow) [...document.querySelectorAll(sel)].find((i) => i.offsetParent)?.focus();
                        return;
                    }

                    // Log in as the picked ID (once: a reload shows the form).
                    Flow.update({ account: null });
                    Overlay.show(`Swedbank → ${acc.id}…`);
                    const method = FORMS[acc.method] ? acc.method : 'SIMPLE_ID';
                    await sleep(300); // let the login widget finish wiring up its form
                    const tab = document.querySelector(`[role="tab"][aria-controls="${method}"]`);
                    if (tab && tab.getAttribute('aria-selected') !== 'true') {
                        tab.querySelector('button')?.click();
                        await sleep(300);
                    }
                    const uf = document.querySelector(`ui-form[name="${FORMS[method]}"]`);
                    const user = uf?.querySelector('input[name="userId"]');
                    if (!user) return Overlay.hide();
                    typeInto(user, acc.id);
                    await sleep(100);
                    const idn = uf.querySelector('input[name="identityNumber"]');
                    if (idn?.offsetParent) {
                        if (!acc.ak) { Overlay.hide(); idn.focus(); return; } // asked for, not known yet
                        typeInto(idn, acc.ak);
                    }
                    const submit = uf.querySelector('button[type="submit"]');
                    if (!submit || submit.disabled) return Overlay.hide();
                    submit.click();
                    // Uncover the page once the bank shows its code (the form
                    // goes away) or an error, at the latest after 15 s.
                    for (let t = 0; t < 75 && uf.offsetParent && !uf.querySelector('.-error, [class*="error"]:not(:empty)'); t++) {
                        await sleep(200);
                    }
                    Overlay.hide();
                });
            }
        }
    ];

    const site = SITES.find((s) => s.match(location.hostname));
    if (site) site.run();
})();
