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
    buyClickDelayMs: 150,
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
const SETTINGS_MIGRATION_VERSION = 5710;

// ============== COMBAT ALARM PLAN (v5.6) ==============
// Защита от Chrome throttling скрытых вкладок:
// background через chrome.alarms сам активирует вкладку и шлёт reload в T-0
// и в страховочные точки T+0.8s / T+1.6s / T+2.4s, даже если content.js заморожен.
const COMBAT_PLAN_KEY = "torgiBotCombatPlan";
const COMBAT_ALARM_PREFIX = "torgiBotCombat:";
// Смещения относительно startTimeMs:
//   -3000  — активировать вкладку (снять throttling до старта)
//       0  — T-0 reload
//   +800/+1600/+2400 — страховочные reload, если кнопка не появилась
const COMBAT_ALARM_STEPS = [
    { id: "wake", offsetMs: -3000, kind: "activate" },
    { id: "t0",   offsetMs: 0,     kind: "reload" },
    { id: "s1",   offsetMs: 800,   kind: "reload_if_no_buy" },
    { id: "s2",   offsetMs: 1600,  kind: "reload_if_no_buy" },
    { id: "s3",   offsetMs: 2400,  kind: "reload_if_no_buy" }
];

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
        // v5.7.1: миграция старых значений buyClickDelayMs (500/300) → 150 для ускорения клика «Купить».
        if (current.buyClickDelayMs == null
            || Number(current.buyClickDelayMs) === 500
            || Number(current.buyClickDelayMs) === 300) {
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


// ===== Combat alarm plan helpers (v5.6) =====

async function getCombatPlans() {
    const data = await SESSION_STORAGE.get({ [COMBAT_PLAN_KEY]: {} });
    return data[COMBAT_PLAN_KEY] || {};
}

async function setCombatPlans(plans) {
    await SESSION_STORAGE.set({ [COMBAT_PLAN_KEY]: plans || {} });
}

function combatAlarmName(tabId, stepId) {
    return `${COMBAT_ALARM_PREFIX}${tabId}:${stepId}`;
}

async function clearCombatAlarmsForTab(tabId) {
    try {
        const all = await chrome.alarms.getAll();
        const prefix = `${COMBAT_ALARM_PREFIX}${tabId}:`;
        await Promise.all(
            all.filter(a => a.name.startsWith(prefix)).map(a => chrome.alarms.clear(a.name))
        );
    } catch (e) {
        log("clearCombatAlarmsForTab error:", e);
    }
}

async function clearAllCombatAlarms() {
    try {
        const all = await chrome.alarms.getAll();
        await Promise.all(
            all.filter(a => a.name.startsWith(COMBAT_ALARM_PREFIX)).map(a => chrome.alarms.clear(a.name))
        );
    } catch (e) {
        log("clearAllCombatAlarms error:", e);
    }
}

async function registerCombatPlan(message, sender) {
    const tabId = sender?.tab?.id;
    const startTimeMs = Number(message?.startTimeMs || 0);
    if (!tabId || !startTimeMs) {
        return { ok: false, error: "tabId/startTimeMs missing" };
    }

    const lotId = message?.lotId || null;
    const url = sender?.tab?.url || null;
    const now = Date.now();

    // Снимаем старые alarm-ы для этой вкладки
    await clearCombatAlarmsForTab(tabId);

    const plans = await getCombatPlans();
    plans[String(tabId)] = {
        tabId,
        startTimeMs,
        lotId,
        url,
        registeredAt: now
    };
    await setCombatPlans(plans);

    const scheduled = [];
    for (const step of COMBAT_ALARM_STEPS) {
        const whenMs = startTimeMs + step.offsetMs;
        // Chrome alarms имеют минимальный delay ~0.5 мин по умолчанию,
        // но при when в будущем они срабатывают почти точно (особенно когда SW проснётся).
        // Если момент уже прошёл — пропускаем.
        if (whenMs <= now + 50) continue;
        try {
            await chrome.alarms.create(combatAlarmName(tabId, step.id), { when: whenMs });
            scheduled.push({ id: step.id, whenMs, offsetMs: step.offsetMs });
        } catch (e) {
            log("alarms.create error:", step.id, e);
        }
    }

    log("Combat plan registered tab=", tabId, "start=", new Date(startTimeMs).toISOString(),
        "scheduled=", scheduled.map(s => `${s.id}@${s.offsetMs}`).join(","));

    return { ok: true, scheduled };
}

async function cancelCombatPlan(message, sender) {
    const tabId = sender?.tab?.id ?? message?.tabId;
    if (!tabId) return { ok: false, error: "tabId missing" };

    await clearCombatAlarmsForTab(tabId);
    const plans = await getCombatPlans();
    delete plans[String(tabId)];
    await setCombatPlans(plans);
    log("Combat plan cancelled tab=", tabId, "reason=", message?.reason || "manual");
    return { ok: true };
}

async function pingContent(tabId) {
    try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: "PING" });
        return !!resp?.ok;
    } catch (e) {
        return false;
    }
}

async function hasBuyButtonInTab(tabId) {
    try {
        const resp = await chrome.tabs.sendMessage(tabId, { type: "QUERY_BUY_BUTTON" });
        return !!resp?.present;
    } catch (e) {
        return null; // unknown
    }
}

async function activateTab(tabId) {
    try {
        await chrome.tabs.update(tabId, { active: true });
    } catch (e) {
        log("tabs.update active error:", e);
    }
}

async function reloadTab(tabId) {
    try {
        await chrome.tabs.reload(tabId);
    } catch (e) {
        log("tabs.reload error:", e);
    }
}

