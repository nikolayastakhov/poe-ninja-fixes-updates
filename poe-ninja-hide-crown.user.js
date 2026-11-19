// ==UserScript==
// @name         poe.ninja — Hide Coven Queen's Crown
// @namespace    skullcrabster/poe-ninja
// @version      5.0.1
// @description  Excludes Crown and pinnacle-boss Viscera before counts and pagination.
// @match        https://poe.ninja/*
// @run-at       document-start
// @grant        none
// @sandbox      raw
// @inject-into  page
// @noframes
// @updateURL    https://raw.githubusercontent.com/nikolayastakhov/poe-ninja-fixes-updates/main/poe-ninja-hide-crown.meta.js
// @downloadURL  https://raw.githubusercontent.com/nikolayastakhov/poe-ninja-fixes-updates/main/poe-ninja-hide-crown.user.js
// ==/UserScript==

(() => {
  'use strict';

  const STYLE_ID = 'poe-ninja-viscera-filters-style';
  const CONTROL_CLASS = 'poe-ninja-viscera-toggle';
  const ROW_ID = 'poe-ninja-viscera-extra-filters';
  const RESTORE_KEY = 'poe-ninja-hide-crown:restore-confidence';

  // Regular AND Uber drops. Verified 2026-11-17 against PoEDB's Viscera
  // cards and the PoE Wiki pinnacle-boss list; see pinnacle-viscera.md.
  // Never classify all Greater items as Uber: most belong to ordinary bosses.
  const PINNACLE_VISCERA = [
    ["Maven's Orrery", 'mavens-orrery'],
    ["Sirus' Head", 'sirus-head'],
    ["Shaper's Head", 'shapers-head'],
    ["Elder's Head", 'elders-head'],
    ["Eater of Worlds' Head", 'eater-of-worlds-head'],
    ["Searing Exarch's Descry", 'searing-exarchs-descry'],
    ["Venarius' Scripture", 'venarius-scripture'],
    ["Incarnation of Dread's Head", 'incarnation-of-dreads-head'],
    ["Incarnation of Fear's Head", 'incarnation-of-fears-head'],
    ["Incarnation of Neglect's Cube", 'incarnation-of-neglects-cube'],
  ];
  const PINNACLE_NAMES = new Set(PINNACLE_VISCERA.map(([name]) => name));

  function isPinnacleDrop(line) {
    const name = (line.name || '').replace(/^Greater /, '');
    if (PINNACLE_NAMES.has(name)) return true;
    // The API names are English, but also recognize every roll by its slug.
    const slug = (line.detailsId || '').replace(/^greater-/, '');
    return PINNACLE_VISCERA.some(([, base]) => slug === base || slug.startsWith(`${base}-`));
  }

  const filters = [
    {
      id: 'poe-ninja-hide-crown',
      param: 'hide-crown',
      label: 'Hide Crown',
      title: "Exclude all Coven Queen's Crown variants from counts and results.",
      excludes: line => line.name === "Coven Queen's Crown" ||
        line.detailsId?.startsWith('coven-queens-crown-'),
    },
    {
      id: 'poe-ninja-exclude-pinnacle',
      param: 'exclude-pinnacle',
      label: 'Exclude Pinnacle',
      title: 'Exclude regular and Uber drops: Maven, Sirus, Shaper, Elder, Eater, Exarch, Venarius, Incarnations of Dread, Fear and Neglect.',
      excludes: isPinnacleDrop,
    },
  ];

  // Match all leagues, optional language prefix, but never item detail pages.
  const isVisceraPage = () =>
    /^(?:\/[a-z]{2}(?:-[a-z]{2})?)?\/poe1\/economy\/[^/]+\/viscera\/?$/i.test(location.pathname);

  function readPreference(filter) {
    const value = new URLSearchParams(location.search).get(filter.param);
    if (value === '0' || value === '1') return value === '1';
    try {
      return localStorage.getItem(`${filter.id}:enabled`) !== 'false';
    } catch {
      return true;
    }
  }
  filters.forEach(filter => { filter.enabled = readPreference(filter); });

  let loadedOverview = null;
  const emittedViews = new WeakMap();
  let controlsRow = null;
  let statusMessage = '';

  function filteredData(data) {
    const active = filters.filter(filter => filter.enabled);
    return {
      ...data,
      lines: data.lines.filter(line => !active.some(filter => filter.excludes(line))),
    };
  }

  function overviewRequest(args) {
    try {
      const [input, options] = args;
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
      const method = options?.method || input?.method || 'GET';
      if (method.toUpperCase() !== 'GET' || url.origin !== location.origin ||
        url.pathname !== '/poe1/api/economy/stash/current/item/overview' ||
        url.searchParams.get('type') !== 'Viscera') return null;
      url.searchParams.sort();
      return { key: url.href, signal: options?.signal || input?.signal };
    } catch {
      return null;
    }
  }

  // Retain the full response and the identity of the object given to React.
  // Toggles update the existing query/table state, never the island or its key.
  // Normal requests still reach fetch and renew the complete source data.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = overviewRequest(args);
    const route = location.pathname;
    const response = await Reflect.apply(originalFetch, this, args);
    if (!request || !response.ok) return response;
    const originalJson = response.json;
    response.json = async function () {
      const data = await Reflect.apply(originalJson, this, []);
      if (!Array.isArray(data?.lines)) return data;
      const view = filteredData(data);
      if (route === location.pathname && isVisceraPage()) {
        loadedOverview = { key: request.key, route, data };
        emittedViews.set(view, loadedOverview);
        scheduleSync();
      }
      return view;
    };
    return response;
  };

  let confidenceToRestore = null;
  try {
    const saved = JSON.parse(sessionStorage.getItem(RESTORE_KEY) || 'null');
    sessionStorage.removeItem(RESTORE_KEY);
    if (saved?.url === location.href && typeof saved.checked === 'boolean') {
      confidenceToRestore = saved.checked;
    }
  } catch {
    // Confidence restoration is optional when storage is unavailable.
  }

  function findNativeInput(overview) {
    return overview.querySelector(
      'input[type="checkbox"][title^="Show items with low confidence:"]'
    ) || overview.querySelector(`input[type="checkbox"]:not(.${CONTROL_CLASS} input)`);
  }

  function savePreferences() {
    const nextUrl = new URL(location.href);
    for (const filter of filters) {
      try {
        localStorage.setItem(`${filter.id}:enabled`, String(filter.enabled));
        nextUrl.searchParams.delete(filter.param);
      } catch {
        // A URL parameter also survives reloads if storage is blocked.
        nextUrl.searchParams.set(filter.param, filter.enabled ? '1' : '0');
      }
    }
    if (nextUrl.href !== location.href) history.replaceState(history.state, '', nextUrl.href);
  }

  function currentIsland() {
    return document.querySelector('astro-island[component-export="Poe1ItemOverviewPage"]');
  }

  function reactRoot(island) {
    const host = island.querySelector('.item-overview') || island.querySelector('h1');
    if (!host) return null;
    const key = Object.keys(host).find(name => name.startsWith('__reactFiber$'));
    let fiber = key && host[key];
    if (!fiber) return null;
    while (fiber.return) fiber = fiber.return;
    // A DOM expando may point at the alternate. Always start at root.current.
    const current = fiber.stateNode?.current;
    return current?.stateNode === fiber.stateNode ? current : null;
  }

  function walkFibers(root, visit) {
    const stack = [root];
    let remaining = 200000;
    while (stack.length && --remaining > 0) {
      const fiber = stack.pop();
      visit(fiber);
      // Do not follow root.sibling: callers can restrict this to a subtree.
      for (let child = fiber.child; child; child = child.sibling) stack.push(child);
    }
    if (!remaining) throw new Error('Unexpected React tree');
  }

  function stateHooks(fiber) {
    const hooks = [];
    for (let hook = fiber.memoizedState; hook && hooks.length < 150; hook = hook.next) {
      hooks.push(hook);
    }
    return hooks;
  }

  function isTableState(state) {
    return state && Number.isFinite(state.pageSize) && state.pageSize > 0 &&
      Array.isArray(state.dimensionNames) && state.dimensionNames.includes('name') &&
      state.dimensionNames.includes('value') && state.dimensions && state.dimensionFilters &&
      state.dimensionNames.every(name => state.dimensions[name] && Array.isArray(state.dimensionFilters[name])) &&
      typeof state.filter === 'function' && typeof state.getCounts === 'function';
  }

  function tableAtFirstPage(hooks, index) {
    const state = hooks[index].memoizedState;
    if (state.pageSize === 40) return state;
    // The site's useDataTable has useRef(factory), useCallback(initialize),
    // useState(table). Borrow its own pure initializer to build native methods
    // with pageSize=40. The ref is restored synchronously, even on failure;
    // no hook state or update queue is assigned to directly.
    const reference = hooks[index - 2]?.memoizedState;
    const callback = hooks[index - 1]?.memoizedState;
    if (!reference || typeof reference.current !== 'function' ||
      !Array.isArray(callback) || typeof callback[0] !== 'function' ||
      !Array.isArray(callback[1]) || callback[1].length !== 0) {
      throw new Error('Unsupported table initializer');
    }
    const original = reference.current;
    let next;
    try {
      reference.current = () => ({ _getData: () => ({ ...state, pageSize: 40 }) });
      next = callback[0]();
    } finally {
      reference.current = original;
    }
    if (!isTableState(next) || next.pageSize !== 40 ||
      next.dimensions !== state.dimensions || next.dimensionFilters !== state.dimensionFilters ||
      next.sort !== state.sort || next.descending !== state.descending ||
      next.sortTieBreak !== state.sortTieBreak) throw new Error('Unexpected table state');
    return next;
  }

  function refreshResults() {
    try {
      const island = currentIsland();
      const root = island && reactRoot(island);
      if (!root) throw new Error('Table is not ready');
      const queries = [];
      walkFibers(root, fiber => {
        for (const hook of stateHooks(fiber)) {
          const source = hook.memoizedState && emittedViews.get(hook.memoizedState);
          if (source?.route === location.pathname && typeof hook.queue?.dispatch === 'function') {
            queries.push({ fiber, hook, source, view: hook.memoizedState });
          }
        }
      });
      if (queries.length !== 1) throw new Error('Ambiguous overview state');
      const query = queries[0];
      const tables = [];
      walkFibers(query.fiber, fiber => {
        if (fiber.memoizedProps?.overviewData !== query.view) return;
        const hooks = stateHooks(fiber);
        hooks.forEach((hook, index) => {
          if (typeof hook.queue?.dispatch === 'function' && isTableState(hook.memoizedState)) {
            tables.push({ hook, hooks, index });
          }
        });
      });
      if (tables.length !== 1) throw new Error('Ambiguous table state');
      const table = tables[0];
      const nextTable = tableAtFirstPage(table.hooks, table.index);
      const source = loadedOverview?.route === query.source.route && loadedOverview.key === query.source.key
        ? loadedOverview : query.source;
      const nextView = filteredData(source.data);
      emittedViews.set(nextView, source);
      // Both native state setters run in the same task. The existing page,
      // header, inputs, confidence setting and sort order stay mounted.
      if (nextTable !== table.hook.memoizedState) table.hook.queue.dispatch(nextTable);
      query.hook.queue.dispatch(nextView);
      statusMessage = '';
      savePreferences();
      scheduleSync();
      return true;
    } catch {
      statusMessage = 'Cannot update this version of the table. Please update the userscript.';
      return false;
    }
  }

  function addStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROW_ID} {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--s2, .5rem);
        margin-top: var(--s2, .5rem);
      }
      .${CONTROL_CLASS} {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: var(--s4, 1rem);
        box-sizing: border-box;
        flex: 0 1 14rem;
        width: 14rem;
        max-width: 100%;
        min-width: 0;
        height: 3rem;
        padding: 0 var(--s4, 1rem);
        border: 1px solid #26313b;
        border-radius: 3px;
        background: #151d24;
        color: #aebbc5;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
      }
      .${CONTROL_CLASS} > span {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .${CONTROL_CLASS}:hover,
      .${CONTROL_CLASS}:focus-within { border-color: #10b981; }
      #${ROW_ID} [role="status"] {
        flex-basis: 100%;
        color: #fca5a5;
        font-size: .875rem;
      }
      .${CONTROL_CLASS} input {
        appearance: auto;
        position: static;
        width: 1.25rem;
        height: 1.25rem;
        margin: 0;
        opacity: 1;
        flex-shrink: 0;
        accent-color: #10b981;
        color-scheme: dark;
        cursor: pointer;
      }
    `;
    (document.head || document.documentElement).append(style);
  }

  function createControl(filter) {
    const label = document.createElement('label');
    label.id = filter.id;
    label.className = CONTROL_CLASS;
    label.title = filter.title;
    const text = document.createElement('span');
    text.textContent = filter.label;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = filter.enabled;
    checkbox.addEventListener('change', () => {
      const previous = filters.map(item => item.enabled);
      filter.enabled = checkbox.checked;
      if (!refreshResults()) {
        filters.forEach((item, index) => { item.enabled = previous[index]; });
      }
      scheduleSync();
    });
    label.append(text, checkbox);
    return label;
  }

  function sync() {
    addStyles();
    const active = isVisceraPage();
    if (!active) {
      controlsRow?.remove();
      return;
    }

    const island = currentIsland();
    if (!island) return;
    const overview = document.querySelector('.item-overview');
    if (!overview && loadedOverview?.route !== location.pathname) return;
    const nativeInput = overview && findNativeInput(overview);
    const nativeLabel = nativeInput?.closest('label');
    if (nativeInput && confidenceToRestore !== null) {
      const checked = confidenceToRestore;
      confidenceToRestore = null;
      if (nativeInput.checked !== checked) nativeInput.click();
    }

    // Find the filter row by its search inputs, without depending on CSS hashes
    // or the tooltip wrappers around the native checkbox.
    let group = nativeLabel?.parentElement;
    while (group && group !== overview &&
      !group.querySelector('input:not([type="checkbox"]):not([type="hidden"])')) {
      group = group.parentElement;
    }
    if (group === overview) group = null;

    // The native flex row stays intact. Our row is its sibling inside the
    // plain layout wrapper, outside the site's sizing rules for flex items.
    if (!controlsRow) {
      controlsRow = document.createElement('div');
      controlsRow.id = ROW_ID;
      controlsRow.setAttribute('role', 'group');
      controlsRow.setAttribute('aria-label', 'Additional Viscera filters');
    }
    const row = controlsRow;
    // Keep controls available even if exclusions leave the native table empty.
    const anchor = group || island.querySelector('h1') || island;
    if (row.parentElement !== anchor.parentElement || row.previousElementSibling !== anchor) {
      anchor.after(row);
    }
    for (const filter of filters) {
      let control = document.getElementById(filter.id);
      if (control?.parentElement !== row) {
        control?.remove();
        control = createControl(filter);
        row.append(control);
      } else {
        control.querySelector('input').checked = filter.enabled;
      }
    }
    let status = row.querySelector('[role="status"]');
    if (!status && statusMessage) {
      status = document.createElement('span');
      status.setAttribute('role', 'status');
      row.append(status);
    }
    if (status && status.textContent !== statusMessage) status.textContent = statusMessage;
  }

  // Restore our control after SPA renders. Filtering is handled above, before
  // any rows reach the native table. Ignore our own attribute updates.
  let scheduled = false;
  function scheduleSync() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      sync();
    });
  }

  function applyStoredPreferences() {
    const previous = filters.map(filter => filter.enabled);
    filters.forEach(filter => { filter.enabled = readPreference(filter); });
    const changed = filters.some((filter, index) => filter.enabled !== previous[index]);
    if (changed && isVisceraPage()) {
      if (!refreshResults()) filters.forEach((filter, index) => { filter.enabled = previous[index]; });
    }
    scheduleSync();
  }

  function start() {
    sync();
    new MutationObserver(scheduleSync).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    addEventListener('popstate', scheduleSync);
    addEventListener('pageshow', scheduleSync);
    document.addEventListener('astro:page-load', scheduleSync);
    addEventListener('storage', event => {
      if (event.key !== null && !filters.some(filter => event.key === `${filter.id}:enabled`)) return;
      applyStoredPreferences();
    });
  }

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
