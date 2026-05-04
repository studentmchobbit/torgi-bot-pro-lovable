const BLUE_ICONS = {
    16: "icon-blue-16.png",
    32: "icon-blue-32.png",
    48: "icon-blue-48.png",
    128: "icon-blue-128.png"
};

const GREEN_ICONS = {
    16: "icon-green-16.png",
    32: "icon-green-32.png",
    48: "icon-green-48.png",
    128: "icon-green-128.png"
};

const DEFAULT_SETTINGS = {
    botEnabled: false,
    widgetHidden: false,
    preStartSeconds: 5,
    reloadInterval: 250,
    combatSoftReloadMs: 1200,
    activeApiReloadGraceMs: 1000,
    logicInterval: 200,
    combatLogicInterval: 160,
    combatBurstInterval: 80,
    buyTransitionWaitMs: 8000,
    buyRecoveryMaxCount: 1,
    buyProcessingMaxWaitMs: 120000,
    buyClickDelayMs: 500,
    minPageAgeBeforeBuyClickMs: 500,
    offerSignClickCooldownMs: 500,
    cryptoSignClickCooldownMs: 500,
    certDropdownClickCooldownMs: 200,
    idleRetryInterval: 30000,
    apiWatchdogInterval: 1000,
    preStartSessionRefreshEnabled: true,
    preStartSessionRefreshInterval: 60000,
    preStartSessionRefreshStopBefore: 45000,
    enableHeartbeatInterval: 1000,
    stopBeforeFinalSelect: true,
    manualStartTime: null,
    lotPriority: null
};

const SESSION_STORAGE = chrome.storage.session || chrome.storage.local;
const SIGN_LOCK_TTL_MS = 60000;
const SIGN_QUEUE_COLLECT_MS = 150;
const PRIORITY_MIN = 1;
const PRIORITY_MAX = 5;
const SETTINGS_MIGRATION_VERSION = 5000;

function log(...args) {
    console.log("[TorgiBot BG]", ...args);
}

async function setExtensionIcon(isEnabled) {
    try {
        await chrome.action.setIcon({
            path: isEnabled ? GREEN_ICONS : BLUE_ICONS
        });

        await chrome.action.setTitle({
            title: isEnabled
                ? "Torgi Bot Pro: включен"
                : "Torgi Bot Pro: выключен"
        });
    } catch (e) {
        log("Ошибка установки иконки:", e);
    }
}

async function getSettings(tabId = null) {
    const data = await chrome.storage.local.get(DEFAULT_SETTINGS);
    const globalSettings = { ...DEFAULT_SETTINGS, ...data };
    if (tabId == null) return globalSettings;

    const session = await SESSION_STORAGE.get({ torgiBotTabSettings: {} });
    const perTab = session.torgiBotTabSettings?.[String(tabId)] || {};
    return { ...globalSettings, botEnabled: false, ...perTab };
}

async function setTabSettings(tabId, patch) {
    const session = await SESSION_STORAGE.get({ torgiBotTabSettings: {} });
    const all = session.torgiBotTabSettings || {};
    const key = String(tabId);
    const previous = all[key] || {};
    const next = { ...previous, ...(patch || {}) };

    if ("lotPriority" in (patch || {}) && patch.lotPriority != null) {
        next.lotPriority = pickAvailablePriority(all, key, patch.lotPriority);
    }

    all[key] = next;
    await SESSION_STORAGE.set({ torgiBotTabSettings: all });
}

function normalizePriority(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 1;
    return Math.max(PRIORITY_MIN, Math.min(PRIORITY_MAX, Math.round(n)));
}

function getUsedPriorities(all, exceptKey) {
    const used = new Set();
    for (const [key, value] of Object.entries(all || {})) {
        if (key === exceptKey) continue;
        if (value?.lotPriority != null) used.add(normalizePriority(value.lotPriority));
    }
    return used;
}

