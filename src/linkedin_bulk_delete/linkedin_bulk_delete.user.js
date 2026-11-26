// ==UserScript==
// @name         LinkedIn Notifications Bulk Delete
// @name:ru      LinkedIn: Массовое удаление уведомлений
// @version      1.6.1
// @description  Bulk delete LinkedIn notifications
// @description:ru Массовое удаление уведомлений в LinkedIn
// @author       DayDve
// @match        https://www.linkedin.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=linkedin.com
// @grant        none
// @inject-into  content
// @license      MPL-2.0
// @keywords     linkedin, notifications, delete, bulk
// ==/UserScript==

(function() {
    'use strict';

    // LinkedIn's markup has hashed class names, so everything is found by structure and ARIA.
    const COLUMN = '[data-component-type="LazyColumn"]';
    const MORE = 'button[aria-label="More options"]';
    const DELETE_TEXT = /delete notification|удалить уведомление/i;
    const DELETE_REQUEST = 'com.linkedin.sdui.requests.notifications.deleteNotification';

    let busy = false;
    let unclipped = [];

    // The panel can be collapsed to just the toggle button; the choice is remembered.
    const VISIBLE_KEY = 'nt-bulk-visible';
    let visible = true;
    try { visible = localStorage.getItem(VISIBLE_KEY) !== '0'; } catch (e) { /* storage blocked */ }

    function setupElement(tagName, options = {}, style = {}) {
        const element = tagName instanceof Element ? tagName : document.createElement(tagName);
        Object.assign(element, options);
        Object.assign(element.style, style);
        return element;
    }

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    const waitFor = async (fn, timeout = 3000) => {
        for (let t = 0; t < timeout; t += 100) {
            const v = fn();
            if (v) return v;
            await sleep(100);
        }
        return null;
    };

    const cardOf = (chk) => chk.closest(`${COLUMN} > *`);

    // The card's "More options" menu carries the delete action as an SDUI ServerRequest in the
    // React props, even while the menu is closed.
    // In a Firefox content script page objects are reached through wrappedJSObject.
    const findDeleteRequest = (more) => {
        const el = more.wrappedJSObject || more;
        const key = Object.keys(el).find(k => k.startsWith('__reactFiber'));
        const seen = new WeakSet();
        const search = (v, depth) => {
            // A menu that was never opened is still an unparsed RSC chunk (a JSON string).
            if (typeof v === 'string' && v.includes(DELETE_REQUEST)) {
                try { return search(JSON.parse(v), depth + 1); } catch (e) { return null; }
            }
            if (!v || typeof v !== 'object' || depth > 40 || seen.has(v) || v instanceof Node) return null;
            seen.add(v);
            if (v.requestId === DELETE_REQUEST && v.requestedArguments) return v;
            for (const k of Object.keys(v)) {
                if (k === '_owner' || k === 'return' || k === 'stateNode') continue;
                const hit = search(v[k], depth + 1);
                if (hit) return hit;
            }
            return null;
        };
        for (let f = key && el[key], i = 0; f && i < 15; f = f.return, i++) {
            const hit = search(f.memoizedProps, 0);
            if (hit) return JSON.parse(JSON.stringify(hit));
        }
        return null;
    };

    const deleteViaApi = async (more) => {
        const req = findDeleteRequest(more);
        const csrf = (document.cookie.match(/(?:^|;\s*)JSESSIONID="?([^";]+)/) || [])[1];
        if (!req || !csrf) return false;
        const { maxRetries, backOffMultiplier, maxSeconds, ...serverRequest } = req;
        const res = await fetch(`${location.origin}/flagship-web/rsc-action/actions/server-request?sduiid=${DELETE_REQUEST}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'csrf-token': csrf, 'content-type': 'application/json', 'x-li-rsc-stream': 'true' },
            body: JSON.stringify({
                requestId: DELETE_REQUEST,
                serverRequest,
                states: [],
                requestedArguments: { ...req.requestedArguments, states: [], screenId: '', knownTemplateIds: [] }
            })
        }).catch(() => null);
        return !!(res && res.ok);
    };

    const deleteViaMenu = async (more) => {
        more.click();
        const item = await waitFor(() => [...document.querySelectorAll('[role="menuitem"]')]
            .find(e => e.getClientRects().length && DELETE_TEXT.test(e.textContent)));
        if (!item) {
            if (more.getAttribute('aria-expanded') === 'true') more.click();
            return false;
        }
        item.click();
        return true;
    };

    const hideCard = (card) => {
        setupElement(card, {}, { transition: 'opacity 0.4s ease', opacity: '0' });
        setTimeout(() => { card.style.display = 'none'; }, 400);
    };

    // API requests go out a few at a time in parallel; only the cards they failed for are
    // deleted one by one through the menu.
    const deleteCards = async (checks) => {
        if (busy) return;
        busy = true;
        const cards = [...new Set(checks.map(cardOf))]
            .filter(c => c && c.isConnected && c.style.display !== 'none' && c.querySelector(MORE));
        const failed = [];
        for (let i = 0; i < cards.length; i += 5) {
            await Promise.all(cards.slice(i, i + 5).map(async card => {
                let ok = false;
                try { ok = await deleteViaApi(card.querySelector(MORE)); } catch (e) { ok = false; }
                if (ok) hideCard(card); else failed.push(card);
            }));
        }
        for (const card of failed) {
            console.warn('[LinkedIn Bulk Delete] API delete failed, using the menu:', card.textContent.trim().slice(0, 60));
            if (await deleteViaMenu(card.querySelector(MORE))) hideCard(card);
        }
        await sleep(400);
        busy = false;
        updateButtonState();
    };

    // The list loads more on scroll; when few cards are left, scroll to the end and back.
    const loadMore = () => {
        const cards = [...document.querySelectorAll(`${COLUMN} > .bulk-processed`)]
            .filter(c => c.style.display !== 'none');
        if (cards.length >= 8) return;
        const pos = window.scrollY;
        const last = document.querySelector(COLUMN).lastElementChild;
        if (last) last.scrollIntoView();
        setTimeout(() => window.scrollTo(0, pos), 300);
    };

    const updateButtonState = () => {
        const btn = document.getElementById('btn-delete-selected');
        if (!btn) return;
        const selected = document.querySelectorAll('.nt-bulk-custom-check.is-checked').length > 0;
        btn.disabled = busy || !selected;
        setupElement(btn, {}, btn.disabled
            ? { opacity: '0.5', cursor: 'not-allowed' }
            : { opacity: '1', cursor: 'pointer' });
    };

    const injectInterface = (column) => {
        if (document.getElementById('bulk-delete-panel')) return;

        const panel = setupElement('div', { id: 'bulk-delete-panel' }, {
            padding: '15px',
            background: '#fff',
            borderBottom: '1px solid #dcdcdc',
            display: 'flex',
            gap: '12px',
            position: 'sticky',
            top: '0',
            zIndex: '20000',
            boxShadow: '0 2px 5px rgba(0,0,0,0.1)'
        });

        const btnDeleteSelected = setupElement('button', {
            id: 'btn-delete-selected',
            innerText: 'Delete Selected',
            disabled: true
        }, {
            background: '#0a66c2',
            color: 'white',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '16px',
            fontWeight: '600',
            opacity: '0.5',
            cursor: 'not-allowed',
            transition: 'opacity 0.2s'
        });

        btnDeleteSelected.onclick = async () => {
            const done = deleteCards([...document.querySelectorAll('.nt-bulk-custom-check.is-checked')]);
            updateButtonState();
            await done;
            loadMore();
        };

        const btnDeleteAll = setupElement('button', {
            id: 'btn-delete-all',
            innerText: 'Delete All'
        }, {
            background: '#fff',
            color: '#cc1016',
            border: '1px solid #cc1016',
            padding: '8px 16px',
            borderRadius: '16px',
            fontWeight: '600',
            cursor: 'pointer'
        });

        btnDeleteAll.onclick = () => {
            if (!confirm('Delete all visible notifications?')) return;
            const done = deleteCards([...document.querySelectorAll('.nt-bulk-custom-check')]);
            updateButtonState();
            // Reload to get the remaining notifications from the server.
            done.then(() => location.reload());
        };

        const btnToggle = setupElement('button', { id: 'btn-bulk-toggle' }, {
            marginLeft: 'auto',
            background: 'none',
            color: '#666',
            border: '1px solid #999',
            padding: '4px 12px',
            borderRadius: '16px',
            fontWeight: '600',
            cursor: 'pointer'
        });

        btnToggle.onclick = () => {
            visible = !visible;
            try { localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0'); } catch (e) { /* storage blocked */ }
            applyVisibility();
        };

        panel.appendChild(btnDeleteSelected);
        panel.appendChild(btnDeleteAll);
        panel.appendChild(btnToggle);
        column.before(panel);
        applyVisibility();

        // An overflow:hidden ancestor below the real scroller (main) would hold the sticky panel
        // in place; overflow:clip clips the same way without becoming a scroll container.
        for (let e = panel.parentElement; e && !/auto|scroll/.test(getComputedStyle(e).overflowY); e = e.parentElement) {
            if (getComputedStyle(e).overflowY !== 'hidden') continue;
            unclipped.push([e, e.style.overflow]);
            e.style.overflow = 'clip';
        }
    };

    const addCheckboxes = (column) => {
        for (const card of column.children) {
            if (card.classList.contains('bulk-processed') || !card.querySelector(MORE)) continue;

            const chk = setupElement('div', { className: 'nt-bulk-custom-check' }, {
                position: 'absolute',
                left: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: '1000',
                width: '20px',
                height: '20px',
                cursor: 'pointer',
                border: '2px solid #0a66c2',
                background: 'white',
                borderRadius: '4px',
                pointerEvents: 'all',
                boxSizing: 'border-box'
            });

            chk.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const isChecked = chk.classList.toggle('is-checked');
                chk.style.background = isChecked ? '#0a66c2' : 'white';
                updateButtonState();
            };

            card.prepend(chk);
            card.classList.add('bulk-processed');
            layoutCard(card, visible);
        }
    };

    // Room for the checkbox on the left; a deleted (hidden) card keeps display:none.
    const layoutCard = (card, on) => {
        const chk = card.querySelector(':scope > .nt-bulk-custom-check');
        if (chk) chk.style.display = on ? '' : 'none';
        setupElement(card, {}, on
            ? { position: 'relative', paddingLeft: '45px' }
            : { position: '', paddingLeft: '' });
        if (card.style.display !== 'none') card.style.display = on ? 'block' : '';
    };

    const applyVisibility = () => {
        const panel = document.getElementById('bulk-delete-panel');
        if (panel) {
            panel.style.padding = visible ? '15px' : '8px 15px';
            for (const id of ['btn-delete-selected', 'btn-delete-all']) {
                document.getElementById(id).style.display = visible ? '' : 'none';
            }
            document.getElementById('btn-bulk-toggle').innerText = visible ? 'Hide' : 'Bulk delete';
        }
        for (const card of document.querySelectorAll(`${COLUMN} > .bulk-processed`)) layoutCard(card, visible);
    };

    // LinkedIn is a SPA and other pages (the feed) use the same list, so the script runs on the
    // whole site and only acts on the notifications page.
    const cleanup = () => {
        const panel = document.getElementById('bulk-delete-panel');
        if (panel) panel.remove();
        for (const [e, overflow] of unclipped) e.style.overflow = overflow;
        unclipped = [];
        for (const chk of document.querySelectorAll('.nt-bulk-custom-check')) {
            const card = chk.parentElement;
            layoutCard(card, false);
            chk.remove();
            card.classList.remove('bulk-processed');
        }
    };

    const observer = new MutationObserver(() => {
        if (!location.pathname.startsWith('/notifications')) {
            if (document.querySelector('#bulk-delete-panel, .nt-bulk-custom-check')) cleanup();
            return;
        }
        const column = document.querySelector(COLUMN);
        if (!column) return;
        injectInterface(column);
        addCheckboxes(column);
    });

    observer.observe(document.body, { childList: true, subtree: true });
})();
