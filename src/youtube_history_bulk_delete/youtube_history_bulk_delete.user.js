// ==UserScript==
// @name         YouTube History Bulk Delete
// @name:ru      YouTube: Массовое удаление из истории просмотра
// @namespace    https://github.com/CustomFF/userscripts
// @version      3.0.0
// @description  Checkboxes and bulk removal of videos from your YouTube watch history.
// @description:ru Чекбоксы и пакетное удаление видео из истории просмотра YouTube.
// @author       DayDve
// @license      MPL-2.0
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @match        https://www.youtube.com/*
// @grant        none
// @run-at       document-idle
// @keywords     youtube, history, watch history, delete, bulk
// ==/UserScript==

/*
 * YouTube is a single-page app, so the script runs on every youtube.com page
 * and only shows itself while /feed/history is open: a "Bulk delete" button
 * next to "Clear all watch history" turns the checkboxes and the panel on.
 *
 * Each history card carries the token of its own "Remove from watch history"
 * menu item. Selected cards are removed with one request to the same API that
 * menu item calls (/youtubei/v1/feedback); a card whose token is missing or
 * not accepted is removed through its menu instead.
 */
(function () {
    'use strict';

    const RU = (document.documentElement.lang || navigator.language).startsWith('ru');
    const T = RU
        ? { mode: 'Пакетное удаление', selected: 'Выбрано', all: 'Выбрать все', none: 'Снять все', del: 'Удалить выбранное', deleting: 'Удаляю…', failed: 'не удалось удалить' }
        : { mode: 'Bulk delete', selected: 'Selected', all: 'Select all', none: 'Unselect all', del: 'Delete selected', deleting: 'Deleting…', failed: 'could not be deleted' };

    const CARD = 'yt-lockup-view-model';
    const BATCH = 50; // tokens per request

    const isHistory = () => location.pathname.startsWith('/feed/history');
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

    const STYLE = `
        #ythbd-bar {
            position: fixed; bottom: 24px; right: 24px; z-index: 2000;
            display: flex; align-items: center; gap: 12px;
            background: #212121; color: #fff; padding: 10px 16px; border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,.5); font: 14px Roboto, Arial, sans-serif;
        }
        #ythbd-bar button {
            background: #3ea6ff; color: #000; border: none; border-radius: 4px;
            padding: 6px 12px; font-weight: 500; cursor: pointer;
        }
        #ythbd-bar button.ythbd-danger { background: #cc0000; color: #fff; }
        #ythbd-bar button:disabled { background: #555; color: #888; cursor: not-allowed; }
        /* Over the thumbnail's top-left corner, so nothing on the page moves. */
        .ythbd-cb {
            position: absolute; top: 14px; left: 14px; z-index: 3; margin: 0;
            width: 22px; height: 22px; cursor: pointer; accent-color: #3ea6ff;
            filter: drop-shadow(0 0 2px rgba(0,0,0,.9));
        }
        .ytLockupViewModelHost:has(> .ythbd-cb:checked) {
            outline: 2px solid #3ea6ff; outline-offset: 4px; border-radius: 12px;
        }
    `;

    // --- Deleting ---

    // The feedback token of the card's "Remove from watch history" item
    // (the menu item with the DELETE icon).
    const tokenOf = (card) => {
        let data = card.componentProps?.data;
        if (typeof data === 'function') data = data();
        let token = null;
        (function walk(o) {
            if (token || !o || typeof o !== 'object') return;
            const item = o.listItemViewModel;
            if (item?.leadingImage?.sources?.[0]?.clientResource?.imageName === 'DELETE') {
                token = JSON.stringify(item).match(/"feedbackToken":"([^"]+)"/)?.[1] || null;
                return;
            }
            for (const k in o) walk(o[k]);
        })(data);
        return token;
    };

    // The Authorization header YouTube's own requests carry for a signed-in user.
    const authHeader = async () => {
        const sapisid = document.cookie.match(/(?:^|;\s*)(?:__Secure-3PAPISID|SAPISID)=([^;]+)/)?.[1];
        if (!sapisid) return {};
        const ts = Math.floor(Date.now() / 1000);
        const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
        const hash = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
        return {
            'Authorization': `SAPISIDHASH ${ts}_${hash}`,
            'X-Origin': location.origin,
            'X-Goog-AuthUser': String(window.ytcfg?.get('SESSION_INDEX') ?? 0)
        };
    };

    // Sends the tokens; returns which of them YouTube processed.
    const deleteTokens = async (tokens) => {
        const res = await fetch('/youtubei/v1/feedback?prettyPrint=false', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({ context: window.ytcfg.get('INNERTUBE_CONTEXT'), feedbackTokens: tokens })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const out = (await res.json()).feedbackResponses || [];
        return tokens.map((_, i) => out[i]?.isProcessed === true);
    };

    const click = (node) => {
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
            node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
    };

    // Fallback: the card's own menu -> "Remove from watch history".
    const deleteViaMenu = async (card) => {
        const menuBtn = card.querySelector('button-view-model button'); // the card's only button: "More"/"Ещё"
        if (!menuBtn) return false;
        click(menuBtn);
        for (let i = 0; i < 20; i++) {
            await sleep(100);
            const item = [...document.querySelectorAll('yt-list-item-view-model')]
                .find((n) => n.offsetParent && /истории|history/i.test(n.textContent));
            if (item) { click(item); return true; }
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return false;
    };

    // Removes the card and, when it was the last one of its day, the day too.
    const dropCard = (card) => {
        const section = card.closest('ytd-item-section-renderer');
        card.remove();
        if (section && !section.querySelector(CARD)) section.remove();
    };

    const deleteCards = async (cards, progress) => {
        const withToken = cards.map((card) => ({ card, token: tokenOf(card) }));
        const viaApi = withToken.filter((c) => c.token);
        const left = withToken.filter((c) => !c.token).map((c) => c.card);
        let done = 0;

        for (let i = 0; i < viaApi.length; i += BATCH) {
            const chunk = viaApi.slice(i, i + BATCH);
            let ok;
            try {
                ok = await deleteTokens(chunk.map((c) => c.token));
            } catch (err) {
                console.warn('[YT History Bulk Delete]', err);
                ok = chunk.map(() => false);
            }
            chunk.forEach((c, j) => {
                if (ok[j]) { dropCard(c.card); progress(++done); } else left.push(c.card);
            });
        }
        let failed = 0;
        for (const card of left) {
            if (await deleteViaMenu(card)) { dropCard(card); progress(++done); } else failed++;
        }
        return failed;
    };

    // --- UI ---

    let lastBox = null;
    const boxes = () => [...document.querySelectorAll('.ythbd-cb')];

    const update = () => {
        const all = boxes();
        const n = all.filter((b) => b.checked).length;
        document.getElementById('ythbd-count').textContent = `${T.selected}: ${n}`;
        document.getElementById('ythbd-del').disabled = n === 0;
        document.getElementById('ythbd-all').textContent = all.length && n === all.length ? T.none : T.all;
    };

    const addCheckbox = (card) => {
        const host = card.querySelector('.ytLockupViewModelHost');
        if (!host || host.querySelector('.ythbd-cb')) return;
        const cb = el('input', { type: 'checkbox', className: 'ythbd-cb' });
        // Keep clicks on the checkbox from opening the video.
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
            cb.addEventListener(type, (e) => e.stopPropagation());
        }
        cb.addEventListener('click', (e) => {
            e.stopPropagation();
            // Shift+click: the whole range from the last clicked box.
            if (e.shiftKey && lastBox && lastBox !== cb && lastBox.isConnected) {
                const all = boxes();
                const [a, b] = [all.indexOf(lastBox), all.indexOf(cb)].sort((x, y) => x - y);
                all.slice(a, b + 1).forEach((box) => { box.checked = cb.checked; });
            }
            lastBox = cb;
            update();
        });
        host.prepend(cb);
    };

    const buildBar = () => {
        const count = el('span', { id: 'ythbd-count' });
        const all = el('button', {
            id: 'ythbd-all',
            onclick: () => {
                const list = boxes();
                const on = list.some((b) => !b.checked);
                list.forEach((b) => { b.checked = on; });
                update();
            }
        });
        const del = el('button', { id: 'ythbd-del', className: 'ythbd-danger', textContent: T.del });
        del.onclick = async () => {
            const cards = boxes().filter((b) => b.checked).map((b) => b.closest(CARD)).filter(Boolean);
            if (!cards.length) return;
            all.disabled = del.disabled = true;
            const total = cards.length;
            count.textContent = `${T.deleting} 0/${total}`;
            const failed = await deleteCards(cards, (n) => { count.textContent = `${T.deleting} ${n}/${total}`; });
            all.disabled = false;
            update();
            if (failed) alert(`${failed} ${T.failed}`);
        };
        const bar = el('div', { id: 'ythbd-bar' });
        bar.append(count, all, del);
        return bar;
    };

    // "Bulk delete" next to the page's own "Clear all watch history": a copy
    // of that button (so it looks the same) with its own icon and text.
    const ICON = '<svg viewBox="0 0 24 24" width="24" height="24" style="display:block;fill:currentcolor"><path d="M3 5h2v2H3V5zm4 0h14v2H7V5zM3 11h2v2H3v-2zm4 0h14v2H7v-2zm-4 6h2v2H3v-2zm4 0h14v2H7v-2z"/></svg>';
    let active = false;

    const placeToggle = () => {
        if (document.getElementById('ythbd-toggle') || !window.ytcfg?.get('LOGGED_IN')) return;
        const clear = [...document.querySelectorAll('ytd-browse-feed-actions-renderer #contents > ytd-button-renderer')]
            .find((r) => r.querySelector('yt-button-shape > button')); // the first real button: "Clear all"
        if (!clear) return;
        const btn = clear.querySelector('yt-button-shape > button').cloneNode(true);
        btn.id = 'ythbd-toggle';
        btn.querySelector('.ytSpecButtonShapeNextIcon .yt-icon-shape').innerHTML = ICON;
        btn.setAttribute('aria-label', T.mode);
        btn.querySelector('.ytSpecButtonShapeNextButtonTextContent span').textContent = T.mode;
        btn.onclick = () => { active = !active; refresh(); };
        const wrap = el('div');
        wrap.style.margin = getComputedStyle(clear).margin; // same spacing as its neighbours
        wrap.append(btn);
        clear.after(wrap);
    };

    const style = el('style', { id: 'ythbd-style', textContent: STYLE });
    let bar = null;

    const refresh = () => {
        const on = active && isHistory();
        if (isHistory()) {
            if (!style.isConnected) document.head.append(style);
            placeToggle();
            // While on, the button stays pressed (YouTube's filled "tonal" style).
            const toggle = document.getElementById('ythbd-toggle');
            toggle?.classList.toggle('ytSpecButtonShapeNextTonal', on);
            toggle?.classList.toggle('ytSpecButtonShapeNextText', !on);
            toggle?.setAttribute('aria-pressed', String(on));
        }
        if (!on) {
            bar?.remove();
            document.querySelectorAll('.ythbd-cb').forEach((cb) => cb.remove());
            lastBox = null;
            return;
        }
        if (!bar) bar = buildBar();
        if (!bar.isConnected) document.body.append(bar);
        document.querySelectorAll(`ytd-browse ${CARD}`).forEach(addCheckbox);
        update();
    };

    // YouTube keeps appending cards while you scroll: refresh at most once a frame.
    let queued = false;
    const schedule = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; refresh(); });
    };

    document.addEventListener('yt-navigate-finish', schedule);
    new MutationObserver(() => { if (isHistory()) schedule(); })
        .observe(document.body, { childList: true, subtree: true });
    schedule();
})();