function pickAvailablePriority(all, ownKey, preferred) {
    const start = normalizePriority(preferred);
    const used = getUsedPriorities(all, ownKey);

    for (let i = 0; i <= PRIORITY_MAX - PRIORITY_MIN; i++) {
        const candidate = ((start - PRIORITY_MIN + i) % (PRIORITY_MAX - PRIORITY_MIN + 1)) + PRIORITY_MIN;
        if (!used.has(candidate)) return candidate;
    }

    return null;
}

async function initializeStorageDefaults() {
    const current = await chrome.storage.local.get(null);
    const patch = {};

    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (!(key in current)) {
            patch[key] = value;
        }
    }

    const migrationVersion = Number(current.torgiBotSettingsMigrationVersion || 0);
    if (migrationVersion < SETTINGS_MIGRATION_VERSION) {
        if (current.combatSoftReloadMs == null || Number(current.combatSoftReloadMs) === 1500) {
            patch.combatSoftReloadMs = DEFAULT_SETTINGS.combatSoftReloadMs;
        }
        if (current.activeApiReloadGraceMs == null || Number(current.activeApiReloadGraceMs) === 1200) {
            patch.activeApiReloadGraceMs = DEFAULT_SETTINGS.activeApiReloadGraceMs;
        }
        if (current.preStartSessionRefreshStopBefore == null || Number(current.preStartSessionRefreshStopBefore) === 30000) {
            patch.preStartSessionRefreshStopBefore = DEFAULT_SETTINGS.preStartSessionRefreshStopBefore;
        }
        if (current.buyTransitionWaitMs == null || Number(current.buyTransitionWaitMs) === 5000) {
            patch.buyTransitionWaitMs = DEFAULT_SETTINGS.buyTransitionWaitMs;
        }
        if (current.buyRecoveryMaxCount == null) {
            patch.buyRecoveryMaxCount = DEFAULT_SETTINGS.buyRecoveryMaxCount;
        }
        if (current.buyProcessingMaxWaitMs == null) {
            patch.buyProcessingMaxWaitMs = DEFAULT_SETTINGS.buyProcessingMaxWaitMs;
        }
        if (current.buyClickDelayMs == null) {
            patch.buyClickDelayMs = DEFAULT_SETTINGS.buyClickDelayMs;
        }
        if (current.minPageAgeBeforeBuyClickMs == null) {
            patch.minPageAgeBeforeBuyClickMs = DEFAULT_SETTINGS.minPageAgeBeforeBuyClickMs;
        }
        patch.torgiBotSettingsMigrationVersion = SETTINGS_MIGRATION_VERSION;
    }

    if (Object.keys(patch).length > 0) {
        await chrome.storage.local.set(patch);
    }
}

async function setBotEnabled(value) {
    await chrome.storage.local.set({ botEnabled: value });
    await setExtensionIcon(value);
}

async function getActiveTorgiTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs?.[0];
    if (!tab?.id || !tab.url?.includes("torgi.gov.ru")) return null;
    return tab.id;
}

async function getSignLock() {
    const data = await SESSION_STORAGE.get({ torgiBotSignLock: null });
    return data.torgiBotSignLock || null;
}

async function getSignWaiters() {
    const data = await SESSION_STORAGE.get({ torgiBotSignWaiters: {} });
    return data.torgiBotSignWaiters || {};
}

async function setSignWaiters(waiters) {
    await SESSION_STORAGE.set({ torgiBotSignWaiters: waiters || {} });
}

async function setSignLock(lock) {
    if (lock) {
        await SESSION_STORAGE.set({ torgiBotSignLock: lock });
    } else {
        await SESSION_STORAGE.remove("torgiBotSignLock");
    }
}

async function cleanupSignLock() {
    const signLock = await getSignLock();
    if (signLock && Date.now() - signLock.at > SIGN_LOCK_TTL_MS) {
        log("Освобождаю просроченный замок подписи:", signLock);
        await setSignLock(null);
        return null;
    }
    return signLock;
}