chrome.alarms.onAlarm.addListener(async alarm => {
    if (!alarm?.name?.startsWith(COMBAT_ALARM_PREFIX)) return;

    const rest = alarm.name.slice(COMBAT_ALARM_PREFIX.length);
    const [tabIdStr, stepId] = rest.split(":");
    const tabId = Number(tabIdStr);
    if (!tabId) return;

    const plans = await getCombatPlans();
    const plan = plans[String(tabId)];
    if (!plan) {
        log("Alarm fired but no plan for tab=", tabId, "step=", stepId);
        return;
    }

    // Проверяем, что вкладка ещё существует и боевая
    let tab;
    try {
        tab = await chrome.tabs.get(tabId);
    } catch (e) {
        await clearCombatAlarmsForTab(tabId);
        delete plans[String(tabId)];
        await setCombatPlans(plans);
        return;
    }

    if (!tab?.url || !tab.url.includes("torgi.gov.ru")) {
        log("Alarm: tab no longer on torgi, dropping plan tab=", tabId);
        await clearCombatAlarmsForTab(tabId);
        delete plans[String(tabId)];
        await setCombatPlans(plans);
        return;
    }

    const settings = await getSettings(tabId);
    if (settings.botEnabled !== true) {
        log("Alarm: bot disabled for tab=", tabId, "— cancelling plan");
        await clearCombatAlarmsForTab(tabId);
        delete plans[String(tabId)];
        await setCombatPlans(plans);
        return;
    }

    const step = COMBAT_ALARM_STEPS.find(s => s.id === stepId);
    if (!step) return;

    log("Alarm fired tab=", tabId, "step=", stepId, "kind=", step.kind, "lateMs=", Date.now() - (plan.startTimeMs + step.offsetMs));

    if (step.kind === "activate") {
        // Снимаем throttling: делаем вкладку активной
        if (!tab.active) {
            await activateTab(tabId);
        }
        // ping контента — если жив, он сам подхватит
        await pingContent(tabId);
        return;
    }

    if (step.kind === "reload") {
        // T-0: безусловный reload через background, чтобы обойти заморозку
        // Сначала делаем активной (на случай если она ещё не активна)
        if (!tab.active) await activateTab(tabId);
        await reloadTab(tabId);
        return;
    }

    if (step.kind === "reload_if_no_buy") {
        // Страховка: если кнопки всё ещё нет — ещё один reload
        if (!tab.active) await activateTab(tabId);
        const present = await hasBuyButtonInTab(tabId);
        // present === true → не трогаем; false или null (контент не отвечает) → reload
        if (present === true) {
            log("Alarm safety step", stepId, ": buy button present, skipping reload");
            // План больше не нужен — кнопка есть
            await clearCombatAlarmsForTab(tabId);
            delete plans[String(tabId)];
            await setCombatPlans(plans);
            return;
        }
        log("Alarm safety step", stepId, ": no buy button (present=", present, ") → reload");
        await reloadTab(tabId);
        return;
    }
});

chrome.runtime.onInstalled.addListener(async () => {
    await initializeStorageDefaults();
    await setExtensionIcon(false);
    await clearAllCombatAlarms();
    await setCombatPlans({});
});

chrome.runtime.onStartup.addListener(async () => {
    await initializeStorageDefaults();
    const settings = await getSettings();
    await setExtensionIcon(settings.botEnabled === true);
    await clearAllCombatAlarms();
    await setCombatPlans({});
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

    // v5.6: убираем combat-план для закрытой вкладки
    await clearCombatAlarmsForTab(tabId);
    const plans = await getCombatPlans();
    if (plans[String(tabId)]) {
        delete plans[String(tabId)];
        await setCombatPlans(plans);
    }
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

        if (message?.type === "REGISTER_COMBAT_PLAN") {
            sendResponse(await registerCombatPlan(message, sender));
            return;
        }

        if (message?.type === "CANCEL_COMBAT_PLAN") {
            sendResponse(await cancelCombatPlan(message, sender));
            return;
        }

        if (message?.type === "GET_TORGI_TABS_COUNT") {
            try {
                const tabs = await chrome.tabs.query({ url: "*://*.torgi.gov.ru/*" });
                sendResponse({ ok: true, count: tabs.length, tabIds: tabs.map(t => t.id) });
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
            return;
        }

        if (message?.type === "START_ALL_TABS" || message?.type === "STOP_ALL_TABS") {
            const enable = message.type === "START_ALL_TABS";
            try {
                const tabs = await chrome.tabs.query({ url: "*://*.torgi.gov.ru/*" });
                let applied = 0;
                for (const tab of tabs) {
                    if (tab.id == null) continue;
                    try {
                        await setTabSettings(tab.id, { botEnabled: enable });
                        const settings = await getSettings(tab.id);
                        try {
                            await chrome.tabs.sendMessage(tab.id, {
                                type: "TAB_SETTINGS_CHANGED",
                                settings,
                                broadcast: true
                            });
                        } catch (_) { /* вкладка может не иметь content script */ }
                        applied++;
                    } catch (e) {
                        log("START/STOP_ALL: ошибка для вкладки", tab.id, e);
                    }
                }
                sendResponse({ ok: true, applied, total: tabs.length, enabled: enable });
            } catch (e) {
                sendResponse({ ok: false, error: String(e) });
            }
            return;
        }

        sendResponse({ ok: false, error: "Неизвестный type" });
    })().catch(error => {
        sendResponse({ ok: false, error: String(error) });
    });

    return true;
});