async function acquireSignLock(message, sender) {
    const signLock = await cleanupSignLock();

    const tabId = sender?.tab?.id ?? null;
    const tabKey = String(tabId);
    const lotId = message?.lotId || "unknown";
    const url = sender?.tab?.url || "";
    const now = Date.now();
    const priority = message?.lotPriority == null ? null : normalizePriority(message.lotPriority);
    const startTimeMs = Number(message?.startTimeMs || 0) || Number.MAX_SAFE_INTEGER;

    if (!signLock || (signLock.tabId === tabId && signLock.lotId === lotId)) {
        const waiters = await getSignWaiters();
        waiters[tabKey] = {
            tabId,
            lotId,
            url,
            stage: message?.stage || null,
            priority,
            startTimeMs,
            requestedAt: waiters[tabKey]?.requestedAt || now,
            updatedAt: now
        };

        const freshWaiters = Object.fromEntries(
            Object.entries(waiters).filter(([, waiter]) => now - (waiter.updatedAt || 0) < SIGN_LOCK_TTL_MS)
        );
        await setSignWaiters(freshWaiters);

        const best = chooseBestSignWaiter(freshWaiters);
        const queueStartedAt = Math.min(...Object.values(freshWaiters).map(waiter => waiter.requestedAt || now));
        if (best?.tabId !== tabId || now - queueStartedAt < SIGN_QUEUE_COLLECT_MS) {
            return { ok: true, acquired: false, queued: true, owner: signLock, best };
        }

        const nextLock = {
            tabId,
            lotId,
            url,
            stage: message?.stage || null,
            priority,
            startTimeMs,
            at: Date.now()
        };
        delete freshWaiters[tabKey];
        await setSignWaiters(freshWaiters);
        await setSignLock(nextLock);
        return { ok: true, acquired: true, lock: nextLock };
    }

    const waiters = await getSignWaiters();
    waiters[tabKey] = {
        tabId,
        lotId,
        url,
        stage: message?.stage || null,
        priority,
        startTimeMs,
        requestedAt: waiters[tabKey]?.requestedAt || now,
        updatedAt: now
    };
    await setSignWaiters(waiters);

    return { ok: true, acquired: false, owner: signLock };
}

async function releaseSignLock(message, sender) {
    const signLock = await getSignLock();
    const tabId = sender?.tab?.id ?? null;
    const lotId = message?.lotId || "unknown";

    if (!signLock || (signLock.tabId === tabId && signLock.lotId === lotId)) {
        await setSignLock(null);
    }

    const waiters = await getSignWaiters();
    delete waiters[String(tabId)];
    await setSignWaiters(waiters);

    return { ok: true };
}

function chooseBestSignWaiter(waiters) {
    return Object.values(waiters || {}).sort((a, b) => {
        const priorityA = a.priority == null ? Number.MAX_SAFE_INTEGER : a.priority;
        const priorityB = b.priority == null ? Number.MAX_SAFE_INTEGER : b.priority;
        if (priorityA !== priorityB) return priorityA - priorityB;
        if (a.startTimeMs !== b.startTimeMs) return a.startTimeMs - b.startTimeMs;
        return (a.requestedAt || 0) - (b.requestedAt || 0);
    })[0] || null;
}

async function reloadActiveTorgiTab() {
    try {
        const tabs = await chrome.tabs.query({
            active: true,
            currentWindow: true
        });

        const tab = tabs[0];
        if (!tab || !tab.id || !tab.url) return;

        if (tab.url.includes("torgi.gov.ru")) {
            await chrome.tabs.reload(tab.id);
        }
    } catch (e) {
        log("Ошибка перезагрузки вкладки:", e);
    }
}

function parseTime100HtmlToIso(html) {
    const match = html.match(/datetime=["']([^"']+)["']/i);
    if (!match || !match[1]) return null;

    const parsed = new Date(match[1]);
    if (Number.isNaN(parsed.getTime())) return null;

    return parsed.toISOString();
}

async function getTime100MoscowTime() {
    const res = await fetch("https://time100.ru/moscow", {
        method: "GET",
        cache: "no-store"
    });

    const html = await res.text();

    const parsedIso = parseTime100HtmlToIso(html);
    if (parsedIso) {
        return { ok: true, iso: parsedIso, source: "time100-datetime" };
    }

    const dateHeader = res.headers.get("date");
    if (dateHeader) {
        const serverDate = new Date(dateHeader);
        if (!Number.isNaN(serverDate.getTime())) {
            return { ok: true, iso: serverDate.toISOString(), source: "http-date" };
        }
    }

    return { ok: false, error: "Не удалось получить время" };
}


chrome.runtime.onInstalled.addListener(async () => {
    await initializeStorageDefaults();
    await setExtensionIcon(false);
});

chrome.runtime.onStartup.addListener(async () => {
    await initializeStorageDefaults();
    const settings = await getSettings();
    await setExtensionIcon(settings.botEnabled === true);
});

chrome.action.onClicked.addListener(async () => {
    const settings = await getSettings();
    const newValue = !settings.botEnabled;
    await setBotEnabled(newValue);
});

chrome.tabs.onRemoved.addListener(async tabId => {
    const session = await SESSION_STORAGE.get({ torgiBotTabSettings: {} });
    const all = session.torgiBotTabSettings || {};
    delete all[String(tabId)];
    await SESSION_STORAGE.set({ torgiBotTabSettings: all });

    const signLock = await getSignLock();
    if (signLock?.tabId === tabId) {
        await setSignLock(null);
    }

    const waiters = await getSignWaiters();
    delete waiters[String(tabId)];
    await setSignWaiters(waiters);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
        if (message?.type === "PING") {
            sendResponse({ ok: true });
            return;
        }

        if (message?.type === "GET_SETTINGS") {
            const settings = await getSettings(sender?.tab?.id ?? null);
            sendResponse({ ok: true, settings });
            return;
        }

        if (message?.type === "GET_ACTIVE_TAB_SETTINGS") {
            const tabId = await getActiveTorgiTabId();
            if (tabId == null) {
                sendResponse({ ok: false, error: "Откройте активную вкладку torgi.gov.ru" });
                return;
            }
            const settings = await getSettings(tabId);
            sendResponse({ ok: true, settings });
            return;
        }

        if (message?.type === "SET_TAB_SETTINGS") {
            const tabId = sender?.tab?.id;
            if (tabId == null) {
                sendResponse({ ok: false, error: "tabId not found" });
                return;
            }
            await setTabSettings(tabId, message.payload || {});
            const settings = await getSettings(tabId);
            sendResponse({ ok: true, settings });
            return;
        }

        if (message?.type === "SET_ACTIVE_TAB_SETTINGS") {
            const tabId = await getActiveTorgiTabId();
            if (tabId == null) {
                sendResponse({ ok: false, error: "Откройте активную вкладку torgi.gov.ru" });
                return;
            }
            await setTabSettings(tabId, message.payload || {});
            const settings = await getSettings(tabId);
            try {
                await chrome.tabs.sendMessage(tabId, {
                    type: "TAB_SETTINGS_CHANGED",
                    settings
                });
            } catch (e) {
                log("Не удалось уведомить вкладку о настройках:", e);
            }
            sendResponse({ ok: true, settings });
            return;
        }

        if (message?.type === "SET_SETTINGS") {
            await chrome.storage.local.set(message.payload || {});
            const settings = await getSettings();
            await setExtensionIcon(settings.botEnabled === true);
            sendResponse({ ok: true, settings });
            return;
        }

        if (message?.type === "SIGN_LOCK_ACQUIRE") {
            sendResponse(await acquireSignLock(message, sender));
            return;
        }

        if (message?.type === "SIGN_LOCK_RELEASE") {
            sendResponse(await releaseSignLock(message, sender));
            return;
        }

        if (message?.type === "GET_TIME100_MOSCOW_TIME") {
            const result = await getTime100MoscowTime();
            sendResponse(result);
            return;
        }

        sendResponse({ ok: false, error: "Неизвестный type" });
    })().catch(error => {
        sendResponse({ ok: false, error: String(error) });
    });

    return true;
});
