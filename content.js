(() => {
    "use strict";

    if (window.__torgiBotInjected) return;
    window.__torgiBotInjected = true;

    let started = false;
    const _savedState = sessionStorage.getItem("torgiBotState") || "WAIT_BUY";
    const _nonResumable = ["AUTH_REQUIRED", "AUTH_OR_BACKEND_GATE", "WIN", "LOSS"];
    const _savedStateWasNonResumable = _nonResumable.includes(_savedState);
    let state = _savedStateWasNonResumable ? "WAIT_BUY" : _savedState;

    let settings = null;
    let widgetEl = null;
    let widgetTimer = null;
    let logicTimer = null;
    let observerRunTimer = null;
    let enableTimer = null;
    let mutationObserver = null;
    let reloadTimer = null;
    let preStartSessionRefreshTimer = null;
    let lastTimingInfo = null;
    let lastParsedStartText = null;
    let lastStartLogKey = null;
    let lastBuyCheckLogTs = 0;
    let buyClickedAt = 0;
    let buyClickedUrl = "";
    let buyRecoveryCount = 0;
    let softAuthDialogRetryCount = Number(sessionStorage.getItem("torgiBotSoftAuthDialogRetryCount") || "0");
    let postReloadSoftAuthRetryCount = Number(sessionStorage.getItem("torgiBotPostReloadSoftAuthRetryCount") || "0");
    let softAuthDialogRetryScheduled = false;
    let buyFlowStartedAt = 0;
    let lastBuyButtonFoundAt = 0;
    let lastBuyFlowDurationMs = null;
    let lastBuyFlowDurationLabel = "";
    let lastOfferSignClickAt = 0;
    let lastCryptoSignClickAt = 0;
    let lastCertDropdownClickAt = 0;
    let lastSelectedStartInfo = null;
    let lastApiStartInfo = null;
    let lastApiStartFetchAt = 0;
    let pageReadyAt = Date.now();
    let logicRunning = false;
    let signLockHeld = false;
    let signLockWaitStartedAt = 0;
    let activeStatusReloadStarted = false;
    let activeStatusFirstSeenAt = 0;
    let combatWatchStartedAt = 0;
    let combatStartReachedLogged = false;
    let diagnosticTimer = null;
    let diagnosticActive = sessionStorage.getItem("torgiBotDiagnosticActive") === "1";
    let diagnosticLastApiData = null;
    let diagnosticLastApiStatus = null;
    let diagnosticBuySeenKey = sessionStorage.getItem("torgiBotDiagnosticBuySeenKey") || "";
    let diagnosticBuyVisibleKey = sessionStorage.getItem("torgiBotDiagnosticBuyVisibleKey") || "";
    let diagnosticBuyClickableKey = sessionStorage.getItem("torgiBotDiagnosticBuyClickableKey") || "";
    let diagnosticBuyNotClickableKey = sessionStorage.getItem("torgiBotDiagnosticBuyNotClickableKey") || "";
    let diagnosticOfferLossSeenKey = sessionStorage.getItem("torgiBotDiagnosticOfferLossSeenKey") || "";
    let lastAuthDiagnostics = null;
    let diagnosticLog = [];
    let lastReportCopyStatus = "";
    let authStateMeta = null;
    const DIAGNOSTIC_LOG_LIMIT = 3000;
    const SOFT_AUTH_DIALOG_RETRY_MAX = 3;
    const SOFT_AUTH_DIALOG_RETRY_DELAY_MS = 600;
    const POST_RELOAD_SOFT_AUTH_RETRY_DELAY_MS = 600;
    const SOFT_AUTH_CANCEL_WAIT_MS = 250;
    const SOFT_AUTH_CANCEL_WAIT_MAX = 4;
    const BUY_ACTIONABILITY_STABLE_MS = 100;
    const DEFAULT_BUY_CLICK_DELAY_MS = 150;
    const DEFAULT_MIN_PAGE_AGE_BEFORE_BUY_CLICK_MS = 500;

    try {
        diagnosticLog = JSON.parse(sessionStorage.getItem("torgiBotDiagnosticLog") || "[]");
        if (!Array.isArray(diagnosticLog)) diagnosticLog = [];
    } catch (_) {
        diagnosticLog = [];
    }

    try {
        authStateMeta = JSON.parse(sessionStorage.getItem("torgiBotAuthStateMeta") || "null");
    } catch (_) {
        authStateMeta = null;
    }
    if (_savedStateWasNonResumable) {
        authStateMeta = null;
        sessionStorage.removeItem("torgiBotAuthStateMeta");
    }

    sessionStorage.removeItem("torgiBotDiagnosticReloadStress");

    // ================= v5.5 DIAGNOSTIC EXTENSIONS (passive only) =================
    // Все ниже — только сбор данных. Не влияет на FSM, reload, клики.
    const DIAG_SESSION_ID = (() => {
        let id = sessionStorage.getItem("torgiBotDiagSessionId");
        if (!id) {
            id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
            sessionStorage.setItem("torgiBotDiagSessionId", id);
        }
        return id;
    })();

    let diagDomMutationCount = 0;
    let diagDomMutationsSinceLastTick = 0;
    let diagWasHiddenSinceLastTick = (document.visibilityState === "hidden");
    let diagLastTickAt = 0;
    let diagLastResourceCount = 0;
    let diagBuyAppearLogged = false;
    let diagBuyClickableAppearLogged = false;
    let diagBuyDomFirstSeenAt = 0;
    let diagBuyClickableFirstSeenAt = 0;

    try {
        const diagMo = new MutationObserver((mutations) => {
            diagDomMutationCount += mutations.length;
            diagDomMutationsSinceLastTick += mutations.length;
        });
        diagMo.observe(document.documentElement || document, {
            childList: true, subtree: true, attributes: true, characterData: false
        });
    } catch (_) {}

    try {
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "hidden") diagWasHiddenSinceLastTick = true;
        }, true);
    } catch (_) {}

    function diagGetPageLoadDurationMs() {
        try {
            const nav = performance.getEntriesByType?.("navigation")?.[0];
            if (nav && nav.loadEventEnd > 0) {
                return Math.round(nav.loadEventEnd - nav.startTime);
            }
            const t = performance.timing;
            if (t && t.loadEventEnd > 0 && t.navigationStart > 0) {
                return t.loadEventEnd - t.navigationStart;
            }
        } catch (_) {}
        return null;
    }

    function diagGetNavigationType() {
        try {
            const nav = performance.getEntriesByType?.("navigation")?.[0];
            if (nav) return nav.type || null;
        } catch (_) {}
        return null;
    }

    function diagGetTMinusMs() {
        try {
            const startMs = lastTimingInfo?.start ? new Date(lastTimingInfo.start).getTime() : 0;
            if (!startMs) return null;
            const now = (typeof getSyncedNowDate === "function") ? getSyncedNowDate().getTime() : Date.now();
            return startMs - now;
        } catch (_) { return null; }
    }

    function diagCollectNewResources() {
        try {
            const all = performance.getEntriesByType?.("resource") || [];
            const fresh = all.slice(diagLastResourceCount);
            diagLastResourceCount = all.length;
            const filtered = fresh
                .filter(r => r.initiatorType === "xmlhttprequest" || r.initiatorType === "fetch")
                .slice(-40)
                .map(r => {
                    let path = r.name;
                    try {
                        const u = new URL(r.name);
                        path = u.pathname + (u.search ? "?" + u.search.slice(0, 60) : "");
                    } catch (_) {}
                    return {
                        url: path.slice(0, 220),
                        type: r.initiatorType,
                        startMs: Math.round(r.startTime),
                        durMs: Math.round(r.duration),
                        size: r.transferSize || 0,
                        status: r.responseStatus || null
                    };
                });
            return { newCount: fresh.length, totalCount: all.length, items: filtered };
        } catch (e) {
            return { newCount: 0, totalCount: 0, items: [], error: String(e) };
        }
    }

    function diagBuildExtras() {
        const tMinus = diagGetTMinusMs();
        const extras = {
            sid: DIAG_SESSION_ID,
            tMinus,
            visibilityState: document.visibilityState,
            wasHiddenSinceLastTick: diagWasHiddenSinceLastTick,
            documentReadyState: document.readyState,
            domMutationsSinceLastTick: diagDomMutationsSinceLastTick,
            domMutationsTotal: diagDomMutationCount,
            pageLoadDurationMs: diagGetPageLoadDurationMs(),
            navigationType: diagGetNavigationType(),
            pageAgeMs: Date.now() - pageReadyAt,
            network: diagCollectNewResources()
        };
        diagDomMutationsSinceLastTick = 0;
        diagWasHiddenSinceLastTick = (document.visibilityState === "hidden");
        diagLastTickAt = Date.now();
        return extras;
    }

    // Снимаем "первое появление" кнопки Купить и первой кликабельности с tMinus
    function diagMaybeRecordBuyAppear(snapshot) {
        try {
            if (snapshot.buyButtonPresentDom && !diagBuyAppearLogged) {
                diagBuyAppearLogged = true;
                diagBuyDomFirstSeenAt = Date.now();
                diagnosticRecord("v55_buy_appear_dom", {
                    tMinus: diagGetTMinusMs(),
                    visibilityState: document.visibilityState,
                    documentReadyState: document.readyState,
                    pageAgeMs: Date.now() - pageReadyAt,
                    pageLoadDurationMs: diagGetPageLoadDurationMs(),
                    lotId: snapshot.lotId,
                    visible: snapshot.buyButtonVisible,
                    clickable: snapshot.buyButtonClickable
                });
            }
            if (snapshot.buyButtonClickable && !diagBuyClickableAppearLogged) {
                diagBuyClickableAppearLogged = true;
                diagBuyClickableFirstSeenAt = Date.now();
                diagnosticRecord("v55_buy_appear_clickable", {
                    tMinus: diagGetTMinusMs(),
                    visibilityState: document.visibilityState,
                    pageAgeMs: Date.now() - pageReadyAt,
                    clickableDelayFromDomMs: diagBuyDomFirstSeenAt
                        ? (diagBuyClickableFirstSeenAt - diagBuyDomFirstSeenAt) : null,
                    lotId: snapshot.lotId
                });
            }
        } catch (_) {}
    }

    // Терминальные/особые состояния — снимаем "прощальный" снапшот (последние ~20 тиков уже в логе)
    function diagRecordFarewell(reason) {
        try {
            diagnosticRecord("v55_farewell", {
                reason,
                tMinus: diagGetTMinusMs(),
                state,
                url: location.href,
                visibilityState: document.visibilityState,
                documentReadyState: document.readyState,
                pageAgeMs: Date.now() - pageReadyAt,
                botEnabled: !!settings?.botEnabled,
                authRequired: (typeof isAuthRequired === "function") ? isAuthRequired() : null,
                lastApiStatus: diagnosticLastApiStatus
            });
        } catch (_) {}
    }
    // ================= /v5.5 =================

    function playDoneSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const tones = [880, 1100, 1320];
            tones.forEach((freq, i) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.type = "sine";
                osc.frequency.value = freq;
                const start = ctx.currentTime + i * 0.18;
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(0.4, start + 0.04);
                gain.gain.linearRampToValueAtTime(0, start + 0.18);
                osc.start(start);
                osc.stop(start + 0.2);
            });
        } catch (e) {
            log("Не удалось воспроизвести звук:", e);
        }
    }

    async function playOggSound(filename) {
        try {
            const url = chrome.runtime.getURL(filename);
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(ctx.destination);
            source.start(0);
        } catch (e) {
            log("Не удалось воспроизвести звук", filename, ":", e);
            playDoneSound();
        }
    }

    function watchForWinOrLoss() {
        const originalUrl = location.href;
        const checkEveryMs = 300;
        const maxWaitMs = 12000;
        let elapsed = 0;

        const interval = setInterval(() => {
            elapsed += checkEveryMs;

            if (location.href !== originalUrl) {
                clearInterval(interval);
                log("Победа: страница перешла на", location.href);
                setState("WIN");
                playOggSound("sound-win.ogg");
                return;
            }

            if (elapsed >= maxWaitMs) {
                clearInterval(interval);
                log("Поражение: страница не сменилась за", maxWaitMs, "мс");
                setState("LOSS");
                playOggSound("sound-loss.ogg");
            }
        }, checkEveryMs);
    }

    let timeSync = {
        ok: false,
        lastSyncAtLocalMs: 0,
        lastSyncServerMs: 0,
        source: null
    };

    function log(...args) {
        console.log("[TorgiBot]", ...args);
    }

    function persistDiagnosticLog() {
        try {
            sessionStorage.setItem("torgiBotDiagnosticLog", JSON.stringify(diagnosticLog.slice(-DIAGNOSTIC_LOG_LIMIT)));
        } catch (_) {}
    }

    function diagnosticRecord(type, payload = {}) {
        const entry = {
            ts: new Date().toISOString(),
            type,
            url: location.href,
            state,
            ...payload
        };

        diagnosticLog.push(entry);
        if (diagnosticLog.length > DIAGNOSTIC_LOG_LIMIT) diagnosticLog = diagnosticLog.slice(-DIAGNOSTIC_LOG_LIMIT);
        persistDiagnosticLog();
        console.log("[TorgiBot DIAG]", entry);
        updateWidget();
        return entry;
    }

    // === v5.7-debug: микро-таймстемпы фаз для анализа реальной параллельности ===
    function dbg(stage, extra = {}) {
        try {
            diagnosticRecord("dbg_" + stage, {
                tMs: Date.now(),
                lotId: (typeof getLotIdFromUrl === "function") ? getLotIdFromUrl() : null,
                priority: settings?.lotPriority ?? null,
                signLockHeld,
                ...extra
            });
        } catch (e) {
            try { console.warn("[TorgiBot dbg]", stage, e); } catch (_) {}
        }
    }

    function collectAuthDialogSnapshot() {
        const authDialog = findAuthDialog();
        const text = normalizeText(authDialog?.innerText || authDialog?.textContent);
        return {
            at: new Date().toISOString(),
            present: !!authDialog,
            text: text.slice(0, 1200),
            html: authDialog?.outerHTML ? authDialog.outerHTML.slice(0, 2000) : ""
        };
    }

    function recordAuthTerminalState(nextState, reason, details = {}) {
        if (authStateMeta?.authStateReason) return authStateMeta;

        const realAuthReason = details.realAuthReason ?? getRealAuthUrlReason() ?? null;
        const authDialogSnapshotAt = details.authDialogSnapshotAt || collectAuthDialogSnapshot();
        authStateMeta = {
            authStateReason: reason,
            authStateAt: new Date().toISOString(),
            authStateUrlAt: location.href,
            authDialogSnapshotAt,
            softDialogAttempts: {
                afterBuy: softAuthDialogRetryCount,
                afterReload: postReloadSoftAuthRetryCount
            },
            realAuthReason,
            terminalState: nextState,
            source: details.source || null,
            context: details.context || null
        };

        try {
            sessionStorage.setItem("torgiBotAuthStateMeta", JSON.stringify(authStateMeta));
        } catch (_) {}

        diagnosticRecord("fsm_terminal_state", authStateMeta);
        diagRecordFarewell("fsm_terminal_state");
        return authStateMeta;
    }

    function clearAuthStateMeta() {
        authStateMeta = null;
        sessionStorage.removeItem("torgiBotAuthStateMeta");
    }

    function shouldTraceTestFlow() {
        return diagnosticActive || settings?.stopBeforeFinalSelect !== false;
    }

    function traceTestFlow(type, payload = {}) {
        if (!shouldTraceTestFlow()) return;
        diagnosticRecord(type, payload);
    }

    function traceTestFlowThrottled(type, payload = {}, ms = TRACE_THROTTLE_MS) {
        const now = Date.now();
        if (traceThrottle[type] && now - traceThrottle[type] < ms) return;
        traceThrottle[type] = now;
        traceTestFlow(type, payload);
    }

    function getCombatTimingPayload(payload = {}) {
        const now = getSyncedNowDate();
        const nowMs = now?.getTime?.() || Date.now();
        const start = lastTimingInfo?.start || null;
        const startMs = start?.getTime?.() || 0;
        const combatAt = lastTimingInfo?.combatAt || (startMs ? startMs - Number(settings?.preStartSeconds ?? 5) * 1000 : 0);
        const buyButtonDiagnostics = getBuyButtonDiagnostics();

        return {
            nowMoscow: formatDateMoscow(now),
            startMoscow: start ? formatDateMoscow(start) : null,
            combatAtMoscow: combatAt ? formatDateMoscow(new Date(combatAt)) : null,
            msFromStart: startMs ? nowMs - startMs : null,
            msToStart: startMs ? startMs - nowMs : null,
            msFromCombat: combatAt ? nowMs - combatAt : null,
            pageReadyAgeMs: Date.now() - pageReadyAt,
            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
            buyButtonVisible: buyButtonDiagnostics.visible,
            buyButtonClickable: buyButtonDiagnostics.clickable,
            buyButtonDiagnostics,
            lotId: getLotIdFromUrl(),
            ...payload
        };
    }

    function trackedReload(reason, payload = {}) {
        const info = {
            ts: new Date().toISOString(),
            reason,
            url: location.href,
            state,
            apiStatus: diagnosticLastApiStatus,
            ...getCombatTimingPayload(),
            ...payload
        };

        try {
            sessionStorage.setItem("torgiBotLastTrackedReload", JSON.stringify(info));
        } catch (_) {}

        diagnosticRecord("reload_before", { ...info, v55: (typeof diagBuildExtras === "function") ? diagBuildExtras() : null });
        try { diagRecordFarewell("reload:" + reason); } catch (_) {}
        location.reload();
    }

    function getActiveApiStartReloadLot() {
        return sessionStorage.getItem("torgiBotActiveApiStartReloadLot") || "";
    }

    function markActiveApiStartReloadDone(lotId) {
        if (lotId) sessionStorage.setItem("torgiBotActiveApiStartReloadLot", lotId);
    }

    function hasActiveApiStartReloadDone(lotId) {
        return !!lotId && getActiveApiStartReloadLot() === lotId;
    }

    function getStartTimeReloadKey(lotId = getLotIdFromUrl(), startMs = lastTimingInfo?.start?.getTime?.() || 0) {
        if (!lotId || !startMs) return "";
        return `${lotId}:${startMs}`;
    }

    function hasStartTimeReloadDone(lotId = getLotIdFromUrl(), startMs = lastTimingInfo?.start?.getTime?.() || 0) {
        const key = getStartTimeReloadKey(lotId, startMs);
        return !!key && sessionStorage.getItem("torgiBotStartTimeReloadKey") === key;
    }

    function markStartTimeReloadDone(lotId = getLotIdFromUrl(), startMs = lastTimingInfo?.start?.getTime?.() || 0) {
        const key = getStartTimeReloadKey(lotId, startMs);
        if (key) sessionStorage.setItem("torgiBotStartTimeReloadKey", key);
    }

    function reloadAtStartTimeIfNeeded(timing, reason = "start_time_reached") {
        if (!settings?.botEnabled || state !== "WAIT_BUY") return false;
        if (!timing?.start || timing.forceActive || timing.msToStart > 0 || isAuthRequired()) return false;

        const lotId = getLotIdFromUrl();
        const startMs = timing.start.getTime();
        if (!lotId || hasStartTimeReloadDone(lotId, startMs)) return false;

        markStartTimeReloadDone(lotId, startMs);
        sessionStorage.setItem("torgiBotCombatReload", "1");
        diagnosticRecord("start_time_controlled_reload", getCombatTimingPayload({
            reason,
            lotId,
            startMoscow: formatDateMoscow(timing.start),
            ...getBuyButtonDiagnosticFields()
        }));
        trackedReload("start_time_controlled_reload", {
            reason,
            lotId,
            startMoscow: formatDateMoscow(timing.start)
        });
        return true;
    }

    function reloadOnFirstActiveApiStatus(status, reason = "active_api_start") {
        if (activeStatusReloadStarted) return false;
        if (!settings?.botEnabled || state !== "WAIT_BUY") return false;
        if (!isLotActiveStatus(status) || isAuthRequired()) return false;

        const lotId = getLotIdFromUrl();
        if (!lotId || hasActiveApiStartReloadDone(lotId)) return false;

        activeStatusReloadStarted = true;
        markActiveApiStartReloadDone(lotId);
        log("API открыл приём заявок — делаю обязательное обновление страницы перед поиском кнопки «Купить»:", status, reason);
        diagnosticRecord("combat_api_active_seen", getCombatTimingPayload({
            reason,
            status,
            lotId
        }));
        diagnosticRecord("active_api_start_reload", {
            reason,
            status,
            lotId,
            ...getBuyButtonDiagnosticFields(),
            startMoscow: lastTimingInfo?.start ? formatDateMoscow(lastTimingInfo.start) : null
        });
        sessionStorage.setItem("torgiBotCombatReload", "1");
        diagnosticRecord("combat_reload_triggered", getCombatTimingPayload({
            reason: "active_api_start",
            sourceReason: reason,
            status,
            lotId
        }));
        trackedReload("active_api_start", { status, reason, lotId });
        return true;
    }

    function reloadIfActiveApiWithoutBuy(status, reason = "active_api_without_buy") {
        if (activeStatusReloadStarted) return false;
        if (!settings?.botEnabled || state !== "WAIT_BUY") return false;
        if (!isLotActiveStatus(status) || isBuyButtonPresentDom() || isAuthRequired()) return false;

        const lotId = getLotIdFromUrl();

        const now = Date.now();
        const graceMs = Number(settings?.activeApiReloadGraceMs ?? 1000);
        if (!activeStatusFirstSeenAt) activeStatusFirstSeenAt = now;

        const waitedSinceActive = now - activeStatusFirstSeenAt;
        const waitedSincePageReady = now - pageReadyAt;
        if (waitedSinceActive < graceMs || waitedSincePageReady < graceMs) {
            traceTestFlowThrottled("active_api_without_buy_wait", {
                reason,
                status,
                waitedSinceActive,
                waitedSincePageReady,
                graceMs
            }, 300);
            return false;
        }

        activeStatusReloadStarted = true;
        log("API активен, кнопки «Купить» нет — принудительно перезагружаю страницу:", status, reason);
        diagnosticRecord("combat_api_active_seen", getCombatTimingPayload({
            reason,
            status,
            lotId,
            waitedSinceActive,
            waitedSincePageReady
        }));
        diagnosticRecord("active_api_without_buy_reload", {
            reason,
            status,
            lotId,
            startMoscow: lastTimingInfo?.start ? formatDateMoscow(lastTimingInfo.start) : null
        });
        sessionStorage.setItem("torgiBotCombatReload", "1");
        diagnosticRecord("combat_reload_triggered", getCombatTimingPayload({
            reason: "active_api_without_buy",
            sourceReason: reason,
            status,
            lotId,
            waitedSinceActive,
            waitedSincePageReady
        }));
        trackedReload("active_api_without_buy", { status, reason });
        return true;
    }

    window.addEventListener("error", event => {
        diagnosticRecord("window_error", {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno
        });
    });

    window.addEventListener("unhandledrejection", event => {
        diagnosticRecord("unhandled_rejection", {
            reason: String(event.reason?.message || event.reason || "")
        });
    });

    function normalizeText(text) {
        return (text || "").replace(/\s+/g, " ").trim();
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function isVisible(el) {
        if (!el) return false;
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
            return false;
        }
        return el.offsetParent !== null || el.getClientRects().length > 0;
    }

    function isDisabledControl(el) {
        if (!el) return false;
        const control = el.closest?.("button, input, select, textarea, [aria-disabled='true'], .disabled") || el;
        const disabledChild = el.querySelector?.("button[disabled], input[disabled], select[disabled], textarea[disabled], [aria-disabled='true'], .button.disabled, .disabled");
        return !!(
            control.disabled ||
            control.getAttribute?.("disabled") !== null ||
            control.getAttribute?.("aria-disabled") === "true" ||
            control.classList?.contains("disabled") ||
            disabledChild
        );
    }

    function hasBuyButtonSpinner(el) {
        if (!el) return false;
        const text = normalizeText(el.innerText || el.textContent);
        return !!(
            el.querySelector?.(".spinner, [class*='spinner'], app-icon-status-in-progress, .rotate, [class*='progress'], [class*='loading']") ||
            /подожд|загруз|обработ|отправ|выполня|progress|loading/i.test(text)
        );
    }

    function isBuyButtonProcessing(btn) {
        if (!btn) return false;
        return isDisabledControl(btn) || hasBuyButtonSpinner(btn);
    }

    function getOfferAlreadySignedMessage() {
        const text = normalizeText(document.body?.innerText || "");
        const patterns = [
            /по данному извещению оферта уже подписана другим покупателем[^.]*\./i,
            /оферта уже подписана другим покупателем/i,
            /подписана другим покупателем/i,
            /вы не можете подписать оферту/i
        ];
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[0]) return match[0];
        }
        return "";
    }

    function markOfferAlreadySignedLoss(source) {
        const message = getOfferAlreadySignedMessage();
        if (!message) return false;
        log("Поражение: оферта уже подписана другим покупателем");
        diagnosticRecord("offer_already_signed_by_other_buyer", {
            source,
            message,
            ...getBuyButtonDiagnosticFields(),
            lotId: getLotIdFromUrl()
        });
        setState("LOSS");
        releaseSignLock("offer_already_signed_by_other_buyer");
        playOggSound("sound-loss.ogg");
        return true;
    }

    function safeSendMessage(message) {
        return new Promise(resolve => {
            try {
                chrome.runtime.sendMessage(message, response => {
                    if (chrome.runtime.lastError) {
                        resolve({
                            ok: false,
                            runtimeError: chrome.runtime.lastError.message
                        });
                        return;
                    }
                    resolve(response || { ok: false });
                });
            } catch (e) {
                resolve({
                    ok: false,
                    runtimeError: String(e)
                });
            }
        });
    }

    async function isExtensionAlive() {
        const res = await safeSendMessage({ type: "PING" });
        return res?.ok === true;
    }

    async function setTabSettings(payload) {
        const res = await safeSendMessage({ type: "SET_TAB_SETTINGS", payload });
        if (res?.ok) {
            settings = res.settings;
        }
        return res;
    }

    async function loadSettings() {
        const res = await safeSendMessage({ type: "GET_SETTINGS" });
        if (!res?.ok) {
            log("Не удалось загрузить настройки:", res?.runtimeError || res?.error);
            return null;
        }
        settings = res.settings;
        return settings;
    }

    async function acquireSignLock(stage) {
        if (signLockHeld) return true;

        if (!signLockWaitStartedAt) {
            signLockWaitStartedAt = Date.now();
        }

        const lotId = getLotIdFromUrl();
        const startTimeMs = lastTimingInfo?.start?.getTime?.() || lastSelectedStartInfo?.date?.getTime?.() || 0;
        const res = await safeSendMessage({
            type: "SIGN_LOCK_ACQUIRE",
            lotId,
            stage,
            lotPriority: settings?.lotPriority ?? null,
            startTimeMs
        });

        if (res?.ok && res.acquired) {
            signLockHeld = true;
            const waitedMs = Date.now() - signLockWaitStartedAt;
            signLockWaitStartedAt = 0;
            diagnosticRecord("sign_lock_acquired", { lotId, stage, waitedMs });
            return true;
        }

        traceTestFlowThrottled("sign_lock_wait", {
            lotId,
            stage,
            lotPriority: settings?.lotPriority ?? null,
            waitedMs: Date.now() - signLockWaitStartedAt,
            owner: res?.owner || null
        }, 1000);
        return false;
    }

    async function releaseSignLock(reason = "release") {
        if (!signLockHeld) return;
        const lotId = getLotIdFromUrl();
        signLockHeld = false;
        signLockWaitStartedAt = 0;
        safeSendMessage({
            type: "SIGN_LOCK_RELEASE",
            lotId,
            reason
        });
        diagnosticRecord("sign_lock_released", { lotId, reason });
    }

    function stopAllTimers() {
        if (widgetTimer) clearInterval(widgetTimer);
        if (logicTimer) clearInterval(logicTimer);
        if (enableTimer) clearInterval(enableTimer);
        if (reloadTimer) clearTimeout(reloadTimer);
        if (preStartSessionRefreshTimer) clearTimeout(preStartSessionRefreshTimer);
        if (combatPollTimer) clearInterval(combatPollTimer);
        if (diagnosticTimer) clearInterval(diagnosticTimer);
        if (observerRunTimer) clearTimeout(observerRunTimer);

        widgetTimer = null;
        logicTimer = null;
        observerRunTimer = null;
        enableTimer = null;
        reloadTimer = null;
        preStartSessionRefreshTimer = null;
        combatPollTimer = null;
        diagnosticTimer = null;

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        releaseSignLock("stop_all_timers");
        cancelCombatPlan("stop_all_timers");
    }

    // ===== Combat plan via chrome.alarms in background (v5.6) =====
    let lastRegisteredCombatPlanKey = null;

    function registerCombatPlan(startTimeMs, lotId, reason) {
        if (!startTimeMs) return;
        const key = `${startTimeMs}|${lotId || ""}`;
        if (key === lastRegisteredCombatPlanKey) return;
        lastRegisteredCombatPlanKey = key;
        try {
            chrome.runtime.sendMessage({
                type: "REGISTER_COMBAT_PLAN",
                startTimeMs,
                lotId: lotId || null,
                reason: reason || null
            }, resp => {
                if (chrome.runtime.lastError) {
                    log("registerCombatPlan error:", chrome.runtime.lastError.message);
                    return;
                }
                if (resp?.ok) {
                    try {
                        diagnosticRecord("combat_plan_registered_bg", {
                            startTimeMs,
                            lotId,
                            reason: reason || null,
                            scheduled: resp.scheduled || []
                        });
                    } catch (_) {}
                }
            });
        } catch (e) {
            log("registerCombatPlan exception:", e);
        }
    }

    function cancelCombatPlan(reason) {
        lastRegisteredCombatPlanKey = null;
        try {
            chrome.runtime.sendMessage({
                type: "CANCEL_COMBAT_PLAN",
                reason: reason || null
            }, () => { void chrome.runtime.lastError; });
        } catch (_) {}
    }


    function stopAutomationTimersKeepJournal(reason = "stop_automation_keep_journal") {
        if (logicTimer) clearInterval(logicTimer);
        if (enableTimer) clearInterval(enableTimer);
        if (reloadTimer) clearTimeout(reloadTimer);
        if (preStartSessionRefreshTimer) clearTimeout(preStartSessionRefreshTimer);
        if (combatPollTimer) clearInterval(combatPollTimer);
        if (observerRunTimer) clearTimeout(observerRunTimer);

        logicTimer = null;
        observerRunTimer = null;
        enableTimer = null;
        reloadTimer = null;
        preStartSessionRefreshTimer = null;
        combatPollTimer = null;

        if (mutationObserver) {
            mutationObserver.disconnect();
            mutationObserver = null;
        }

        releaseSignLock(reason);
        cancelCombatPlan(reason || "stopAutomationTimersKeepJournal");
    }

    function scheduleReload(ms) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
            trackedReload("scheduled_reload");
        }, ms);
    }

    function schedulePrecombatCheck(ms) {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(async () => {
            if (state !== "WAIT_BUY" || !settings?.botEnabled) return;
            await loadSettings();
            const ready = await handlePreCombatMode();
            if (ready) {
                log("Запускаю сценарий кликов (после ожидания)");
                runLogic();
                startObserverLoop(true);
            } else {
                startLateBuyWatcher();
            }
        }, ms);
    }

    function schedulePreStartSessionRefresh(timing) {
        if (preStartSessionRefreshTimer) clearTimeout(preStartSessionRefreshTimer);

        if (!settings?.preStartSessionRefreshEnabled || !timing?.start) return;

        const nowMs = getSyncedNowDate().getTime();
        const startMs = timing.start.getTime();
        const stopBeforeMs = Number(settings?.preStartSessionRefreshStopBefore ?? 45000);
        const intervalMs = Number(settings?.preStartSessionRefreshInterval ?? 60000);
        const msUntilStop = startMs - stopBeforeMs - nowMs;

        if (msUntilStop <= 0) {
            diagnosticRecord("prestart_refresh_skip", {
                reason: "inside_stop_window",
                stopBeforeMs,
                msToStart: startMs - nowMs
            });
            return;
        }

        const delay = Math.min(intervalMs, msUntilStop);
        diagnosticRecord("prestart_refresh_scheduled", {
            delay,
            intervalMs,
            stopBeforeMs,
            msToStart: startMs - nowMs
        });

        preStartSessionRefreshTimer = setTimeout(() => {
            if (state !== "WAIT_BUY" || !settings?.botEnabled || isBuyButtonPresentDom() || isAuthRequired()) return;
            sessionStorage.setItem("torgiBotPreStartRefresh", "1");
            trackedReload("prestart_session_refresh", {
                stopBeforeMs,
                msToStart: startMs - getSyncedNowDate().getTime()
            });
        }, Math.max(delay, 1000));
    }

    const TRACE_THROTTLE_MS = 1200;
    const traceThrottle = {};

    let combatPollTimer = null;

    function getLotIdFromUrl() {
        const match = location.pathname.match(/\/lots\/lot\/([^\/\(]+)/);
        return match ? match[1] : null;
    }

    const LOT_ACTIVE_STATUSES = ["APPLICATIONS_SUBMISSION"];

    const LOT_KNOWN_INACTIVE_STATUSES = [
        "PUBLISHED",
        "APPLICATIONS_SUBMISSION_SUSPENDED",
        "APPLICATIONS_SUBMISSION_FINISHED",
        "CANCELED",
        "CANCELLED",
        "COMPLETED",
        "FAILED",
        "SUMMARIZING"
    ];

    const LOT_INACTIVE_KEYWORDS = [
        "SUSPEND", "CANCEL", "REJECT", "WITHDRAW", "PAUSE",
        "REVOK", "DENIED", "REFUSED", "DISQUALIF",
        "ПРИОСТАН", "ОТМЕН", "ОТКЛОН", "АННУЛ", "ЗАБЛОК"
    ];

    function findLotStatusValue(data) {
        if (!data || typeof data !== "object") return null;

        const directKeys = ["lotStatus", "status", "state", "lotState", "tradeState", "applicationStatus"];
        for (const key of directKeys) {
            const value = data[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }

        for (const value of Object.values(data)) {
            if (!value || typeof value !== "object") continue;
            const nested = findLotStatusValue(value);
            if (nested) return nested;
        }

        return null;
    }

    function isLotActiveStatus(status) {
        if (!status) return false;
        const normalized = String(status).toUpperCase();

        if (LOT_KNOWN_INACTIVE_STATUSES.includes(normalized)) return false;
        if (LOT_INACTIVE_KEYWORDS.some(kw => normalized.includes(kw))) return false;

        return LOT_ACTIVE_STATUSES.includes(normalized);
    }

    function startCombatPoll() {
        if (combatPollTimer) clearInterval(combatPollTimer);

        const fastInterval = 40;
        const targetStartMs = lastTimingInfo?.start?.getTime?.() || 0;
        const getApiPollMs = nowMs => {
            if (!targetStartMs) return Number(settings?.apiWatchdogInterval ?? 1000);
            if (nowMs < targetStartMs - 2000) return 1000;
            if (nowMs < targetStartMs) return 500;
            return Number(settings?.reloadInterval ?? 250);
        };
        const initialApiPollMs = getApiPollMs(Date.now());
        const softReloadMs = Number(settings?.combatSoftReloadMs ?? 1200);
        const lotId = getLotIdFromUrl();
        let lastApiCheck = 0;
        let combatStartedAt = Date.now();
        let lastSoftReloadAt = Date.now();
        let apiCheckPending = false;
        combatWatchStartedAt = Date.now();
        combatStartReachedLogged = false;
        const apiFetchTimeoutMs = 500;

        if (lotId) {
            log("Боевой режим: адаптивный API-опрос 1000/500/250 мс | лот:", lotId);
        } else {
            log("Боевой режим: ID лота не найден, жду без перезагрузки");
        }
        diagnosticRecord("combat_watch_started", getCombatTimingPayload({
            apiPollMs: initialApiPollMs,
            apiPollMode: "adaptive_1000_500_250",
            fastInterval,
            softReloadMs,
            targetStartMs,
            lotId,
            pageReadyAgeMs: Date.now() - pageReadyAt
        }));

        // v5.6: регистрируем план в background через chrome.alarms,
        // чтобы T-0 reload и страховочные сработали даже при заморозке вкладки.
        if (targetStartMs) {
            registerCombatPlan(targetStartMs, lotId, "startCombatPoll");
        }

        combatPollTimer = setInterval(() => {
            if (state !== "WAIT_BUY" || !settings?.botEnabled) {
                clearInterval(combatPollTimer);
                combatPollTimer = null;
                return;
            }

            const now = Date.now();
            if (targetStartMs && now >= targetStartMs) {
                const timingForReload = lastTimingInfo?.start ? {
                    ...lastTimingInfo,
                    msToStart: targetStartMs - getSyncedNowDate().getTime(),
                    forceActive: false
                } : null;
                if (reloadAtStartTimeIfNeeded(timingForReload, "combat_poll_start_time")) {
                    clearInterval(combatPollTimer);
                    combatPollTimer = null;
                    return;
                }
            }

            if (isBuyButtonPresentDom()) {
                if (targetStartMs && now < targetStartMs) {
                    traceTestFlowThrottled("buy_dom_seen_before_start_wait", {
                        msToStart: targetStartMs - now,
                        ...getBuyButtonDiagnosticFields()
                    }, 1000);
                    return;
                }

                lastBuyButtonFoundAt = Date.now();
                diagnosticRecord("buy_button_found_timing", getCombatTimingPayload({
                    source: "combat_poll_dom",
                    msSinceCombatWatchStarted: lastBuyButtonFoundAt - combatWatchStartedAt
                }));
                clearInterval(combatPollTimer);
                combatPollTimer = null;
                log("Боевой режим: кнопка «Купить» обнаружена");
                cancelCombatPlan("buy_button_found");
                runLogic();
                startObserverLoop(true);
                return;
            }

            const apiPollMs = getApiPollMs(now);
            if (targetStartMs && now >= targetStartMs && !combatStartReachedLogged) {
                combatStartReachedLogged = true;
                diagnosticRecord("combat_start_reached", getCombatTimingPayload({
                    source: "combat_poll",
                    msSinceCombatWatchStarted: now - combatWatchStartedAt
                }));
            }

            if (softReloadMs > 0 && targetStartMs && now >= targetStartMs && now - lastSoftReloadAt >= softReloadMs) {
                lastSoftReloadAt = now;
                log("Боевой режим: fallback-перезагрузка, кнопки всё ещё нет");
                diagnosticRecord("combat_reload_triggered", getCombatTimingPayload({
                    reason: "combat_fallback_no_buy_button",
                    sourceReason: "soft_reload_timer",
                    softReloadMs,
                    msSinceCombatWatchStarted: now - combatWatchStartedAt
                }));
                clearInterval(combatPollTimer);
                combatPollTimer = null;
                sessionStorage.setItem("torgiBotCombatReload", "1");
                trackedReload("combat_fallback_no_buy_button");
                return;
            }

            if (!lotId) {
                if (now - lastApiCheck >= apiPollMs) {
                    lastApiCheck = now;
                    log("Боевой режим: ID лота не найден в URL — жду без перезагрузки");
                }
                return;
            }

            if (!apiCheckPending && now - lastApiCheck >= apiPollMs) {
                lastApiCheck = now;
                apiCheckPending = true;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => {
                    controller.abort();
                    apiCheckPending = false;
                    log("Боевой режим: API timeout — продолжаю watchdog, без перезагрузки");
                }, apiFetchTimeoutMs);
                fetch(`https://torgi.gov.ru/new/api/public/lotcards/${lotId}`, {
                    cache: "no-store",
                    headers: { accept: "application/json" },
                    signal: controller.signal
                })
                .then(r => { applySyncFromResponse(r); return r.json(); })
                .then(data => {
                    clearTimeout(timeoutId);
                    apiCheckPending = false;
                    const status = findLotStatusValue(data);
                    log("Боевой режим: lotStatus =", status);
                    diagnosticLastApiData = data;
                    diagnosticLastApiStatus = status;
                    traceTestFlow("combat_api_status", {
                        status,
                        active: isLotActiveStatus(status),
                        ...getBuyButtonDiagnosticFields()
                    });
                    if (isLotActiveStatus(status)) {
                        diagnosticRecord("combat_api_active_seen", getCombatTimingPayload({
                            source: "combat_poll",
                            status,
                            lotId,
                            msSinceCombatWatchStarted: Date.now() - combatWatchStartedAt
                        }));
                        if (reloadOnFirstActiveApiStatus(status, "combat_poll") || reloadIfActiveApiWithoutBuy(status, "combat_poll")) {
                            clearInterval(combatPollTimer);
                            combatPollTimer = null;
                        }
                        return;
                    }
                    activeStatusFirstSeenAt = 0;
                    if (targetStartMs && Date.now() >= targetStartMs && Date.now() - combatStartedAt > Math.max(softReloadMs, 1200)) {
                        log("Боевой режим: время старта прошло, API не активен — делаю fallback-перезагрузку");
                        traceTestFlow("combat_reload", { reason: "fallback_after_start", status });
                        diagnosticRecord("combat_reload_triggered", getCombatTimingPayload({
                            reason: "combat_fallback_after_start",
                            sourceReason: "api_inactive_after_start",
                            status,
                            softReloadMs,
                            msSinceCombatWatchStarted: Date.now() - combatWatchStartedAt
                        }));
                        clearInterval(combatPollTimer);
                        combatPollTimer = null;
                        sessionStorage.setItem("torgiBotCombatReload", "1");
                        trackedReload("combat_fallback_after_start", { status });
                    }
                })
                .catch(err => {
                    clearTimeout(timeoutId);
                    apiCheckPending = false;
                    if (err?.name !== "AbortError") {
                        log("Боевой режим: ошибка API — продолжаю watchdog:", err);
                    }
                });
            }
        }, fastInterval);
    }

    function setState(newState) {
        if (state === newState) return;
        state = newState;
        if (newState !== "AUTH_REQUIRED") {
            sessionStorage.setItem("torgiBotState", newState);
        }
        log("Новое состояние:", newState);
        traceTestFlow("state_change", { state: newState });
        updateWidget();
    }

    function finishBot() {
        markBuyFlowFinished("Выбрать нажата");
        setState("DONE");
        releaseSignLock("done");
        log("Сценарий завершён — ожидаю переход на страницу оплаты");
        watchForWinOrLoss();
    }

    function resetIfLotChanged() {
        const lotKey = location.pathname + location.search + location.hash;
        const savedLotKey = sessionStorage.getItem("torgiBotLotKey");

        if (savedLotKey !== lotKey) {
            releaseSignLock("lot_changed");
            sessionStorage.removeItem("torgiBotActiveApiStartReloadLot");
            sessionStorage.removeItem("torgiBotStartTimeReloadKey");
            sessionStorage.setItem("torgiBotLotKey", lotKey);
            sessionStorage.setItem("torgiBotState", "WAIT_BUY");
            sessionStorage.removeItem("torgiBotSoftAuthDialogRetryCount");
            sessionStorage.removeItem("torgiBotPostReloadSoftAuthRetryCount");
            clearAuthStateMeta();
            state = "WAIT_BUY";
            softAuthDialogRetryCount = 0;
            postReloadSoftAuthRetryCount = 0;
            softAuthDialogRetryScheduled = false;
            log("Новый лот, состояние сброшено");
        }
    }

    function ensureWidget() {
        if (widgetEl && document.documentElement.contains(widgetEl)) return widgetEl;

        widgetEl = document.createElement("div");
        widgetEl.id = "torgi-bot-widget";
        widgetEl.style.position = "fixed";
        widgetEl.style.zIndex = "2147483647";
        widgetEl.style.width = "390px";
        widgetEl.style.minWidth = "260px";
        widgetEl.style.minHeight = "80px";
        widgetEl.style.background = "rgba(20,24,35,0.80)";
        widgetEl.style.color = "#fff";
        widgetEl.style.fontFamily = "Arial, sans-serif";
        widgetEl.style.fontSize = "13px";
        widgetEl.style.lineHeight = "1.45";
        widgetEl.style.padding = "0 14px 12px";
        widgetEl.style.borderRadius = "12px";
        widgetEl.style.boxShadow = "0 10px 30px rgba(0,0,0,0.3)";
        widgetEl.style.border = "1px solid rgba(255,255,255,0.12)";
        widgetEl.style.whiteSpace = "normal";
        widgetEl.style.userSelect = "none";
        widgetEl.style.resize = "both";
        widgetEl.style.overflow = "hidden";

        try {
            const saved = JSON.parse(sessionStorage.getItem("torgiBotWidgetPos") || "null");
            if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
                widgetEl.style.left = Math.max(0, Math.min(window.innerWidth - 402, saved.left)) + "px";
                widgetEl.style.top  = Math.max(0, Math.min(window.innerHeight - 50, saved.top)) + "px";
            } else {
                widgetEl.style.left = "12px";
                widgetEl.style.top  = "12px";
            }
            if (saved && typeof saved.width === "number") {
                widgetEl.style.width = Math.max(260, saved.width) + "px";
            }
            if (saved && typeof saved.height === "number") {
                widgetEl.style.height = Math.max(80, saved.height) + "px";
            }
        } catch (_) {
            widgetEl.style.left = "12px";
            widgetEl.style.top  = "12px";
        }

        try {
            new ResizeObserver(() => {
                const rect = widgetEl.getBoundingClientRect();
                const prev = JSON.parse(sessionStorage.getItem("torgiBotWidgetPos") || "{}");
                sessionStorage.setItem("torgiBotWidgetPos", JSON.stringify({
                    ...prev,
                    width: widgetEl.offsetWidth,
                    height: widgetEl.offsetHeight
                }));
            }).observe(widgetEl);
        } catch (_) {}

        const handle = document.createElement("div");
        handle.style.cssText = "cursor:grab;padding:7px 0 5px;text-align:center;letter-spacing:4px;color:rgba(255,255,255,0.35);font-size:12px;user-select:none;";
        handle.textContent = "⠿ ⠿ ⠿ ⠿";
        handle.title = "Перетащить виджет";
        widgetEl.appendChild(handle);

        const content = document.createElement("div");
        content.id = "torgi-bot-widget-content";
        content.style.userSelect = "text";
        widgetEl.appendChild(content);

        let dragging = false, startX = 0, startY = 0, origLeft = 0, origTop = 0;

        handle.addEventListener("mousedown", e => {
            e.preventDefault();
            dragging = true;
            handle.style.cursor = "grabbing";
            const rect = widgetEl.getBoundingClientRect();
            origLeft = rect.left;
            origTop  = rect.top;
            startX = e.clientX;
            startY = e.clientY;
        });

        document.addEventListener("mousemove", e => {
            if (!dragging) return;
            const newLeft = Math.max(0, Math.min(window.innerWidth  - widgetEl.offsetWidth,  origLeft + e.clientX - startX));
            const newTop  = Math.max(0, Math.min(window.innerHeight - 50,                    origTop  + e.clientY - startY));
            widgetEl.style.left = newLeft + "px";
            widgetEl.style.top  = newTop  + "px";
        });

        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            handle.style.cursor = "grab";
            try {
                const rect = widgetEl.getBoundingClientRect();
                sessionStorage.setItem("torgiBotWidgetPos", JSON.stringify({ left: rect.left, top: rect.top }));
            } catch (_) {}
        });

        widgetEl.addEventListener("click", e => {
            if (e.target.closest("#torgi-bot-toggle")) {
                toggleBot().catch(err => log("Ошибка toggleBot:", err));
            }
            if (e.target.closest("#torgi-journal-toggle")) {
                try {
                    toggleJournalMode();
                } catch (err) {
                    log("Ошибка toggleJournalMode:", err);
                }
            }
            if (e.target.closest("#torgi-diagnostic-copy-report")) {
                copyDiagnosticReportFromWidget().catch(err => log("Ошибка copyDiagnosticReportFromWidget:", err));
            }
            if (e.target.closest("#torgi-priority-toggle")) {
                toggleLotPriority().catch(err => log("Ошибка toggleLotPriority:", err));
            }
            if (e.target.closest("#torgi-mode-toggle")) {
                toggleWidgetMode().catch(err => log("Ошибка toggleWidgetMode:", err));
            }
        });

        document.documentElement.appendChild(widgetEl);
        return widgetEl;
    }

    function formatDateMoscow(date) {
        if (!date || Number.isNaN(date.getTime())) return "—";

        return new Intl.DateTimeFormat("ru-RU", {
            timeZone: "Europe/Moscow",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit"
        }).format(date);
    }

    function formatDuration(ms) {
        if (ms == null || Number.isNaN(ms)) return "—";
        if (ms <= 0) return "0 сек";

        const totalSec = Math.floor(ms / 1000);
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const minutes = Math.floor((totalSec % 3600) / 60);
        const seconds = totalSec % 60;

        const parts = [];
        if (days) parts.push(`${days}д`);
        if (hours || days) parts.push(`${hours}ч`);
        if (minutes || hours || days) parts.push(`${minutes}м`);
        parts.push(`${seconds}с`);

        return parts.join(" ");
    }

    function formatFastDuration(ms) {
        if (ms == null || Number.isNaN(ms)) return "—";
        if (ms < 1000) return `${Math.max(0, Math.round(ms))} мс`;
        return `${(ms / 1000).toFixed(2)} сек`;
    }

    function markBuyFlowFinished(label) {
        if (!buyFlowStartedAt) return;
        lastBuyFlowDurationMs = Date.now() - buyFlowStartedAt;
        lastBuyFlowDurationLabel = label || "готово";
        traceTestFlow("buy_flow_duration", {
            label: lastBuyFlowDurationLabel,
            durationMs: lastBuyFlowDurationMs,
            durationText: formatFastDuration(lastBuyFlowDurationMs)
        });
        updateWidget();
    }

    function getStatusMeta() {
        if (!settings) {
            return { label: "Инициализация", color: "#a1a1aa" };
        }

        if (!settings.botEnabled) {
            return { label: "Выключен", color: "#9ca3af" };
        }

        if (state === "WIN") {
            return { label: "ПОБЕДА", color: "#22c55e" };
        }

        if (state === "LOSS") {
            return { label: "ПОРАЖЕНИЕ", color: "#dc2626" };
        }

        if (state === "DONE") {
            return { label: "Завершён (ждём результат…)", color: "#60a5fa" };
        }

        if (state === "READY_SELECT") {
            return { label: "Проверка: стоп перед выбором", color: "#f59e0b" };
        }

        if (state === "AUTH_REQUIRED") {
            return { label: "Нужна авторизация", color: "#dc2626" };
        }

        if (state === "AUTH_OR_BACKEND_GATE") {
            return { label: "Шлюз авторизации/backend", color: "#f97316" };
        }

        if (!lastTimingInfo) {
            return { label: "Подготовка", color: "#60a5fa" };
        }

        if (lastTimingInfo.forceActive) {
            return { label: "Активный лот", color: "#22c55e" };
        }

        if (!lastTimingInfo.ok) {
            return { label: "Нет данных о старте", color: "#f59e0b" };
        }

        if (lastTimingInfo.isCombat) {
            return { label: "Боевой режим", color: "#ef4444" };
        }

        return { label: "Ожидание", color: "#3b82f6" };
    }

    function updateWidget() {
        if (settings?.widgetHidden && !settings?.botEnabled) {
            if (widgetEl) widgetEl.style.display = "none";
            return;
        }

        const el = ensureWidget();
        el.style.display = "block";
        const status = getStatusMeta();

        const startStr = lastTimingInfo?.start ? formatDateMoscow(lastTimingInfo.start) : "—";
        const nowStr = lastTimingInfo?.now ? formatDateMoscow(lastTimingInfo.now) : "—";
        const untilStart = lastTimingInfo?.ok ? formatDuration(lastTimingInfo.msToStart ?? 0) : "—";
        const untilCombat = lastTimingInfo?.ok ? formatDuration(lastTimingInfo.msToCombat) : "—";
        const lotStatus = getLotStatusText();
        const isManualTime = !!(lastTimingInfo?.isManual && settings?.manualStartTime);
        const selectedField = isManualTime
            ? "⚡ Ручной ввод"
            : (lastSelectedStartInfo?.label || (settings?.botEnabled ? "⚠ Не найдено на странице" : "—"));
        const isTestMode = settings?.stopBeforeFinalSelect !== false;
        const testMode = isTestMode ? "Тест 2-в-1" : "Боевой";
        const botColor = settings?.botEnabled ? "#22c55e" : "#2563eb";
        const botTitle = settings?.botEnabled ? "Бот включён" : "Бот выключен";
        const lotPriority = settings?.lotPriority == null
            ? null
            : Math.max(1, Math.min(5, Number(settings.lotPriority)));
        const priorityText = lotPriority == null ? "P-" : `P${lotPriority}`;
        const priorityColor = lotPriority == null ? "#6b7280" : "#1d4ed8";
        const modeButtonText = isTestMode ? "ТЕСТ 2-в-1" : "БОЕВОЙ";
        const modeButtonColor = isTestMode ? "#f59e0b" : "#22c55e";
        const diagnosticText = diagnosticActive
            ? `Включён, событий: ${diagnosticLog.length}, API: ${diagnosticLastApiStatus || "—"}`
            : "Выключен";
        const journalButtonText = diagnosticActive ? "ЖУРНАЛ ✓" : "ЖУРНАЛ";
        const journalButtonColor = diagnosticActive ? "#16a34a" : "#6b7280";
        const flowDurationText = lastBuyFlowDurationMs == null
            ? "—"
            : `${formatFastDuration(lastBuyFlowDurationMs)} (${lastBuyFlowDurationLabel})`;

        const content = el.querySelector("#torgi-bot-widget-content");
        if (!content) return;

        content.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    <button id="torgi-bot-toggle" title="${botTitle}" style="width:14px;height:14px;border-radius:50%;border:1px solid rgba(255,255,255,.7);cursor:pointer;background:${botColor};padding:0;box-shadow:0 0 0 2px rgba(255,255,255,.12);"></button>
                    <div style="font-size:14px;font-weight:700;">Torgi Bot PRO</div>
                </div>
                <div style="padding:3px 8px;border-radius:999px;background:${status.color};color:#fff;font-size:12px;font-weight:700;">
                    ${status.label}
                </div>
            </div>

            <div style="display:grid;grid-template-columns:150px 1fr;gap:6px 10px;">
                <div style="opacity:.72;">Статус лота:</div><div>${escapeHtml(lotStatus)}</div>
                <div style="opacity:.72;">Начало торгов:</div><div>${escapeHtml(startStr)}</div>
                <div style="opacity:.72;">Осталось до торгов:</div><div>${escapeHtml(untilStart)}</div>
                <div style="opacity:.72;">До активного режима:</div><div>${escapeHtml(untilCombat)}</div>
                <div style="opacity:.72;">Сейчас (МСК):</div><div>${escapeHtml(nowStr)}</div>
                <div style="opacity:.72;">Поле времени:</div><div>${escapeHtml(selectedField)}</div>
                <div style="opacity:.72;">Купить → Выбрать:</div><div>${escapeHtml(flowDurationText)}</div>
                <div style="opacity:.72;">Тестовый режим:</div><div>${escapeHtml(testMode)}</div>
                <div style="opacity:.72;">Журнал:</div><div>${escapeHtml(diagnosticText)}</div>
            </div>

            <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
                <button id="torgi-mode-toggle" style="flex:1 1 150px;padding:6px 8px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:${modeButtonColor};color:#fff;">
                    ${modeButtonText}
                </button>
                <button id="torgi-priority-toggle" title="Ручной приоритет подписи" style="flex:0 0 auto;padding:6px 10px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:${priorityColor};color:#fff;">
                    ${priorityText}
                </button>
                <button id="torgi-journal-toggle" title="Включить/выключить пассивный журнал" style="flex:0 0 auto;padding:6px 10px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:${journalButtonColor};color:#fff;">
                    ${journalButtonText}
                </button>
                <button id="torgi-diagnostic-copy-report" style="flex:0 0 auto;padding:6px 10px;border-radius:6px;border:none;cursor:pointer;font-size:12px;font-weight:700;background:#0f766e;color:#fff;">
                    Отчёт
                </button>
            </div>
            ${lastReportCopyStatus ? `<div style="margin-top:7px;font-size:12px;color:#bfdbfe;">${escapeHtml(lastReportCopyStatus)}</div>` : ""}
        `;
    }

    function startWidgetLoop() {
        if (widgetTimer) clearInterval(widgetTimer);

        widgetTimer = setInterval(async () => {
            if (settings?.botEnabled) {
                const timing = await getTimingInfo(true);
                if (timing.ok || timing.forceActive) {
                    lastTimingInfo = timing;
                }
            }
            updateWidget();
        }, 1000);
    }

    async function syncMoscowTime() {
        const res = await safeSendMessage({ type: "GET_TIME100_MOSCOW_TIME" });

        if (res?.ok && res?.iso) {
            const serverMs = new Date(res.iso).getTime();
            if (!Number.isNaN(serverMs)) {
                timeSync = {
                    ok: true,
                    lastSyncAtLocalMs: Date.now(),
                    lastSyncServerMs: serverMs,
                    source: res.source || "time100"
                };
                log("Синхронизировано время:", new Date(serverMs).toISOString(), "| source:", timeSync.source);
                return true;
            }
        }

        log("Не удалось синхронизировать время:", res?.error || res?.runtimeError);
        return false;
    }

    function applySyncFromResponse(response) {
        try {
            const dateHeader = response.headers.get("date");
            if (!dateHeader) return false;
            const serverMs = new Date(dateHeader).getTime();
            if (Number.isNaN(serverMs)) return false;
            timeSync = {
                ok: true,
                lastSyncAtLocalMs: Date.now(),
                lastSyncServerMs: serverMs,
                source: "torgi.gov.ru"
            };
            log("Время синхронизировано с torgi.gov.ru:", new Date(serverMs).toISOString());
            return true;
        } catch (e) {
            return false;
        }
    }

    async function syncTimeFromTorgiApi() {
        const lotId = getLotIdFromUrl();
        if (!lotId) return false;
        try {
            const response = await fetchLotCardResponse(lotId);
            return applySyncFromResponse(response);
        } catch (e) {
            log("Не удалось синхронизировать время с torgi.gov.ru:", e);
            return false;
        }
    }

    async function fetchLotCardResponse(lotId = getLotIdFromUrl(), timeoutMs = 1500) {
        if (!lotId) throw new Error("lotId not found");

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            return await fetch(`https://torgi.gov.ru/new/api/public/lotcards/${lotId}`, {
                cache: "no-store",
                headers: { accept: "application/json" },
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async function fetchLotCardData(timeoutMs = 1500) {
        const response = await fetchLotCardResponse(getLotIdFromUrl(), timeoutMs);
        applySyncFromResponse(response);
        return response.json();
    }

    function collectDiagnosticPageSnapshot() {
        const bodyText = document.body?.innerText || "";
        const buyButtonDiagnostics = getBuyButtonDiagnostics();
        const lines = bodyText.split("\n").map(s => normalizeText(s)).filter(Boolean);
        const interesting = lines.filter(s =>
            /начал|при[её]м|заяв|предлож|купить|статус|лот|авторизац|войдите|войти|есиа|госуслуг|сесс|оферт|другим покупателем|не можете подписать/i.test(s)
        ).slice(0, 80);

        const buttons = [...document.querySelectorAll("button, a, [role='button'], span.button__label")]
            .map(el => ({
                tag: el.tagName,
                text: normalizeText(el.innerText || el.textContent),
                html: el.outerHTML ? el.outerHTML.slice(0, 1500) : ""
            }))
            .filter(item => /купить|подписать|выбрать|войти|авторизац/i.test(item.text || ""));

        return {
            url: location.href,
            title: document.title,
            lotId: getLotIdFromUrl(),
            state,
            botEnabled: !!settings?.botEnabled,
            diagnosticActive,
            buyClickDelayMs: Number(settings?.buyClickDelayMs ?? DEFAULT_BUY_CLICK_DELAY_MS),
            minPageAgeBeforeBuyClickMs: Number(settings?.minPageAgeBeforeBuyClickMs ?? DEFAULT_MIN_PAGE_AGE_BEFORE_BUY_CLICK_MS),
            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
            buyButtonVisible: buyButtonDiagnostics.visible,
            buyButtonClickable: buyButtonDiagnostics.clickable,
            buyButtonDiagnostics,
            authRequired: isAuthRequired(),
            authDiagnostics: lastAuthDiagnostics,
            authStateMeta,
            authStateReason: authStateMeta?.authStateReason || null,
            authStateAt: authStateMeta?.authStateAt || null,
            authStateUrlAt: authStateMeta?.authStateUrlAt || null,
            authDialogSnapshotAt: authStateMeta?.authDialogSnapshotAt || null,
            softDialogAttempts: authStateMeta?.softDialogAttempts || {
                afterBuy: softAuthDialogRetryCount,
                afterReload: postReloadSoftAuthRetryCount
            },
            realAuthReason: authStateMeta?.realAuthReason ?? getRealAuthUrlReason() ?? null,
            visibleLotStatus: getLotStatusText(),
            lastApiStatus: diagnosticLastApiStatus,
            timeSource: timeSync.ok ? timeSync.source : "local",
            nowMoscow: formatDateMoscow(getSyncedNowDate()),
            startMoscow: lastTimingInfo?.start ? formatDateMoscow(lastTimingInfo.start) : null,
            selectedStartField: lastSelectedStartInfo?.label || null,
            interesting,
            buttons
        };
    }

    function copyTextFallback(text) {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        let ok = false;
        try {
            ok = document.execCommand("copy");
        } catch (_) {
            ok = false;
        }
        textarea.remove();
        return ok;
    }

    function buildDiagnosticReport() {
        return JSON.stringify({
            generatedAt: new Date().toISOString(),
            snapshot: collectDiagnosticPageSnapshot(),
            latestApiStatus: diagnosticLastApiStatus,
            latestApiData: diagnosticLastApiData,
            log: diagnosticLog.slice(-DIAGNOSTIC_LOG_LIMIT)
        }, null, 2);
    }

    async function runDiagnosticTick(reason = "interval") {
        const snapshot = collectDiagnosticPageSnapshot();
        let apiStatus = null;
        let apiError = null;
        const isFinalState = ["READY_SELECT", "DONE", "WIN", "LOSS", "AUTH_OR_BACKEND_GATE"].includes(state);
        const shouldSkipApiForQuietBot =
            !!settings?.botEnabled &&
            !isFinalState &&
            state !== "AUTH_REQUIRED" &&
            state !== "AUTH_OR_BACKEND_GATE";
        const authDetails = snapshot.authRequired
            ? (lastAuthDiagnostics || markAuthRequired(`diagnostic_${reason}`))
            : null;

        if (shouldSkipApiForQuietBot) {
            apiStatus = diagnosticLastApiStatus;
            apiError = "diagnostic_api_skipped_bot_enabled";
        } else if (snapshot.lotId || !isFinalState) {
            try {
                const data = await fetchLotCardData(1500);
                diagnosticLastApiData = data;
                apiStatus = findLotStatusValue(data);
                diagnosticLastApiStatus = apiStatus;
            } catch (e) {
                apiError = String(e?.message || e);
            }
        } else {
            apiError = "final_state_without_lot_id_api_skipped";
        }

        diagnosticRecord("tick", {
            reason,
            lotId: snapshot.lotId,
            apiStatus,
            apiError,
            buyButtonPresentDom: snapshot.buyButtonPresentDom,
            buyButtonVisible: snapshot.buyButtonVisible,
            buyButtonClickable: snapshot.buyButtonClickable,
            buyButtonDiagnostics: snapshot.buyButtonDiagnostics,
            authRequired: snapshot.authRequired,
            authReason: authDetails?.reason || null,
            authDetails,
            visibleLotStatus: snapshot.visibleLotStatus,
            v55: diagBuildExtras()
        });

        diagMaybeRecordBuyAppear(snapshot);

        if (snapshot.buyButtonPresentDom) {
            const buySeenKey = `${snapshot.lotId || "no-lot"}:${location.href}`;
            if (diagnosticBuySeenKey !== buySeenKey) {
                diagnosticBuySeenKey = buySeenKey;
                sessionStorage.setItem("torgiBotDiagnosticBuySeenKey", diagnosticBuySeenKey);
                diagnosticRecord("buy_candidate_seen_dom", {
                    reason,
                    lotId: snapshot.lotId,
                    botEnabled: !!settings?.botEnabled,
                    apiStatus,
                    visibleLotStatus: snapshot.visibleLotStatus,
                    buyButtonDiagnostics: snapshot.buyButtonDiagnostics
                });
            }

            if (snapshot.buyButtonVisible) {
                const buyVisibleKey = `${snapshot.lotId || "no-lot"}:${location.href}`;
                if (diagnosticBuyVisibleKey !== buyVisibleKey) {
                    diagnosticBuyVisibleKey = buyVisibleKey;
                    sessionStorage.setItem("torgiBotDiagnosticBuyVisibleKey", diagnosticBuyVisibleKey);
                    diagnosticRecord("buy_candidate_visible", {
                        reason,
                        lotId: snapshot.lotId,
                        botEnabled: !!settings?.botEnabled,
                        apiStatus,
                        visibleLotStatus: snapshot.visibleLotStatus,
                        buyButtonDiagnostics: snapshot.buyButtonDiagnostics
                    });
                }
            }

            if (snapshot.buyButtonClickable) {
                const buyClickableKey = `${snapshot.lotId || "no-lot"}:${location.href}`;
                if (diagnosticBuyClickableKey !== buyClickableKey) {
                    diagnosticBuyClickableKey = buyClickableKey;
                    sessionStorage.setItem("torgiBotDiagnosticBuyClickableKey", diagnosticBuyClickableKey);
                    diagnosticRecord("buy_first_clickable_seen", {
                        reason,
                        lotId: snapshot.lotId,
                        botEnabled: !!settings?.botEnabled,
                        apiStatus,
                        visibleLotStatus: snapshot.visibleLotStatus,
                        buyButtonDiagnostics: snapshot.buyButtonDiagnostics
                    });
                }
            } else {
                const primary = snapshot.buyButtonDiagnostics?.primary || {};
                const top = primary.elementFromPoint || {};
                const notClickableKey = [
                    snapshot.lotId || "no-lot",
                    location.href,
                    primary.notClickableReason || "unknown",
                    primary.disabled ? "disabled" : "enabled",
                    primary.spinner ? "spinner" : "no-spinner",
                    top.tagName || "no-top",
                    top.id || "",
                    top.className || ""
                ].join(":");
                if (diagnosticBuyNotClickableKey !== notClickableKey) {
                    diagnosticBuyNotClickableKey = notClickableKey;
                    sessionStorage.setItem("torgiBotDiagnosticBuyNotClickableKey", diagnosticBuyNotClickableKey);
                    diagnosticRecord("buy_candidate_not_clickable", {
                        reason,
                        lotId: snapshot.lotId,
                        botEnabled: !!settings?.botEnabled,
                        apiStatus,
                        visibleLotStatus: snapshot.visibleLotStatus,
                        buyButtonDiagnostics: snapshot.buyButtonDiagnostics
                    });
                }
            }
        }

        const offerAlreadySignedMessage = getOfferAlreadySignedMessage();
        if (offerAlreadySignedMessage) {
            const offerLossKey = `${snapshot.lotId || "no-lot"}:${offerAlreadySignedMessage}`;
            if (diagnosticOfferLossSeenKey === offerLossKey) {
                return;
            }
            diagnosticOfferLossSeenKey = offerLossKey;
            sessionStorage.setItem("torgiBotDiagnosticOfferLossSeenKey", diagnosticOfferLossSeenKey);
            diagnosticRecord("offer_already_signed_seen_passive", {
                reason,
                lotId: snapshot.lotId,
                botEnabled: !!settings?.botEnabled,
                message: offerAlreadySignedMessage
            });
        }
    }

    function startDiagnosticMonitor(reason = "manual") {
        diagnosticActive = true;
        sessionStorage.setItem("torgiBotDiagnosticActive", "1");

        diagnosticRecord("start", {
            reason,
            note: "Пассивный журнал пишет загрузки, API-статус, авторизацию, кнопку Купить, клики и состояние страницы."
        });

        if (diagnosticTimer) clearInterval(diagnosticTimer);
        diagnosticTimer = setInterval(() => {
            runDiagnosticTick().catch(err => diagnosticRecord("tick_error", { error: String(err) }));
        }, Number(settings?.apiWatchdogInterval ?? 1000));

        runDiagnosticTick("start").catch(err => diagnosticRecord("tick_error", { error: String(err) }));
        updateWidget();
    }

    function toggleJournalMode() {
        if (diagnosticActive) {
            stopDiagnosticMode("journal_button");
            lastReportCopyStatus = "Журнал выключен";
            updateWidget();
            return;
        }

        clearDiagnosticLog();
        diagnosticBuySeenKey = "";
        diagnosticBuyVisibleKey = "";
        diagnosticBuyClickableKey = "";
        diagnosticBuyNotClickableKey = "";
        diagnosticOfferLossSeenKey = "";
        sessionStorage.removeItem("torgiBotDiagnosticBuySeenKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyVisibleKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyClickableKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyNotClickableKey");
        sessionStorage.removeItem("torgiBotDiagnosticOfferLossSeenKey");
        startDiagnosticMonitor("journal_button");
        lastReportCopyStatus = "Журнал включён";
        updateWidget();
    }

    function startDiagnosticMode(reason = "manual") {
        settings = settings || {};
        settings.stopBeforeFinalSelect = true;

        if (logicTimer) {
            clearInterval(logicTimer);
            logicTimer = null;
        }
        if (reloadTimer) {
            clearTimeout(reloadTimer);
            reloadTimer = null;
        }
        if (combatPollTimer) {
            clearInterval(combatPollTimer);
            combatPollTimer = null;
        }
        if (lateBuyWatcher) {
            lateBuyWatcher.disconnect();
            lateBuyWatcher = null;
        }

        startDiagnosticMonitor(reason);
    }

    function stopDiagnosticMode(reason = "manual") {
        diagnosticActive = false;
        sessionStorage.removeItem("torgiBotDiagnosticActive");
        if (diagnosticTimer) clearInterval(diagnosticTimer);
        diagnosticTimer = null;
        diagnosticRecord("stop", { reason });
        updateWidget();
    }

    function clearDiagnosticLog() {
        diagnosticLog = [];
        diagnosticLastApiData = null;
        diagnosticLastApiStatus = null;
        diagnosticBuySeenKey = "";
        diagnosticBuyVisibleKey = "";
        diagnosticBuyClickableKey = "";
        diagnosticBuyNotClickableKey = "";
        diagnosticOfferLossSeenKey = "";
        sessionStorage.removeItem("torgiBotDiagnosticLog");
        sessionStorage.removeItem("torgiBotDiagnosticBuySeenKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyVisibleKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyClickableKey");
        sessionStorage.removeItem("torgiBotDiagnosticBuyNotClickableKey");
        sessionStorage.removeItem("torgiBotDiagnosticOfferLossSeenKey");
        diagnosticRecord("clear", { reason: "manual" });
    }

    function runDiagnosticReloadTest() {
        diagnosticActive = true;
        sessionStorage.setItem("torgiBotDiagnosticActive", "1");
        diagnosticRecord("reload_test_before", collectDiagnosticPageSnapshot());
        sessionStorage.setItem("torgiBotDiagnosticReloadPending", String(Date.now()));
        trackedReload("diagnostic_single_reload");
    }

    function getSyncedNowDate() {
        if (timeSync.ok) {
            const delta = Date.now() - timeSync.lastSyncAtLocalMs;
            return new Date(timeSync.lastSyncServerMs + delta);
        }
        return new Date();
    }

    const APPLICATION_START_LABEL = "Дата и время начала подачи заявок";

    function parseDateTimeFromText(text) {
        const dateMatch = text.match(/(\d{2}\.\d{2}\.\d{4})/);
        const timeMatch = text.match(/(\d{2}:\d{2})(?::(\d{2}))?/);
        const offsetMatch = text.match(/\(МСК\s*([+-]\d+)\)/i);

        if (!dateMatch || !timeMatch) return null;

        const [d, m, y] = dateMatch[1].split(".").map(Number);
        const hh = Number(timeMatch[1].slice(0, 2));
        const mm = Number(timeMatch[1].slice(3, 5));
        const ss = Number(timeMatch[2] || "0");
        const offset = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;
        const utcMs = Date.UTC(y, m - 1, d, hh - (3 + offset), mm, ss, 0);
        const date = new Date(utcMs);

        if (Number.isNaN(date.getTime())) return null;

        return {
            date,
            offset,
            hasOffset: !!offsetMatch
        };
    }

    function parseDateTimeAfterLabel(text, labelText) {
        const labelIndex = text.indexOf(labelText);
        if (labelIndex < 0) return null;

        const tail = text.slice(labelIndex + labelText.length, labelIndex + labelText.length + 120);
        const pattern = /(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2})(?::(\d{2}))?(?:\s*\(МСК\s*([+-]\d+)?\))?/i;
        const match = tail.match(pattern);
        if (!match) return null;

        const source = `${match[1]} ${match[2]}${match[3] ? `:${match[3]}` : ""}${match[4] ? ` (МСК${match[4]})` : ""}`;
        return parseDateTimeFromText(source);
    }

    function parseApiDateValue(value) {
        if (typeof value !== "string" && typeof value !== "number") return null;

        if (typeof value === "number") {
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? null : date;
        }

        const text = normalizeText(value);
        if (!text) return null;

        const textParsed = parseDateTimeFromText(text);
        if (textParsed?.date) return textParsed.date;

        if (!/[T:\-]/.test(text)) return null;

        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    }

    async function parseStartDateTimeFromApi() {
        const nowTs = Date.now();
        if (lastApiStartInfo && nowTs - lastApiStartFetchAt < 5000) {
            return lastApiStartInfo.date;
        }
        if (!lastApiStartInfo && lastApiStartFetchAt && nowTs - lastApiStartFetchAt < 5000) {
            return null;
        }

        try {
            const data = await fetchLotCardData();
            const date = parseApiDateValue(data?.biddStartTime);

            lastApiStartFetchAt = nowTs;

            if (!date) {
                lastApiStartInfo = null;
                log("API: biddStartTime не найден");
                return null;
            }

            const selected = {
                date,
                label: "API: biddStartTime (Дата и время начала подачи заявок)",
                text: String(data.biddStartTime),
                priority: 1
            };
            lastApiStartInfo = selected;
            lastSelectedStartInfo = {
                label: selected.label,
                date: selected.date,
                text: selected.text,
                candidatesCount: 1
            };
            log("API: выбран старт:", selected.label, "=>", formatDateMoscow(selected.date));
            return selected.date;
        } catch (e) {
            lastApiStartFetchAt = nowTs;
            log("API: не удалось получить время старта:", e);
            return null;
        }
    }

    function collectStartDateCandidates() {
        const candidates = [];
        const seen = new Set();

        const rowSelectors = [
            ".lotAttribute",
            ".attr",
            "[class*='lotAttribute']",
            "[class*='attribute']",
            "tr",
            "li",
            "section",
            "article"
        ];

        for (const selector of rowSelectors) {
            for (const row of document.querySelectorAll(selector)) {
                const text = normalizeText(row.innerText);
                if (!text.includes(APPLICATION_START_LABEL)) continue;

                const parsed = parseDateTimeAfterLabel(text, APPLICATION_START_LABEL);
                if (!parsed) continue;

                const key = `${APPLICATION_START_LABEL}:${parsed.date.getTime()}`;
                if (seen.has(key)) continue;
                seen.add(key);

                candidates.push({
                    ...parsed,
                    label: APPLICATION_START_LABEL,
                    priority: 1,
                    text,
                    element: row
                });
            }
        }

        const allNodes = [...document.querySelectorAll("div, span, p, li, td")];
        for (const node of allNodes) {
            const text = normalizeText(node.innerText);
            if (!text.includes(APPLICATION_START_LABEL)) continue;

            const parsed = parseDateTimeAfterLabel(text, APPLICATION_START_LABEL);
            if (!parsed) continue;

            const key = `${APPLICATION_START_LABEL}:${parsed.date.getTime()}`;
            if (seen.has(key)) continue;
            seen.add(key);

            candidates.push({
                ...parsed,
                label: APPLICATION_START_LABEL,
                priority: 1,
                text,
                element: node.parentElement || node
            });
        }

        return candidates;
    }

    function chooseStartDateCandidate(candidates, now) {
        if (!candidates.length) return null;

        const nowMs = now?.getTime?.() || Date.now();
        const future = candidates.filter(candidate => candidate.date.getTime() >= nowMs - 1000);
        const source = future.length ? future : candidates;

        return source.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            if (future.length) return a.date.getTime() - b.date.getTime();
            return b.date.getTime() - a.date.getTime();
        })[0] || null;
    }

    function parseStartDateTimeFromPage() {
        const candidates = collectStartDateCandidates();
        const selected = chooseStartDateCandidate(candidates, getSyncedNowDate());

        if (!selected) {
            lastSelectedStartInfo = null;
            const key = "NOT_FOUND";
            if (lastStartLogKey !== key) {
                log("Не найден блок даты старта");
                lastStartLogKey = key;
            }
            return null;
        }

        const text = selected.text;
        lastSelectedStartInfo = {
            label: selected.label,
            date: selected.date,
            text: selected.text,
            candidatesCount: candidates.length
        };

        if (text !== lastParsedStartText) {
            log("Выбран старт:", selected.label, "=>", text);
            if (candidates.length > 1) {
                log("Найдено вариантов старта:", candidates.map(candidate => `${candidate.label}: ${formatDateMoscow(candidate.date)}`).join(" | "));
            }
            lastParsedStartText = text;
        }

        const key = `OK:${selected.label}:${selected.date.getTime()}`;
        if (lastStartLogKey !== key) {
            if (selected.hasOffset) {
                log("Учтено смещение", selected.offset, "=> старт по Москве:", formatDateMoscow(selected.date));
            } else {
                log("Смещение не указано, считаю время московским:", formatDateMoscow(selected.date));
            }
            lastStartLogKey = key;
        }

        return selected.date;
    }

    function findReceptionBadge() {
        const candidates = [...document.querySelectorAll("div, span, a, p")];
        return candidates.find(el => {
            const text = normalizeText(el.innerText);
            return isVisible(el) && text === "Прием заявок";
        }) || null;
    }

    function getLotStatusText() {
        if (!settings) return "Инициализация";
        if (!settings.botEnabled) return "Бот выключен";
        if (state === "DONE") return "Сценарий завершён";
        if (state === "LOSS") return "Лот уже забран другим покупателем";
        if (state === "WIN") return "Победа";
        if (state === "READY_SELECT") return "Тест остановлен перед кнопкой «Выбрать»";
        if (state === "AUTH_REQUIRED") return "Необходима авторизация — войдите в систему, нажмите F9 и F8";
        if (state === "AUTH_OR_BACKEND_GATE") return "Диалог входа или backend ещё не принял заявку";
        if (findBuyButton(document)) return "Кнопка «Купить» найдена";
        if (findReceptionBadge()) return "Приём заявок открыт";
        if (!lastTimingInfo) return "Проверка страницы";
        if (!lastTimingInfo.ok) return "Время старта не найдено";
        if (lastTimingInfo.activeLotReason === "buy_button") return "Активный лот: кнопка «Купить» уже есть";
        if (lastTimingInfo.activeLotReason === "reception_badge") return "Активный лот: приём заявок уже открыт";
        if (lastTimingInfo.isCombat) return "Активное обновление до появления кнопки";
        return "Ожидание начала торгов";
    }

    function dispatchMouseSequence(el, x, y) {
        const types = [
            "pointerover",
            "pointerenter",
            "mouseover",
            "mouseenter",
            "mousemove",
            "pointermove",
            "pointerdown",
            "mousedown",
            "pointerup",
            "mouseup",
            "click"
        ];

        for (const type of types) {
            try {
                el.dispatchEvent(new MouseEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    composed: true,
                    view: window,
                    clientX: x,
                    clientY: y
                }));
            } catch (_) {}
        }
    }

    function aggressiveClick(el, label = "") {
        if (!el) return false;
        if (isDisabledControl(el)) {
            traceTestFlowThrottled("click_skipped_disabled", {
                label,
                tag: el.tagName,
                text: normalizeText(el.innerText || el.textContent),
                html: el.outerHTML ? el.outerHTML.slice(0, 1200) : ""
            }, 500);
            return false;
        }

        try {
            el.scrollIntoView({ block: "center", inline: "center" });
        } catch (_) {}

        try {
            el.click();
        } catch (_) {}

        if (label) log("Нажал:", label);
        traceTestFlow("click", {
            label,
            tag: el.tagName,
            text: normalizeText(el.innerText || el.textContent),
            html: el.outerHTML ? el.outerHTML.slice(0, 1200) : ""
        });
        return true;
    }

    function compactRect(rect) {
        if (!rect) return null;
        const round = value => Math.round(Number(value || 0) * 100) / 100;
        return {
            x: round(rect.x),
            y: round(rect.y),
            width: round(rect.width),
            height: round(rect.height),
            top: round(rect.top),
            right: round(rect.right),
            bottom: round(rect.bottom),
            left: round(rect.left)
        };
    }

    function compactElementInfo(el) {
        if (!el) return null;
        return {
            tagName: el.tagName || null,
            id: el.id || "",
            className: typeof el.className === "string" ? el.className : String(el.getAttribute?.("class") || ""),
            text: normalizeText(el.innerText || el.textContent).slice(0, 500),
            outerHTML: el.outerHTML ? el.outerHTML.slice(0, 1500) : ""
        };
    }

    function getBuyButtonCandidates(root = document) {
        const candidates = [];
        const seen = new Set();
        const add = (el, source) => {
            if (!el || seen.has(el)) return;
            seen.add(el);
            candidates.push({ el, source });
        };

        for (const label of root.querySelectorAll("span.button__label")) {
            if (normalizeText(label.textContent) !== "Купить") continue;
            add(label.closest("button, a, [role='button']") || label, "span.button__label");
        }

        for (const el of root.querySelectorAll("button, [role='button'], a")) {
            if (normalizeText(el.textContent) === "Купить") {
                add(el, el.tagName?.toLowerCase?.() || "button_candidate");
            }
        }

        return candidates;
    }

    function diagnoseBuyCandidate(candidate) {
        const el = candidate?.el || null;
        const rect = el ? el.getBoundingClientRect() : null;
        const width = rect?.width || 0;
        const height = rect?.height || 0;
        const centerX = rect ? rect.left + width / 2 : null;
        const centerY = rect ? rect.top + height / 2 : null;
        const visible = !!(el && isVisible(el));
        const hasSize = width > 0 && height > 0;
        const inViewport = !!(
            hasSize &&
            centerX >= 0 &&
            centerY >= 0 &&
            centerX <= window.innerWidth &&
            centerY <= window.innerHeight
        );
        const topElement = inViewport ? document.elementFromPoint(centerX, centerY) : null;
        const coveredByOtherElement = !!(el && topElement && topElement !== el && !el.contains(topElement) && !topElement.contains(el));
        const disabled = isDisabledControl(el);
        const ariaDisabled = el?.getAttribute?.("aria-disabled") || "";
        const spinner = hasBuyButtonSpinner(el);
        const clickable = !!(
            el &&
            visible &&
            hasSize &&
            inViewport &&
            topElement &&
            !disabled &&
            !spinner &&
            !coveredByOtherElement
        );
        let notClickableReason = null;
        if (!el) notClickableReason = "not_found";
        else if (!visible) notClickableReason = "not_visible";
        else if (!hasSize) notClickableReason = "zero_size";
        else if (!inViewport) notClickableReason = "center_outside_viewport";
        else if (!topElement) notClickableReason = "no_element_from_point";
        else if (disabled) notClickableReason = "disabled";
        else if (spinner) notClickableReason = "spinner_or_processing";
        else if (coveredByOtherElement) notClickableReason = "covered_by_other_element";

        return {
            found: !!el,
            source: candidate?.source || null,
            tagName: el?.tagName || null,
            text: normalizeText(el?.innerText || el?.textContent).slice(0, 500),
            outerHTML: el?.outerHTML ? el.outerHTML.slice(0, 1500) : "",
            disabled,
            ariaDisabled,
            className: typeof el?.className === "string" ? el.className : String(el?.getAttribute?.("class") || ""),
            spinner,
            rect: compactRect(rect),
            center: centerX === null || centerY === null ? null : {
                x: Math.round(centerX * 100) / 100,
                y: Math.round(centerY * 100) / 100
            },
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            },
            visible,
            hasSize,
            inViewport,
            elementFromPoint: compactElementInfo(topElement),
            coveredByOtherElement,
            clickable,
            notClickableReason
        };
    }

    function getBuyButtonDiagnostics(root = document) {
        const candidates = getBuyButtonCandidates(root);
        const diagnostics = candidates.map(diagnoseBuyCandidate);
        const primary =
            diagnostics.find(item => item.clickable) ||
            diagnostics.find(item => item.visible) ||
            diagnostics[0] ||
            diagnoseBuyCandidate(null);

        return {
            presentDom: candidates.length > 0,
            visible: diagnostics.some(item => item.visible),
            clickable: diagnostics.some(item => item.clickable),
            candidateCount: candidates.length,
            primary,
            candidates: diagnostics.slice(0, 5)
        };
    }

    function getBuyButtonDiagnosticFields(root = document) {
        const buyButtonDiagnostics = getBuyButtonDiagnostics(root);
        return {
            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
            buyButtonVisible: buyButtonDiagnostics.visible,
            buyButtonClickable: buyButtonDiagnostics.clickable,
            buyButtonDiagnostics
        };
    }

    function findBuyButton(root = document) {
        const candidates = getBuyButtonCandidates(root);
        let visibleFallback = null;
        for (const candidate of candidates) {
            const diagnostics = diagnoseBuyCandidate(candidate);
            if (diagnostics.clickable) return candidate.el;
            if (!visibleFallback && diagnostics.visible && !diagnostics.disabled) {
                visibleFallback = candidate.el;
            }
        }
        return visibleFallback;
    }

    function findBuyButtonDomElement(root = document) {
        const candidates = getBuyButtonCandidates(root);
        return candidates[0]?.el || null;
    }

    function shouldScrollBuyCandidateIntoView(diagnostics) {
        if (!diagnostics?.found) return false;
        if (diagnostics.disabled || diagnostics.spinner) return false;
        return !diagnostics.inViewport ||
            diagnostics.notClickableReason === "center_outside_viewport" ||
            diagnostics.notClickableReason === "no_element_from_point";
    }

    async function scrollBuyCandidateIntoView(button, diagnostics, source = "buy_scroll_into_view") {
        if (!button || !shouldScrollBuyCandidateIntoView(diagnostics)) return false;

        diagnosticRecord("buy_scroll_into_view", getCombatTimingPayload({
            source,
            reason: diagnostics?.notClickableReason || "outside_viewport",
            before: diagnostics,
            ...getBuyButtonDiagnosticFields()
        }));

        try {
            button.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        } catch (_) {
            try {
                button.scrollIntoView({ block: "center", inline: "center" });
            } catch (e) {
                return false;
            }
        }

        await delay(180);
        return true;
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function findStableActionableBuyButton(stableMs = BUY_ACTIONABILITY_STABLE_MS) {
        let first = findBuyButton(document) || findBuyButtonDomElement(document);
        if (!first) return { ok: false, reason: "not_actionable_first_check", button: null };

        let firstDiagnostics = diagnoseBuyCandidate({ el: first, source: "stable_first_check" });
        if (!firstDiagnostics.clickable && shouldScrollBuyCandidateIntoView(firstDiagnostics)) {
            await scrollBuyCandidateIntoView(first, firstDiagnostics, "stable_first_check");
            first = findBuyButton(document) || findBuyButtonDomElement(document) || first;
            firstDiagnostics = diagnoseBuyCandidate({ el: first, source: "stable_after_scroll_check" });
        }

        if (!firstDiagnostics.clickable) {
            return { ok: false, reason: firstDiagnostics.notClickableReason || "not_actionable_first_check", button: first, diagnostics: firstDiagnostics };
        }

        await delay(stableMs);

        const second = findBuyButton(document) || findBuyButtonDomElement(document);
        if (!second) return { ok: false, reason: "not_actionable_after_stability_wait", button: null, diagnostics: getBuyButtonDiagnostics() };

        const secondDiagnostics = diagnoseBuyCandidate({ el: second, source: "stable_second_check" });
        if (!secondDiagnostics.clickable) {
            return { ok: false, reason: secondDiagnostics.notClickableReason || "not_actionable_after_stability_wait", button: second, diagnostics: secondDiagnostics };
        }

        return {
            ok: true,
            reason: "stable_actionable",
            button: second,
            diagnostics: secondDiagnostics,
            stableMs
        };
    }

    function getBuyClickTimingGuard() {
        const configuredBuyClickDelayMs = Math.max(0, Number(settings?.buyClickDelayMs ?? DEFAULT_BUY_CLICK_DELAY_MS));
        const minPageAgeBeforeBuyClickMs = Math.max(0, Number(settings?.minPageAgeBeforeBuyClickMs ?? DEFAULT_MIN_PAGE_AGE_BEFORE_BUY_CLICK_MS));
        const pageReadyAgeMs = Date.now() - pageReadyAt;
        const minPageAgeRemainingMs = Math.max(0, minPageAgeBeforeBuyClickMs - pageReadyAgeMs);
        const waitMs = Math.max(configuredBuyClickDelayMs, minPageAgeRemainingMs);

        return {
            configuredBuyClickDelayMs,
            minPageAgeBeforeBuyClickMs,
            pageReadyAgeMs,
            minPageAgeRemainingMs,
            waitMs
        };
    }

    function diagnoseCurrentBuyClickability(source = "buy_click_guard") {
        const btn = findBuyButton(document);
        const diagnostics = btn
            ? diagnoseBuyCandidate({ el: btn, source })
            : getBuyButtonDiagnostics().primary;
        return {
            button: btn,
            diagnostics,
            ok: !!(btn && diagnostics?.clickable)
        };
    }

    function findButtonByText(text, root = document) {
        const target = normalizeText(text);

        if (target === "Купить") {
            return findBuyButton(root);
        }

        const labels = [...root.querySelectorAll("span.button__label")];

        for (const label of labels) {
            const labelText = normalizeText(label.textContent);
            if (labelText !== target) continue;

            let el = label;
            for (let i = 0; i < 8; i++) {
                if (!el) break;

                if (
                    el.tagName === "BUTTON" ||
                    el.tagName === "A" ||
                    el.getAttribute("role") === "button"
                ) {
                    if (isVisible(el) && !isDisabledControl(el)) {
                        return el;
                    }
                }

                el = el.parentElement;
            }

            if (isVisible(label) && !isDisabledControl(label)) {
                return label;
            }
        }

        const buttons = [...root.querySelectorAll("button, a, [role='button']")];
        for (const btn of buttons) {
            if (!isVisible(btn) || isDisabledControl(btn)) continue;
            const txt = normalizeText(btn.textContent);
            if (txt === target) return btn;
        }

        const all = [...root.querySelectorAll("*")];
        for (const el of all) {
            if (!isVisible(el) || isDisabledControl(el)) continue;
            const txt = normalizeText(el.textContent);
            if (txt === target) return el;
        }

        return null;
    }

    function clickButtonByText(text, root = document, debugLabel = text) {
        const btn = findButtonByText(text, root);
        if (!btn) return false;
        return aggressiveClick(btn, debugLabel);
    }

    function getOverlays() {
        const selectors = [
            "[role='dialog']",
            ".cdk-overlay-pane",
            ".cdk-dialog-container",
            ".modal",
            ".dialog",
            ".popup",
            ".ng-dropdown-panel"
        ];

        const nodes = [];
        for (const selector of selectors) {
            for (const el of document.querySelectorAll(selector)) {
                if (isVisible(el)) {
                    nodes.push(el);
                }
            }
        }
        return nodes;
    }

    function getTopOverlay() {
        const overlays = getOverlays();
        if (!overlays.length) return null;
        return overlays[overlays.length - 1];
    }

    function findOverlayByText(text) {
        const overlays = getOverlays();
        for (let i = overlays.length - 1; i >= 0; i--) {
            const overlay = overlays[i];
            if (normalizeText(overlay.innerText).includes(text)) {
                return overlay;
            }
        }
        return null;
    }

    function findTargetCheckbox() {
        return (
            document.querySelector("input.checkbox-wrapper__checkbox") ||
            document.querySelector('input[type="checkbox"]')
        );
    }

    function isPrivateContractViewUrl(url = location.href) {
        return /\/new\/private\/e-contracts\/view\//i.test(String(url || ""));
    }

    function markBuyClicked(buyBtn) {
        buyClickedAt = Date.now();
        buyClickedUrl = location.href;
        if (!buyFlowStartedAt) {
            buyFlowStartedAt = buyClickedAt;
            lastBuyFlowDurationMs = null;
            lastBuyFlowDurationLabel = "";
        }
        const clickedButtonDiagnostics = buyBtn ? diagnoseBuyCandidate({ el: buyBtn, source: "clicked_element" }) : null;
        const buyButtonDiagnostics = clickedButtonDiagnostics
            ? {
                presentDom: true,
                visible: clickedButtonDiagnostics.visible,
                clickable: clickedButtonDiagnostics.clickable,
                candidateCount: 1,
                primary: clickedButtonDiagnostics,
                candidates: [clickedButtonDiagnostics]
            }
            : getBuyButtonDiagnostics();
        diagnosticRecord("buy_clicked", getCombatTimingPayload({
            fromUrl: buyClickedUrl,
            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
            buyButtonVisible: buyButtonDiagnostics.visible,
            buyButtonClickable: buyButtonDiagnostics.clickable,
            buyButtonDiagnostics,
            html: buyBtn?.outerHTML ? buyBtn.outerHTML.slice(0, 1500) : "",
            v55: {
                ...(typeof diagBuildExtras === "function" ? diagBuildExtras() : {}),
                tMinusAtClick: (typeof diagGetTMinusMs === "function") ? diagGetTMinusMs() : null,
                msFromBuyDomAppear: diagBuyDomFirstSeenAt ? Date.now() - diagBuyDomFirstSeenAt : null,
                msFromBuyClickableAppear: diagBuyClickableFirstSeenAt ? Date.now() - diagBuyClickableFirstSeenAt : null
            }
        }));
        diagnosticRecord("buy_click_timing", getCombatTimingPayload({
            fromUrl: buyClickedUrl,
            msSinceBuyButtonFound: lastBuyButtonFoundAt ? buyClickedAt - lastBuyButtonFoundAt : null,
            msSinceCombatWatchStarted: combatWatchStartedAt ? buyClickedAt - combatWatchStartedAt : null,
            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
            buyButtonVisible: buyButtonDiagnostics.visible,
            buyButtonClickable: buyButtonDiagnostics.clickable,
            buyButtonDiagnostics,
            html: buyBtn?.outerHTML ? buyBtn.outerHTML.slice(0, 1500) : ""
        }));
        traceTestFlow("buy_click_started", {
            url: buyClickedUrl,
            html: buyBtn?.outerHTML ? buyBtn.outerHTML.slice(0, 1500) : ""
        });
    }

    function resetBuyTransition(reason) {
        buyClickedAt = 0;
        buyClickedUrl = "";
        buyRecoveryCount = 0;
        softAuthDialogRetryCount = 0;
        postReloadSoftAuthRetryCount = 0;
        softAuthDialogRetryScheduled = false;
        sessionStorage.removeItem("torgiBotSoftAuthDialogRetryCount");
        sessionStorage.removeItem("torgiBotPostReloadSoftAuthRetryCount");
        traceTestFlow("buy_transition_reset", { reason });
    }

    function clickCheckbox() {
        const checkbox = findTargetCheckbox();
        if (!checkbox) {
            log("Чекбокс не найден");
            return false;
        }

        if (checkbox.checked) {
            log("Чекбокс уже установлен");
            return true;
        }

        const clickable =
            checkbox.closest("label") ||
            checkbox.closest(".checkbox-wrapper") ||
            checkbox.parentElement ||
            checkbox;

        aggressiveClick(clickable, "Чекбокс");

        setTimeout(() => {
            if (!checkbox.checked) {
                try {
                    checkbox.checked = true;
                    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
                    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
                    log("Чекбокс установлен принудительно");
                } catch (e) {
                    log("Не удалось принудительно установить чекбокс:", e);
                }
            }
        }, 30);

        return true;
    }

    function getCertificateDialog() {
        const exact = findOverlayByText("Выберите сертификат для формирования подписи");
        if (exact) return exact;

        const overlays = getOverlays();
        for (let i = overlays.length - 1; i >= 0; i--) {
            const text = normalizeText(overlays[i].innerText || overlays[i].textContent);
            if (/выберите\s+сертификат/i.test(text) && /выберите\s+значение/i.test(text)) {
                return overlays[i];
            }
        }

        return findOverlayByText("Выберите сертификат") || null;
    }

    function isProviderText(text) {
        return /крипто\s*-\s*про\s*csp/i.test(normalizeText(text));
    }

    function isCertificateText(text) {
        const value = normalizeText(text);
        if (!value || /выберите\s+значение/i.test(value) || isProviderText(value)) return false;

        return (
            /сем[её]нов|михаил|владимирович/i.test(value) ||
            /CN\s*=|действителен|тензор|удостоверяющий\s+центр/i.test(value) ||
            /\b\d{2}\.\d{2}\.\d{4}\b/.test(value)
        );
    }

    function getCertificateSelectRoot() {
        const dialog = getCertificateDialog();
        const root = dialog || document;
        const selects = [...root.querySelectorAll("ng-select, .ng-select")].filter(isVisible);

        const selected = selects.find(sel => isCertificateText(sel.innerText || sel.textContent));
        if (selected) return selected;

        const emptyCertificateSelect = selects.find(sel => {
            const text = normalizeText(sel.innerText || sel.textContent);
            return /выберите\s+значение/i.test(text) && !isProviderText(text);
        });
        if (emptyCertificateSelect) return emptyCertificateSelect;

        const nonProvider = selects.find(sel => !isProviderText(sel.innerText || sel.textContent));
        return nonProvider || selects[0] || null;
    }

    function getSelectedCertificateText() {
        const select = getCertificateSelectRoot();
        if (!select) return "";

        const selectedNodes = [
            ...select.querySelectorAll(".ng-value-label"),
            ...select.querySelectorAll(".ng-value"),
            ...select.querySelectorAll(".ng-select-container")
        ];

        for (const node of selectedNodes) {
            const text = normalizeText(node.innerText || node.textContent);
            if (isCertificateText(text)) return text;
        }

        return "";
    }

    function isCertificateSelected() {
        return !!getSelectedCertificateText();
    }

    function tryOpenCertDropdown() {
        const dialog = getCertificateDialog();
        const root = dialog || document;
        const certSelect = getCertificateSelectRoot();

        if (certSelect) {
            const alreadyOpen = certSelect.classList.contains("ng-select-opened") ||
                certSelect.querySelector(".ng-dropdown-panel") !== null;
            if (alreadyOpen) return false;
            const trigger =
                certSelect.querySelector(".ng-arrow-wrapper") ||
                certSelect.querySelector(".ng-select-container") ||
                certSelect.querySelector(".ng-value-container") ||
                certSelect;
            aggressiveClick(trigger, "Поле сертификата");
            try {
                const rect = trigger.getBoundingClientRect();
                dispatchMouseSequence(trigger, rect.left + rect.width / 2, rect.top + rect.height / 2);
            } catch (_) {}
            log("Открываю выпадающий список сертификатов");
            traceTestFlow("cert_dropdown_open_click", {
                selectText: normalizeText(certSelect.innerText || certSelect.textContent).slice(0, 500),
                selectHtml: certSelect.outerHTML ? certSelect.outerHTML.slice(0, 1500) : ""
            });
            return true;
        }

        const ngSelects = root.querySelectorAll("ng-select, .ng-select");
        for (const sel of ngSelects) {
            if (!isVisible(sel)) continue;
            const alreadyOpen = sel.classList.contains("ng-select-opened") ||
                sel.querySelector(".ng-dropdown-panel") !== null;
            if (alreadyOpen) return false;
            const trigger =
                sel.querySelector(".ng-arrow-wrapper") ||
                sel.querySelector(".ng-select-container") ||
                sel.querySelector(".ng-value-container") ||
                sel;
            aggressiveClick(trigger, "Поле сертификата");
            try {
                const rect = trigger.getBoundingClientRect();
                dispatchMouseSequence(trigger, rect.left + rect.width / 2, rect.top + rect.height / 2);
            } catch (_) {}
            log("Открываю выпадающий список сертификатов");
            return true;
        }

        const plainSelect = root.querySelector("select");
        if (plainSelect && isVisible(plainSelect)) {
            plainSelect.focus();
            plainSelect.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            log("Открываю <select> сертификатов");
            return true;
        }

        return false;
    }

    function getVisibleCertificateOptions() {
        const dialog = getCertificateDialog();
        const dropdownPanels = [
            ...document.querySelectorAll(".ng-dropdown-panel, [role='listbox'], .cdk-overlay-pane")
        ].filter(isVisible);
        const roots = [...dropdownPanels, dialog, document].filter(Boolean);
        const seen = new Set();

        for (const root of roots) {
            const isDropdownRoot = dropdownPanels.includes(root);
            const options = [
                ...root.querySelectorAll(".ng-option"),
                ...root.querySelectorAll("[role='option']"),
                ...root.querySelectorAll(".mat-option"),
                ...root.querySelectorAll(".dropdown-item"),
                ...root.querySelectorAll(".ng-option-label"),
                ...root.querySelectorAll(".ng-dropdown-panel .ng-option"),
                ...root.querySelectorAll(".ng-dropdown-panel [role='option']"),
                ...root.querySelectorAll(".ng-dropdown-panel .ng-option-label"),
                ...root.querySelectorAll(".ng-dropdown-panel *"),
                ...(isDropdownRoot ? root.querySelectorAll("span, div") : [])
            ].filter(el => {
                if (seen.has(el)) return false;
                seen.add(el);
                const text = normalizeText(el.innerText || el.textContent);
                return isVisible(el) && isCertificateText(text);
            });

            if (options.length) {
                return options;
            }
        }

        return [];
    }

    function getVisibleCertDropdownTexts(limit = 30) {
        const roots = [
            ...document.querySelectorAll(".ng-dropdown-panel, [role='listbox'], .cdk-overlay-pane"),
            getCertificateDialog()
        ].filter(Boolean).filter(isVisible);
        const texts = [];
        const seen = new Set();

        for (const root of roots) {
            const nodes = [
                root,
                ...root.querySelectorAll(".ng-option, [role='option'], .ng-option-label, .dropdown-item, span, div")
            ];

            for (const node of nodes) {
                const text = normalizeText(node.innerText || node.textContent);
                if (!text || seen.has(text)) continue;
                seen.add(text);
                texts.push(text.slice(0, 500));
                if (texts.length >= limit) return texts;
            }
        }

        return texts;
    }

    function collectCertificateDiagnostics() {
        const dialog = getCertificateDialog();
        const selects = [...(dialog || document).querySelectorAll("ng-select, .ng-select")]
            .filter(isVisible)
            .map(sel => normalizeText(sel.innerText || sel.textContent).slice(0, 500));
        const overlays = getOverlays().map(overlay => normalizeText(overlay.innerText || overlay.textContent).slice(0, 500));

        return {
            dialogFound: !!dialog,
            dialogText: dialog ? normalizeText(dialog.innerText || dialog.textContent).slice(0, 1000) : "",
            selects,
            overlays,
            dropdownTexts: getVisibleCertDropdownTexts()
        };
    }

    function findCertificateOption() {
        const options = getVisibleCertificateOptions();

        if (options.length === 1) {
            log("Найден единственный сертификат");
            return options[0];
        }

        if (options.length > 1) {
            const preferred = options.find(option => /сем[её]нов|михаил|владимирович/i.test(normalizeText(option.innerText || option.textContent)));
            log("Найдено несколько сертификатов, беру подходящий:", options.length);
            return preferred || options[0];
        }

        return null;
    }

    function clickCertificate() {
        const cert = findCertificateOption();
        if (!cert) {
            log("Сертификат не найден");
            return false;
        }

        return aggressiveClick(cert, "Сертификат");
    }

    function isBuyButtonPresent() {
        return !!findBuyButton(document);
    }

    function isBuyButtonPresentDom() {
        return getBuyButtonDiagnostics().presentDom;
    }

    function getActiveLotReason() {
        if (isBuyButtonPresentDom()) return "buy_button";
        if (findReceptionBadge()) return "reception_badge";
        return null;
    }

    function isLotActiveNow() {
        return !!getActiveLotReason();
    }

    async function getTimingInfo(enabled = true) {
        const now = getSyncedNowDate();
        if (!now || Number.isNaN(now.getTime())) {
            return { ok: false, reason: "now_not_found", enabled };
        }

        const activeLotReason = getActiveLotReason();
        if (activeLotReason) {
            const start = parseStartDateTimeFromPage() || await parseStartDateTimeFromApi();
            const preStartSeconds = Number(settings?.preStartSeconds ?? 5);
            const combatAt = start ? start.getTime() - preStartSeconds * 1000 : now.getTime();
            if (start && now.getTime() < start.getTime()) {
                return {
                    ok: true,
                    enabled,
                    start,
                    now,
                    combatAt,
                    isCombat: now.getTime() >= combatAt,
                    msToStart: start.getTime() - now.getTime(),
                    msToCombat: combatAt - now.getTime(),
                    forceActive: false,
                    activeLotReason,
                    buyDomBeforeStart: true
                };
            }

            return {
                ok: true,
                enabled,
                start,
                now,
                combatAt: now.getTime(),
                isCombat: true,
                msToStart: start ? Math.max(start.getTime() - now.getTime(), 0) : 0,
                msToCombat: 0,
                forceActive: true,
                activeLotReason
            };
        }

        if (settings?.manualStartTime) {
            const manualDate = new Date(settings.manualStartTime);
            if (!Number.isNaN(manualDate.getTime())) {
                const preStartSeconds = Number(settings?.preStartSeconds ?? 5);
                const combatAt = manualDate.getTime() - preStartSeconds * 1000;
                log("Используется ручное время старта:", formatDateMoscow(manualDate));
                return {
                    ok: true,
                    enabled,
                    start: manualDate,
                    now,
                    combatAt,
                    isCombat: now.getTime() >= combatAt,
                    msToStart: manualDate.getTime() - now.getTime(),
                    msToCombat: combatAt - now.getTime(),
                    forceActive: false,
                    isManual: true
                };
            }
        }

        const start = parseStartDateTimeFromPage() || await parseStartDateTimeFromApi();
        if (!start) {
            return { ok: false, reason: "start_not_found", enabled };
        }

        const preStartSeconds = Number(settings?.preStartSeconds ?? 5);
        const combatAt = start.getTime() - preStartSeconds * 1000;

        return {
            ok: true,
            enabled,
            start,
            now,
            combatAt,
            isCombat: now.getTime() >= combatAt,
            msToStart: start.getTime() - now.getTime(),
            msToCombat: combatAt - now.getTime(),
            forceActive: false
        };
    }

    function findAuthDialog() {
        const authPhrases = [
            "Войдите в систему",
            "Войти или зарегистрироваться",
            "Необходимо войти в систему",
            "Авторизация",
            "Вход в личный кабинет"
        ];
        for (const phrase of authPhrases) {
            const found = findOverlayByText(phrase);
            if (found) return found;
        }
        return null;
    }

    function getRealAuthUrlReason(url = location.href) {
        const lowerUrl = String(url || "").toLowerCase();
        if (lowerUrl.includes("/esia")) return "url_contains_esia";
        if (lowerUrl.includes("/login")) return "url_contains_login";
        if (lowerUrl.includes("gosuslugi.ru")) return "url_contains_gosuslugi";
        if (lowerUrl.includes("lk.gosuslugi")) return "url_contains_lk_gosuslugi";
        if (lowerUrl.includes("esia.gosuslugi")) return "url_contains_esia_gosuslugi";
        return null;
    }

    function isPublicLotUrl(url = location.href) {
        return /\/new\/public\/lots\/lot\//i.test(String(url || ""));
    }

    function findCancelButton(root = document) {
        const candidates = [...root.querySelectorAll("button, a, [role='button'], span.button__label, div, span")];
        for (const el of candidates) {
            if (!isVisible(el) || isDisabledControl(el)) continue;
            const text = normalizeText(el.innerText || el.textContent);
            if (text !== "Отменить") continue;
            return el.closest?.("button, a, [role='button']") || el;
        }

        for (const label of root.querySelectorAll("span.button__label")) {
            if (normalizeText(label.textContent) !== "Отменить") continue;
            const button = label.closest?.("button, a, [role='button']");
            if (button && !isDisabledControl(button)) return button;
            return label;
        }

        return null;
    }

    function getSoftAuthDialogInfo(authDialog) {
        const realAuthReason = getRealAuthUrlReason();
        const cancelButton = authDialog ? findCancelButton(authDialog) : null;
        const dialogText = normalizeText(authDialog?.innerText || authDialog?.textContent);
        const softDialog = !!(
            authDialog &&
            !realAuthReason &&
            isPublicLotUrl() &&
            /войдите в систему|необходимо войти в систему|войти или зарегистрироваться/i.test(dialogText)
        );

        return {
            softDialog,
            realAuthReason,
            publicLotUrl: isPublicLotUrl(),
            cancelButton,
            dialogText: dialogText.slice(0, 1000)
        };
    }

    function scheduleSoftAuthCancelWait({
        authDialog,
        softInfo,
        waitCount,
        source,
        lastReload = null,
        onFound,
        onLimit
    }) {
        const nextWaitCount = waitCount + 1;
        diagnosticRecord(`${source}_cancel_not_found`, getCombatTimingPayload({
            waitCount,
            waitMax: SOFT_AUTH_CANCEL_WAIT_MAX,
            retryDelayMs: SOFT_AUTH_CANCEL_WAIT_MS,
            dialogText: softInfo?.dialogText || "",
            html: authDialog?.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
            lastReload,
            ...getBuyButtonDiagnosticFields()
        }));

        if (nextWaitCount > SOFT_AUTH_CANCEL_WAIT_MAX) {
            diagnosticRecord(`${source}_cancel_wait_limit_reached`, getCombatTimingPayload({
                waitCount,
                waitMax: SOFT_AUTH_CANCEL_WAIT_MAX,
                dialogText: softInfo?.dialogText || "",
                html: authDialog?.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
                lastReload,
                ...getBuyButtonDiagnosticFields()
            }));
            onLimit?.();
            return true;
        }

        setTimeout(() => {
            const latestDialog = findAuthDialog();
            const latestInfo = getSoftAuthDialogInfo(latestDialog);
            if (latestInfo.softDialog && latestInfo.cancelButton) {
                onFound?.(latestDialog, latestInfo);
                return;
            }
            scheduleSoftAuthCancelWait({
                authDialog: latestDialog || authDialog,
                softInfo: latestInfo.softDialog ? latestInfo : softInfo,
                waitCount: nextWaitCount,
                source,
                lastReload,
                onFound,
                onLimit
            });
        }, SOFT_AUTH_CANCEL_WAIT_MS);

        return true;
    }

    function handlePostReloadAuthDialog(lastReload) {
        const authDialog = findAuthDialog();
        const realAuthReason = getRealAuthUrlReason();

        if (!authDialog && !realAuthReason) return false;

        if (realAuthReason) {
            log("После перезагрузки обнаружен реальный вход:", realAuthReason);
            const authDetails = markAuthRequired("after_combat_reload_real_auth_url");
            diagnosticRecord("post_reload_real_auth_required", {
                realAuthReason,
                authDetails,
                lastReload
            });
            recordAuthTerminalState("AUTH_REQUIRED", "real_auth_url", {
                source: "after_combat_reload_real_auth_url",
                realAuthReason,
                context: { lastReload, authDetails }
            });
            setState("AUTH_REQUIRED");
            stopAllTimers();
            updateWidget();
            return true;
        }

        const softInfo = getSoftAuthDialogInfo(authDialog);
        if (!softInfo.softDialog) {
            log("После перезагрузки обнаружена необходимость авторизации — бот остановлен. Войдите в систему и нажмите F9 + F8.");
            const authDetails = markAuthRequired("after_combat_reload");
            diagnosticRecord("post_reload_real_auth_required", {
                softInfo: {
                    publicLotUrl: softInfo.publicLotUrl,
                    realAuthReason: softInfo.realAuthReason,
                    hasCancelButton: !!softInfo.cancelButton,
                    dialogText: softInfo.dialogText
                },
                authDetails,
                lastReload
            });
            recordAuthTerminalState("AUTH_REQUIRED", "auth_dialog_after_reload", {
                source: "after_combat_reload",
                realAuthReason: softInfo.realAuthReason || null,
                context: {
                    lastReload,
                    authDetails,
                    softInfo: {
                        publicLotUrl: softInfo.publicLotUrl,
                        hasCancelButton: !!softInfo.cancelButton,
                        dialogText: softInfo.dialogText
                    }
                }
            });
            setState("AUTH_REQUIRED");
            stopAllTimers();
            updateWidget();
            return true;
        }

        diagnosticRecord("post_reload_soft_auth_dialog", getCombatTimingPayload({
            retryCount: postReloadSoftAuthRetryCount,
            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
            dialogText: softInfo.dialogText,
            html: authDialog.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
            lastReload,
            ...getBuyButtonDiagnosticFields()
        }));

        if (!softInfo.cancelButton) {
            return scheduleSoftAuthCancelWait({
                authDialog,
                softInfo,
                waitCount: 0,
                source: "post_reload_soft_auth",
                lastReload,
                onFound: () => handlePostReloadAuthDialog(lastReload),
                onLimit: () => {
                    if (state !== "WAIT_BUY") return;
                    recordAuthTerminalState("AUTH_OR_BACKEND_GATE", "post_reload_cancel_button_not_found", {
                        source: "post_reload_soft_auth_cancel_not_found",
                        realAuthReason: null,
                        context: { lastReload, softInfo }
                    });
                    setState("AUTH_OR_BACKEND_GATE");
                    stopAutomationTimersKeepJournal("post_reload_soft_auth_cancel_not_found");
                    updateWidget();
                }
            });
        }

        if (postReloadSoftAuthRetryCount >= SOFT_AUTH_DIALOG_RETRY_MAX) {
            log("Мягкий диалог входа после reload повторился", postReloadSoftAuthRetryCount, "раз — останавливаю как AUTH_OR_BACKEND_GATE.");
            diagnosticRecord("post_reload_soft_auth_retry_limit_reached", getCombatTimingPayload({
                retryCount: postReloadSoftAuthRetryCount,
                retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                dialogText: softInfo.dialogText,
                html: authDialog.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
                lastReload,
                ...getBuyButtonDiagnosticFields()
            }));
            recordAuthTerminalState("AUTH_OR_BACKEND_GATE", "post_reload_soft_dialog_retry_exhausted", {
                source: "post_reload_soft_auth_retry_limit_reached",
                realAuthReason: null,
                context: {
                    lastReload,
                    retryCount: postReloadSoftAuthRetryCount,
                    retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                    dialogText: softInfo.dialogText
                }
            });
            setState("AUTH_OR_BACKEND_GATE");
            stopAutomationTimersKeepJournal("post_reload_soft_auth_retry_limit_reached");
            updateWidget();
            return true;
        }

        postReloadSoftAuthRetryCount += 1;
        sessionStorage.setItem("torgiBotPostReloadSoftAuthRetryCount", String(postReloadSoftAuthRetryCount));
        log("Мягкий диалог входа после reload — закрываю и возвращаюсь к покупке", postReloadSoftAuthRetryCount, "из", SOFT_AUTH_DIALOG_RETRY_MAX);
        aggressiveClick(softInfo.cancelButton, "Отменить (мягкий диалог после reload)");
        diagnosticRecord("post_reload_soft_auth_dialog_closed", getCombatTimingPayload({
            retryCount: postReloadSoftAuthRetryCount,
            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
            html: softInfo.cancelButton?.outerHTML ? softInfo.cancelButton.outerHTML.slice(0, 1000) : "",
            lastReload
        }));
        buyClickedAt = 0;
        buyClickedUrl = "";
        buyRecoveryCount = 0;
        setState("WAIT_BUY");
        diagnosticRecord("post_reload_soft_auth_retry_scheduled", getCombatTimingPayload({
            retryCount: postReloadSoftAuthRetryCount,
            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
            delayMs: POST_RELOAD_SOFT_AUTH_RETRY_DELAY_MS,
            lastReload
        }));
        setTimeout(() => {
            if (state !== "WAIT_BUY" || !settings?.botEnabled) return;
            runLogic();
            startObserverLoop(true);
        }, POST_RELOAD_SOFT_AUTH_RETRY_DELAY_MS);
        return true;
    }

    function collectAuthDiagnostics(trigger = "check") {
        const url = location.href;
        const urlReason = getRealAuthUrlReason(url);

        const authDialog = findAuthDialog();
        const authTexts = [
            "Войти или зарегистрироваться",
            "Войдите в систему",
            "Необходимо войти в систему",
            "Вход в личный кабинет",
            "Авторизация",
            "ЕСИА",
            "Госуслуги"
        ];
        const nodes = [...document.querySelectorAll("button, a, h1, h2, h3, p, div, span")];
        const textMatches = [];

        for (const text of authTexts) {
            const found = nodes.find(el => normalizeText(el.innerText || el.textContent) === text && isVisible(el));
            if (found) {
                textMatches.push({
                    text,
                    tag: found.tagName,
                    html: found.outerHTML ? found.outerHTML.slice(0, 1000) : ""
                });
            }
        }

        const authButtons = nodes
            .filter(el => {
                if (!isVisible(el)) return false;
                const text = normalizeText(el.innerText || el.textContent);
                return /войти|авторизац|госуслуг|есиа/i.test(text);
            })
            .slice(0, 12)
            .map(el => ({
                tag: el.tagName,
                text: normalizeText(el.innerText || el.textContent).slice(0, 300),
                html: el.outerHTML ? el.outerHTML.slice(0, 1000) : ""
            }));

        return {
            trigger,
            ts: new Date().toISOString(),
            url,
            state,
            reason: urlReason || (authDialog ? "auth_dialog_detected" : (textMatches.length ? "auth_text_detected" : "not_detected")),
            urlReason,
            dialogFound: !!authDialog,
            dialogText: authDialog ? normalizeText(authDialog.innerText || authDialog.textContent).slice(0, 1000) : "",
            textMatches,
            authButtons,
            title: document.title,
            referrer: document.referrer || "",
            navigationType: performance.getEntriesByType?.("navigation")?.[0]?.type || null,
            lotId: getLotIdFromUrl(),
            ...getBuyButtonDiagnosticFields(),
            visibleLotStatus: (() => {
                try {
                    return getLotStatusText();
                } catch (_) {
                    return "";
                }
            })()
        };
    }

    function markAuthRequired(trigger = "check") {
        lastAuthDiagnostics = collectAuthDiagnostics(trigger);
        diagnosticRecord("auth_required_detail", lastAuthDiagnostics);
        return lastAuthDiagnostics;
    }

    function isAuthRequired() {
        if (getRealAuthUrlReason()) {
            lastAuthDiagnostics = collectAuthDiagnostics("url_check");
            return true;
        }

        if (findAuthDialog()) {
            lastAuthDiagnostics = collectAuthDiagnostics("dialog_check");
            return true;
        }

        const authTexts = [
            "Войти или зарегистрироваться",
            "Войдите в систему",
            "Необходимо войти в систему",
            "Вход в личный кабинет",
            "Авторизация"
        ];
        const nodes = [...document.querySelectorAll("button, a, h1, h2, h3, p, div, span")];
        for (const text of authTexts) {
            const found = nodes.find(el => normalizeText(el.innerText) === text && isVisible(el));
            if (found) {
                lastAuthDiagnostics = collectAuthDiagnostics("text_check");
                return true;
            }
        }

        return false;
    }

    async function runLogic() {
        if (logicRunning) return;
        const logicStartedAt = performance.now();
        logicRunning = true;

        try {
            if (state === "DONE" || state === "READY_SELECT" || state === "AUTH_REQUIRED" || state === "AUTH_OR_BACKEND_GATE" || state === "WIN" || state === "LOSS") return;

            if (markOfferAlreadySignedLoss("run_logic_start")) {
                return;
            }

            if (getRealAuthUrlReason()) {
                const realAuthReason = getRealAuthUrlReason();
                log("Обнаружен реальный переход на авторизацию — автоматическое участие остановлено.");
                markAuthRequired("run_logic_auth_url");
                diagnosticRecord("real_auth_required", {
                    source: "run_logic_auth_url",
                    reason: realAuthReason,
                    url: location.href,
                    state
                });
                traceTestFlow("auth_required", collectDiagnosticPageSnapshot());
                recordAuthTerminalState("AUTH_REQUIRED", "real_auth_url", {
                    source: "run_logic_auth_url",
                    realAuthReason,
                    context: { url: location.href }
                });
                setState("AUTH_REQUIRED");
                stopAllTimers();
                return;
            }

            if (state !== "WAIT_CHECKBOX" && isAuthRequired()) {
                log("Обнаружен экран авторизации — сессия не активна. Автоматическое участие остановлено.");
                const authDetails = markAuthRequired("run_logic_start");
                traceTestFlow("auth_required", collectDiagnosticPageSnapshot());
                recordAuthTerminalState("AUTH_REQUIRED", "auth_dialog_outside_buy", {
                    source: "run_logic_start",
                    realAuthReason: authDetails?.urlReason || null,
                    context: { authDetails }
                });
                setState("AUTH_REQUIRED");
                stopAllTimers();
                return;
            }

            const signDialog = findOverlayByText("Подписание электронной подписью");
            const certDialog =
                findOverlayByText("Выберите сертификат для формирования подписи") ||
                findOverlayByText("Выберите сертификат");

            if (certDialog && state !== "WAIT_SELECT" && state !== "READY_SELECT" && state !== "DONE") {
                setState("WAIT_CERT");
            } else if (signDialog && state === "WAIT_SIGN_1") {
                setState("WAIT_SIGN_2");
            }

            if (state === "WAIT_BUY") {
                const buyBtn = findBuyButton(document);
                const buyButtonDiagnostics = getBuyButtonDiagnostics();

                const nowTs = Date.now();
                if (!buyBtn && nowTs - lastBuyCheckLogTs > 1500) {
                    if (buyButtonDiagnostics.presentDom) {
                        log("WAIT_BUY: кнопка 'Купить' есть в DOM, но пока не кликабельна:", buyButtonDiagnostics.primary?.notClickableReason || "unknown");
                        diagnosticRecord("buy_not_actionable", getCombatTimingPayload({
                            source: "wait_buy_run_logic",
                            reason: buyButtonDiagnostics.primary?.notClickableReason || "unknown",
                            buyButtonDiagnostics
                        }));
                    } else {
                        log("WAIT_BUY: кнопка 'Купить' пока не найдена");
                    }
                    lastBuyCheckLogTs = nowTs;
                }

                if (buyBtn) {
                    const stable = await findStableActionableBuyButton();
                    if (!stable.ok) {
                        diagnosticRecord("buy_not_actionable", getCombatTimingPayload({
                            source: "wait_buy_stability_check",
                            reason: stable.reason,
                            stableMs: BUY_ACTIONABILITY_STABLE_MS,
                            diagnostics: stable.diagnostics || getBuyButtonDiagnostics()
                        }));
                        return;
                    }

                    const actionableBuyBtn = stable.button;
                    lastBuyButtonFoundAt = Date.now();
                    const buyCandidateUrl = location.href;
                    const timingGuard = getBuyClickTimingGuard();
                    log("WAIT_BUY: кнопка 'Купить' кликабельна и стабильна, жду перед кликом", timingGuard.waitMs, "мс");
                    diagnosticRecord("buy_button_found_timing", getCombatTimingPayload({
                        source: "wait_buy_run_logic",
                        msSinceCombatWatchStarted: combatWatchStartedAt ? lastBuyButtonFoundAt - combatWatchStartedAt : null,
                        stableMs: BUY_ACTIONABILITY_STABLE_MS,
                        ...timingGuard,
                        buyButtonDiagnostics: getBuyButtonDiagnostics()
                    }));
                    traceTestFlow("buy_button_found", {
                        html: actionableBuyBtn.outerHTML ? actionableBuyBtn.outerHTML.slice(0, 1500) : ""
                    });

                    if (timingGuard.waitMs > 0) {
                        diagnosticRecord("buy_click_delay_started", getCombatTimingPayload({
                            source: "wait_buy_run_logic",
                            ...timingGuard,
                            msSinceBuyButtonFound: Date.now() - lastBuyButtonFoundAt,
                            msSinceCombatWatchStarted: combatWatchStartedAt ? Date.now() - combatWatchStartedAt : null,
                            html: actionableBuyBtn.outerHTML ? actionableBuyBtn.outerHTML.slice(0, 1500) : ""
                        }));
                        await delay(timingGuard.waitMs);
                    }

                    if (location.href !== buyCandidateUrl) {
                        diagnosticRecord("buy_click_delay_cancelled", getCombatTimingPayload({
                            source: "url_changed_before_buy_click",
                            ...timingGuard,
                            fromUrl: buyCandidateUrl,
                            currentUrl: location.href
                        }));
                        return;
                    }

                    if (getRealAuthUrlReason()) {
                        diagnosticRecord("buy_click_delay_cancelled", getCombatTimingPayload({
                            source: "real_auth_before_buy_click",
                            ...timingGuard,
                            reason: getRealAuthUrlReason()
                        }));
                        return;
                    }

                    const finalCheck = diagnoseCurrentBuyClickability("before_delayed_buy_click");
                    if (!finalCheck.ok) {
                        diagnosticRecord("buy_click_delay_cancelled", getCombatTimingPayload({
                            source: "button_not_actionable_after_delay",
                            ...timingGuard,
                            diagnostics: finalCheck.diagnostics || getBuyButtonDiagnostics(),
                            reason: finalCheck.diagnostics?.notClickableReason || "not_actionable_after_delay"
                        }));
                        return;
                    }

                    diagnosticRecord("buy_click_delay_finished", getCombatTimingPayload({
                        source: "wait_buy_run_logic",
                        ...timingGuard,
                        actualDelayMs: Date.now() - lastBuyButtonFoundAt,
                        msSinceBuyButtonFound: Date.now() - lastBuyButtonFoundAt,
                        msSinceCombatWatchStarted: combatWatchStartedAt ? Date.now() - combatWatchStartedAt : null,
                        buyButtonDiagnostics: getBuyButtonDiagnostics()
                    }));

                    log("WAIT_BUY: задержка перед 'Купить' завершена, нажимаю");
                    if (aggressiveClick(finalCheck.button, "Купить")) {
                        const buyClickAtMs = Date.now();
                        const buyClickUrl = location.href;
                        dbg("buy_click", { ok: true, delayUsedMs: timingGuard.waitMs });
                        // v5.7.1: верификатор клика — через 1500 мс проверим, что URL сменился (или статус стал SUSPENDED).
                        setTimeout(() => {
                            try {
                                const urlChanged = location.href !== buyClickUrl
                                    && location.href.indexOf("/private/e-contracts/") !== -1;
                                const apiStatus = diagnosticLastApiStatus;
                                const latencyMs = Date.now() - buyClickAtMs;
                                if (urlChanged || apiStatus === "APPLICATIONS_SUBMISSION_SUSPENDED") {
                                    dbg("buy_click_verified", {
                                        latencyMs,
                                        delayUsedMs: timingGuard.waitMs,
                                        urlChanged,
                                        apiStatus
                                    });
                                } else {
                                    const stillClickable = !!getBuyButtonDiagnostics()?.clickable;
                                    dbg("buy_click_no_response", {
                                        latencyMs,
                                        delayUsedMs: timingGuard.waitMs,
                                        urlChanged,
                                        apiStatus,
                                        buyButtonStillClickable: stillClickable
                                    });
                                }
                            } catch (e) { try { console.warn("[TorgiBot dbg verify]", e); } catch (_) {} }
                        }, 1500);
                        markBuyClicked(finalCheck.button);
                        setState("WAIT_CHECKBOX");
                        return;
                    }
                }
            }

            if (state === "WAIT_CHECKBOX") {
                if (markOfferAlreadySignedLoss("wait_checkbox")) {
                    return;
                }

                const authDialog = findAuthDialog();
                if (authDialog) {
                    const softInfo = getSoftAuthDialogInfo(authDialog);
                    if (softInfo.softDialog) {
                        if (softAuthDialogRetryScheduled) {
                            traceTestFlowThrottled("soft_auth_retry_already_scheduled", {
                                retryCount: softAuthDialogRetryCount,
                                retryMax: SOFT_AUTH_DIALOG_RETRY_MAX
                            }, 1000);
                            return;
                        }

                        diagnosticRecord("soft_auth_dialog_after_buy", getCombatTimingPayload({
                            retryCount: softAuthDialogRetryCount,
                            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                            dialogText: softInfo.dialogText,
                            html: authDialog.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
                            ...getBuyButtonDiagnosticFields()
                        }));

                        if (!softInfo.cancelButton) {
                            softAuthDialogRetryScheduled = true;
                            scheduleSoftAuthCancelWait({
                                authDialog,
                                softInfo,
                                waitCount: 0,
                                source: "soft_auth_after_buy",
                                onFound: () => {
                                    softAuthDialogRetryScheduled = false;
                                    if (state !== "WAIT_CHECKBOX") return;
                                    runLogic();
                                },
                                onLimit: () => {
                                    softAuthDialogRetryScheduled = false;
                                    if (state !== "WAIT_CHECKBOX") return;
                                    recordAuthTerminalState("AUTH_OR_BACKEND_GATE", "soft_dialog_cancel_button_not_found", {
                                        source: "soft_auth_cancel_not_found",
                                        realAuthReason: null,
                                        context: { softInfo }
                                    });
                                    setState("AUTH_OR_BACKEND_GATE");
                                    stopAutomationTimersKeepJournal("soft_auth_cancel_not_found");
                                    updateWidget();
                                }
                            });
                            return;
                        }

                        if (softAuthDialogRetryCount >= SOFT_AUTH_DIALOG_RETRY_MAX) {
                            log("Диалог входа после 'Купить' повторился", softAuthDialogRetryCount, "раз — останавливаю как AUTH_OR_BACKEND_GATE.");
                            diagnosticRecord("soft_auth_retry_limit_reached", getCombatTimingPayload({
                                retryCount: softAuthDialogRetryCount,
                                retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                                dialogText: softInfo.dialogText,
                                html: authDialog.outerHTML ? authDialog.outerHTML.slice(0, 2000) : "",
                                ...getBuyButtonDiagnosticFields()
                            }));
                            recordAuthTerminalState("AUTH_OR_BACKEND_GATE", "soft_dialog_retry_exhausted", {
                                source: "soft_auth_retry_limit_reached",
                                realAuthReason: null,
                                context: {
                                    retryCount: softAuthDialogRetryCount,
                                    retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                                    dialogText: softInfo.dialogText
                                }
                            });
                            setState("AUTH_OR_BACKEND_GATE");
                            stopAutomationTimersKeepJournal("soft_auth_retry_limit_reached");
                            updateWidget();
                            return;
                        }

                        softAuthDialogRetryCount += 1;
                        softAuthDialogRetryScheduled = true;
                        sessionStorage.setItem("torgiBotSoftAuthDialogRetryCount", String(softAuthDialogRetryCount));
                        log("Мягкий диалог входа после 'Купить' — закрываю и повторю попытку", softAuthDialogRetryCount, "из", SOFT_AUTH_DIALOG_RETRY_MAX);
                        aggressiveClick(softInfo.cancelButton, "Отменить (мягкий диалог входа)");
                        diagnosticRecord("soft_auth_dialog_closed", getCombatTimingPayload({
                            retryCount: softAuthDialogRetryCount,
                            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                            html: softInfo.cancelButton?.outerHTML ? softInfo.cancelButton.outerHTML.slice(0, 1000) : ""
                        }));
                        buyClickedAt = 0;
                        buyClickedUrl = "";
                        buyRecoveryCount = 0;
                        diagnosticRecord("soft_auth_retry_scheduled", getCombatTimingPayload({
                            retryCount: softAuthDialogRetryCount,
                            retryMax: SOFT_AUTH_DIALOG_RETRY_MAX,
                            delayMs: SOFT_AUTH_DIALOG_RETRY_DELAY_MS
                        }));
                        setTimeout(() => {
                            softAuthDialogRetryScheduled = false;
                            if (state !== "WAIT_CHECKBOX") return;
                            setState("WAIT_BUY");
                            runLogic();
                        }, SOFT_AUTH_DIALOG_RETRY_DELAY_MS);
                        return;
                    }

                    log("Диалог авторизации после клика 'Купить' классифицирован как реальная авторизация. Войдите в систему и нажмите F9 + F8.");
                    const authDetails = markAuthRequired("after_buy_dialog_real_auth");
                    diagnosticRecord("real_auth_required", {
                        source: "after_buy_dialog",
                        softInfo: {
                            publicLotUrl: softInfo.publicLotUrl,
                            realAuthReason: softInfo.realAuthReason,
                            hasCancelButton: !!softInfo.cancelButton,
                            dialogText: softInfo.dialogText
                        },
                        authDetails
                    });
                    traceTestFlow("auth_dialog_after_buy", {
                        authDetails,
                        html: authDialog.outerHTML ? authDialog.outerHTML.slice(0, 2000) : ""
                    });
                    recordAuthTerminalState("AUTH_REQUIRED", "after_buy_dialog_real_auth", {
                        source: "after_buy_dialog",
                        realAuthReason: softInfo.realAuthReason || authDetails?.urlReason || null,
                        context: {
                            authDetails,
                            softInfo: {
                                publicLotUrl: softInfo.publicLotUrl,
                                hasCancelButton: !!softInfo.cancelButton,
                                dialogText: softInfo.dialogText
                            }
                        }
                    });
                    setState("AUTH_REQUIRED");
                    stopAllTimers();
                    return;
                }

                const checkbox = findTargetCheckbox();
                if (!checkbox) {
                    if (!buyClickedAt) {
                        if (isPrivateContractViewUrl()) {
                            traceTestFlowThrottled("checkbox_wait_private_resume", {
                                currentUrl: location.href,
                                ...getBuyButtonDiagnosticFields()
                            }, 1000);
                            return;
                        }

                        traceTestFlow("wait_checkbox_without_buy_click", {
                            currentUrl: location.href,
                            ...getBuyButtonDiagnosticFields()
                        });
                        setState("WAIT_BUY");
                        return;
                    }

                    const msSinceClick = Date.now() - buyClickedAt;
                    const urlChanged = !!buyClickedUrl && location.href !== buyClickedUrl;
                    const onPrivateContract = isPrivateContractViewUrl();
                    const buyTransitionWaitMs = Number(settings?.buyTransitionWaitMs ?? 8000);
                    const buyRecoveryMaxCount = Math.max(0, Number(settings?.buyRecoveryMaxCount ?? 1));
                    const buyProcessingMaxWaitMs = Math.max(buyTransitionWaitMs, Number(settings?.buyProcessingMaxWaitMs ?? 120000));
                    if (msSinceClick > 1000) {
                        traceTestFlowThrottled("checkbox_wait", {
                            msSinceClick,
                            urlChanged,
                            onPrivateContract,
                            ...getBuyButtonDiagnosticFields()
                        });
                    }

                    if (buyClickedAt && msSinceClick <= buyTransitionWaitMs) {
                        traceTestFlowThrottled("buy_transition_wait", {
                            msSinceClick,
                            waitMs: buyTransitionWaitMs,
                            fromUrl: buyClickedUrl,
                            currentUrl: location.href,
                            urlChanged,
                            onPrivateContract
                        }, 1000);
                        return;
                    }

                    if (buyClickedAt && msSinceClick > buyTransitionWaitMs) {
                        const buyButtonDiagnostics = getBuyButtonDiagnostics();
                        const buyBtn = buyButtonDiagnostics.clickable ? findBuyButton(document) : null;
                        const buyButtonProcessing = !!buyButtonDiagnostics.primary?.spinner || isBuyButtonProcessing(buyBtn);
                        const processingHtml = buyBtn?.outerHTML || buyButtonDiagnostics.primary?.outerHTML || "";
                        traceTestFlow("buy_transition_timeout", {
                            msSinceClick,
                            waitMs: buyTransitionWaitMs,
                            fromUrl: buyClickedUrl,
                            currentUrl: location.href,
                            urlChanged,
                            onPrivateContract,
                            buyButtonPresentDom: buyButtonDiagnostics.presentDom,
                            buyButtonVisible: buyButtonDiagnostics.visible,
                            buyButtonClickable: buyButtonDiagnostics.clickable,
                            buyButtonDiagnostics,
                            buyButtonProcessing,
                            recoveryCount: buyRecoveryCount,
                            recoveryMaxCount: buyRecoveryMaxCount,
                            processingMaxWaitMs: buyProcessingMaxWaitMs
                        });

                        if (buyButtonDiagnostics.presentDom && buyButtonProcessing && !urlChanged && !onPrivateContract) {
                            traceTestFlowThrottled("buy_transition_processing_wait", {
                                msSinceClick,
                                processingMaxWaitMs: buyProcessingMaxWaitMs,
                                buyButtonDiagnostics,
                                html: processingHtml ? processingHtml.slice(0, 1500) : ""
                            }, 3000);

                            if (msSinceClick > buyProcessingMaxWaitMs) {
                                log("WAIT_CHECKBOX: кнопка 'Купить' слишком долго в обработке — повторы остановлены");
                                traceTestFlow("buy_transition_processing_timeout_stop", {
                                    msSinceClick,
                                    processingMaxWaitMs: buyProcessingMaxWaitMs,
                                    currentUrl: location.href,
                                    buyButtonDiagnostics,
                                    html: processingHtml ? processingHtml.slice(0, 1500) : ""
                                });
                                buyRecoveryCount = buyRecoveryMaxCount;
                            }
                        } else if (buyBtn && !urlChanged && !onPrivateContract && buyRecoveryCount < buyRecoveryMaxCount) {
                            buyRecoveryCount += 1;
                            log("WAIT_CHECKBOX: переход после 'Купить' не начался за", buyTransitionWaitMs, "мс — разрешаю один восстановительный повтор");
                            markBuyClicked(buyBtn);
                            aggressiveClick(buyBtn, "Купить (повтор после таймаута)");
                        } else if (buyBtn && !urlChanged && !onPrivateContract) {
                            log("WAIT_CHECKBOX: лимит восстановительных повторов исчерпан — больше не нажимаю 'Купить'");
                            traceTestFlowThrottled("buy_recovery_limit_reached", {
                                msSinceClick,
                                recoveryCount: buyRecoveryCount,
                                recoveryMaxCount: buyRecoveryMaxCount,
                                buyButtonProcessing,
                                html: buyBtn.outerHTML ? buyBtn.outerHTML.slice(0, 1500) : ""
                            }, 5000);
                        } else if (!onPrivateContract) {
                            log("WAIT_CHECKBOX: переход после 'Купить' завис без кнопки — перезагружаю страницу");
                            sessionStorage.setItem("torgiBotCombatReload", "1");
                            trackedReload("buy_transition_timeout", {
                                msSinceClick,
                                fromUrl: buyClickedUrl,
                                currentUrl: location.href,
                                urlChanged,
                                buyButtonPresentDom: buyButtonDiagnostics.presentDom,
                                buyButtonVisible: buyButtonDiagnostics.visible,
                                buyButtonClickable: buyButtonDiagnostics.clickable,
                                buyButtonDiagnostics
                            });
                        }
                    }
                    return;
                }

                if (!checkbox.checked) {
                    traceTestFlow("checkbox_found", {
                        checked: checkbox.checked,
                        html: checkbox.outerHTML ? checkbox.outerHTML.slice(0, 1200) : ""
                    });
                    clickCheckbox();
                    return;
                }

                resetBuyTransition("checkbox_ready");
                setState("WAIT_SIGN_1");
                return;
            }

            if (state === "WAIT_SIGN_1") {
                // v5.7.1: лок подписи СНЯТ с этой стадии — оферта подписывается параллельно во всех вкладках.
                // Лок захватывается только перед открытием выпадающего списка сертификатов (cadesplugin).
                const offerSignBtn = findButtonByText("Подписать", document);
                traceTestFlowThrottled("wait_sign_offer", { buttonPresent: !!offerSignBtn });
                if (!offerSignBtn) return;
                dbg("offer_sign_button_found");
                if (Date.now() - lastOfferSignClickAt < Number(settings?.offerSignClickCooldownMs ?? 500)) return;
                if (aggressiveClick(offerSignBtn, "Подписать (оферта)")) {
                    dbg("offer_sign_click");
                    lastOfferSignClickAt = Date.now();
                    return;
                }
            }

            if (state === "WAIT_SIGN_2") {
                const overlay = findOverlayByText("Подписание электронной подписью");
                if (!overlay) {
                    traceTestFlowThrottled("crypto_dialog_wait", {});
                    return;
                }
                dbg("crypto_dialog_seen");

                const signBtn = findButtonByText("Подписать", overlay);
                if (signBtn) {
                    traceTestFlow("crypto_dialog_found", {
                        html: overlay.outerHTML ? overlay.outerHTML.slice(0, 2000) : ""
                    });
                    if (Date.now() - lastCryptoSignClickAt < Number(settings?.cryptoSignClickCooldownMs ?? 500)) return;
                    if (aggressiveClick(signBtn, "Подписать (КриптоПро)")) {
                        dbg("crypto_sign_click");
                        lastCryptoSignClickAt = Date.now();
                        setState("WAIT_CERT");
                        return;
                    }
                }
            }

            if (state === "WAIT_CERT") {
                if (isCertificateSelected()) {
                    const selectedCertificate = getSelectedCertificateText();
                    traceTestFlow("certificate_selected", {
                        selectedCertificate: selectedCertificate.slice(0, 500)
                    });
                    dbg("cert_selected");
                    // v5.7.1: серт выбран, плагин свободен — отпускаем лок СРАЗУ, до клика «Выбрать».
                    releaseSignLock("cert_selected");
                    setState("WAIT_SELECT");
                    return;
                }

                const options = getVisibleCertificateOptions();
                if (!options.length) {
                    // v5.7.1: лок захватываем ровно перед попыткой открыть выпадающий список сертификатов.
                    // Это единственная фаза, где cadesplugin реально занят.
                    if (!signLockHeld) {
                        if (!(await acquireSignLock("WAIT_CERT"))) {
                            dbg("sign_lock_blocked", { stage: "WAIT_CERT" });
                            return;
                        }
                        dbg("sign_lock_held_at_cert");
                    }
                    if (Date.now() - lastCertDropdownClickAt >= Number(settings?.certDropdownClickCooldownMs ?? 200)) {
                        lastCertDropdownClickAt = Date.now();
                        tryOpenCertDropdown();
                        dbg("cert_dropdown_open_attempt");
                        log("Список сертификатов пока не появился, открываю дропдаун");
                    }
                    const certDiagnostics = collectCertificateDiagnostics();
                    if (certDiagnostics.dropdownTexts.length) {
                        traceTestFlowThrottled("cert_option_not_found", certDiagnostics, 1000);
                    } else {
                        traceTestFlowThrottled("cert_options_wait", certDiagnostics, 1000);
                    }
                    return;
                }

                log("Доступно сертификатов:", options.length);
                traceTestFlow("cert_options_found", {
                    count: options.length,
                    options: options.slice(0, 3).map(option => normalizeText(option.innerText || option.textContent).slice(0, 500))
                });
                dbg("cert_options_visible", { count: options.length });

                if (clickCertificate()) {
                    dbg("cert_click");
                    lastCertDropdownClickAt = Date.now();
                    return;
                }
            }

            if (state === "WAIT_SELECT") {
                dbg("select_stage_entered");
                if (settings?.stopBeforeFinalSelect !== false) {
                    log("Тестовый режим: кнопка 'Выбрать' не нажимается автоматически");
                    markBuyFlowFinished("стоп перед Выбрать");
                    traceTestFlow("test_stop_before_select", collectDiagnosticPageSnapshot());
                    dbg("select_test_stop");
                    playDoneSound();
                    setState("READY_SELECT");
                    releaseSignLock("test_stop_before_select");
                    return;
                }

                const overlay = getCertificateDialog() || getTopOverlay() || document;
                dbg("select_click_attempt");
                if (clickButtonByText("Выбрать", overlay, "Выбрать")) {
                    dbg("select_click_done");
                    finishBot();
                }
            }
        } catch (e) {
            log("Ошибка runLogic:", e);
        } finally {
            const elapsed = performance.now() - logicStartedAt;
            if (elapsed > 500) {
                diagnosticRecord("slow_run_logic", {
                    elapsedMs: Math.round(elapsed),
                    state
                });
            }
            logicRunning = false;
        }
    }

    function scheduleRunLogic(delay = 120) {
        if (observerRunTimer) return;
        observerRunTimer = setTimeout(() => {
            observerRunTimer = null;
            runLogic();
        }, delay);
    }

    function startObserverLoop(isCombat = false) {
        if (mutationObserver) {
            mutationObserver.disconnect();
        }

        if (observerRunTimer) {
            clearTimeout(observerRunTimer);
            observerRunTimer = null;
        }

        mutationObserver = new MutationObserver(() => {
            scheduleRunLogic(isCombat ? 80 : 150);
        });

        mutationObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        if (logicTimer) clearInterval(logicTimer);

        if (isCombat) {
            logicTimer = setInterval(runLogic, Number(settings?.combatLogicInterval ?? 160));

            let burstCount = 0;
            const burst = setInterval(() => {
                runLogic();
                burstCount += 1;
                if (burstCount > 75 || state !== "WAIT_BUY") {
                    clearInterval(burst);
                }
            }, Number(settings?.combatBurstInterval ?? 80));
        } else {
            logicTimer = setInterval(runLogic, Number(settings?.logicInterval ?? 200));
        }
    }

    function startEnableHeartbeat() {
        if (enableTimer) clearInterval(enableTimer);

        enableTimer = setInterval(async () => {
            const alive = await isExtensionAlive();
            if (!alive) {
                log("Контекст расширения недействителен. Перезагрузите страницу.");
                stopAllTimers();
                return;
            }

            await loadSettings();

            if (!settings?.botEnabled) {
                log("Бот выключен во время работы");
                stopAllTimers();
                lastTimingInfo = { enabled: false, ok: false };
                updateWidget();
            }
        }, Number(settings?.enableHeartbeatInterval ?? 1000));
    }

    async function handlePreCombatMode() {
        const timing = await getTimingInfo(true);
        lastTimingInfo = timing;
        updateWidget();

        if (!timing.ok) {
            const idleRetryInterval = Number(settings?.idleRetryInterval ?? 30000);
            log("Не удалось определить тайминг:", timing.reason, "=> включаю автоматический API-watchdog и перепроверку через", idleRetryInterval, "мс");
            startCombatPoll();
            startObserverLoop(false);
            schedulePrecombatCheck(idleRetryInterval);
            return false;
        }

        if (timing.forceActive) {
            log("Лот уже активен: найден статус 'Прием заявок' или кнопка 'Купить'");
            return true;
        }

        log("Старт лота:", formatDateMoscow(timing.start));
        log("Текущее время:", formatDateMoscow(timing.now));
        log("До боевого режима мс:", timing.msToCombat);

        if (!timing.isCombat) {
            const delay = timing.msToCombat <= 15000
                ? Math.max(timing.msToCombat, 50)
                : Math.min(timing.msToCombat - 15000, 60000);
            log("Пока рано. Следующая проверка через мс:", delay);
            schedulePrecombatCheck(delay);
            schedulePreStartSessionRefresh(timing);
            return false;
        }

        if (timing.msToStart > 0) {
            diagnosticRecord("combat_prestart_buy_dom_wait", {
                msToStart: timing.msToStart,
                activeLotReason: timing.activeLotReason || null,
                buyDomBeforeStart: !!timing.buyDomBeforeStart,
                ...getBuyButtonDiagnosticFields()
            });
            startCombatPoll();
            return false;
        }

        if (reloadAtStartTimeIfNeeded(timing, "handle_precombat_start_time")) {
            return false;
        }

        if (!isBuyButtonPresentDom()) {
            log("Боевой режим активен, кнопки «Купить» нет — запускаю мониторинг без перезагрузки");
            startCombatPoll();
            return false;
        }

        return true;
    }

    async function startBot() {
        if (started) return;
        started = true;
        pageReadyAt = Date.now();
        activeStatusFirstSeenAt = 0;
        activeStatusReloadStarted = false;

        ensureWidget();
        updateWidget();

        const alive = await isExtensionAlive();
        if (!alive) {
            log("Расширение недоступно. Откройте страницу заново после перезагрузки расширения.");
            return;
        }

        await loadSettings();
        updateWidget();

        const navigationType = performance.getEntriesByType?.("navigation")?.[0]?.type || null;
        const hadDiagnosticReloadPending = sessionStorage.getItem("torgiBotDiagnosticReloadPending") !== null;
        const hadPreStartRefresh = sessionStorage.getItem("torgiBotPreStartRefresh") === "1";
        const hadCombatReload = sessionStorage.getItem("torgiBotCombatReload") === "1";

        if (hadDiagnosticReloadPending) {
            const startedAt = Number(sessionStorage.getItem("torgiBotDiagnosticReloadPending") || 0);
            sessionStorage.removeItem("torgiBotDiagnosticReloadPending");
            diagnosticRecord("reload_test_after", {
                elapsedMs: startedAt ? Date.now() - startedAt : null,
                authRequired: isAuthRequired(),
                ...getBuyButtonDiagnosticFields(),
                lotId: getLotIdFromUrl(),
                lastReload: (() => {
                    try {
                        return JSON.parse(sessionStorage.getItem("torgiBotLastTrackedReload") || "null");
                    } catch (_) {
                        return null;
                    }
                })(),
                navigation: navigationType
            });
        }

        if (hadPreStartRefresh) {
            sessionStorage.removeItem("torgiBotPreStartRefresh");
            diagnosticRecord("prestart_refresh_after", {
                authRequired: isAuthRequired(),
                ...getBuyButtonDiagnosticFields(),
                lotId: getLotIdFromUrl(),
                lastReload: (() => {
                    try {
                        return JSON.parse(sessionStorage.getItem("torgiBotLastTrackedReload") || "null");
                    } catch (_) {
                        return null;
                    }
                })()
            });
        }

        if (diagnosticActive) {
            if (navigationType === "reload" && !hadDiagnosticReloadPending && !hadPreStartRefresh && !hadCombatReload) {
                diagnosticRecord("page_reload_detected", {
                    source: "manual_or_browser_reload",
                    authRequired: isAuthRequired(),
                    ...getBuyButtonDiagnosticFields(),
                    lotId: getLotIdFromUrl(),
                    lastReload: (() => {
                        try {
                            return JSON.parse(sessionStorage.getItem("torgiBotLastTrackedReload") || "null");
                        } catch (_) {
                            return null;
                        }
                    })()
                });
            }
            startDiagnosticMonitor("resume");
            if (!settings?.botEnabled) {
                startWidgetLoop();
                return;
            }
        }

        if (!settings?.botEnabled) {
            log("Бот выключен");
            startWidgetLoop();
            return;
        }

        const isCombatReload = hadCombatReload;
        sessionStorage.removeItem("torgiBotCombatReload");

        if (isCombatReload) {
            log("Пост-боевая перезагрузка — пропускаем синхронизацию времени, сразу в бой");
            resetIfLotChanged();
            startWidgetLoop();
            startEnableHeartbeat();
            const lastReload = (() => {
                try {
                    return JSON.parse(sessionStorage.getItem("torgiBotLastTrackedReload") || "null");
                } catch (_) {
                    return null;
                }
            })();

            if (handlePostReloadAuthDialog(lastReload)) {
                return;
            }

            if (isBuyButtonPresentDom()) {
                lastBuyButtonFoundAt = Date.now();
                diagnosticRecord("post_reload_buy_found", getCombatTimingPayload({
                    lastReload,
                    elapsedSinceReloadMs: lastReload?.ts ? Date.now() - new Date(lastReload.ts).getTime() : null
                }));
                log("Кнопка «Купить» найдена сразу после перезагрузки");
                runLogic();
                startObserverLoop(true);
            } else {
                diagnosticRecord("post_reload_buy_not_found", getCombatTimingPayload({
                    lastReload,
                    elapsedSinceReloadMs: lastReload?.ts ? Date.now() - new Date(lastReload.ts).getTime() : null
                }));
                startCombatPoll();
                startObserverLoop(true);
            }
            syncTimeFromTorgiApi().catch(() => {});
            return;
        }

        const torgiSynced = await syncTimeFromTorgiApi();
        if (!torgiSynced) await syncMoscowTime();

        resetIfLotChanged();
        startWidgetLoop();
        startEnableHeartbeat();

        if (state === "WAIT_BUY") {
            const ready = await handlePreCombatMode();
            if (!ready) {
                startLateBuyWatcher();
                return;
            }
        }

        log("Запускаю сценарий кликов");
        runLogic();
        startObserverLoop(true);
    }

    let lateBuyWatcher = null;

    function startLateBuyWatcher() {
        if (lateBuyWatcher) lateBuyWatcher.disconnect();

        let checking = false;

        lateBuyWatcher = new MutationObserver(async () => {
            if (checking) return;
            checking = true;

            try {
                const timing = await getTimingInfo(true);

                if (!timing.ok && !timing.forceActive) {
                    checking = false;
                    return;
                }

                log("Позднее обнаружение: лот активен или время найдено — запускаю сценарий");
                lateBuyWatcher.disconnect();
                lateBuyWatcher = null;

                if (reloadTimer) {
                    clearTimeout(reloadTimer);
                    reloadTimer = null;
                    log("Отменил запланированную проверку тайминга");
                }
                if (combatPollTimer) {
                    clearInterval(combatPollTimer);
                    combatPollTimer = null;
                    log("Отменил боевой опрос (обнаружено через MutationObserver)");
                }

                lastTimingInfo = timing;
                updateWidget();

                if (timing.isCombat || timing.forceActive) {
                    log("Запускаю сценарий кликов из позднего наблюдателя");
                    runLogic();
                    startObserverLoop(true);
                } else {
                    log("Тайминг найден, до боевого режима:", timing.msToCombat, "мс — жду таймер");
                    const ready = await handlePreCombatMode();
                    if (ready) {
                        log("Запускаю сценарий кликов после повторной проверки тайминга");
                        runLogic();
                        startObserverLoop(true);
                    }
                    // schedulePrecombatCheck уже поставил таймер; он сам перезапустит
                    // lateBuyWatcher через нужный интервал — не стартуем здесь повторно
                }
            } catch (e) {
                log("Ошибка в позднем наблюдателе:", e);
                checking = false;
            }
        });

        lateBuyWatcher.observe(document.documentElement, {
            childList: true,
            subtree: true
        });

        log("Запущен наблюдатель за появлением кнопки 'Купить' (Angular ещё грузится)");
    }

    async function stopBot() {
        stopAllTimers();
        if (lateBuyWatcher) {
            lateBuyWatcher.disconnect();
            lateBuyWatcher = null;
        }
        updateWidget();
        log("Бот остановлен");
    }

    async function restartBotInPlace() {
        stopAllTimers();
        if (lateBuyWatcher) {
            lateBuyWatcher.disconnect();
            lateBuyWatcher = null;
        }
        started = false;
        buyClickedAt = 0;
        buyClickedUrl = "";
        buyRecoveryCount = 0;
        softAuthDialogRetryCount = 0;
        postReloadSoftAuthRetryCount = 0;
        softAuthDialogRetryScheduled = false;
        sessionStorage.removeItem("torgiBotSoftAuthDialogRetryCount");
        sessionStorage.removeItem("torgiBotPostReloadSoftAuthRetryCount");
        clearAuthStateMeta();
        buyFlowStartedAt = 0;
        lastBuyButtonFoundAt = 0;
        combatWatchStartedAt = 0;
        combatStartReachedLogged = false;
        lastBuyFlowDurationMs = null;
        lastBuyFlowDurationLabel = "";
        log("Перезапуск бота без перезагрузки страницы");
        await startBot();
    }

    async function toggleBot() {
        const current = settings || await loadSettings();
        const newValue = !current.botEnabled;

        const res = await setTabSettings({ botEnabled: newValue });

        if (res?.ok) {
            settings = res.settings;
            log("Бот", newValue ? "включён" : "выключен");
            if (newValue) {
                await restartBotInPlace();
            } else {
                await stopBot();
            }
        } else {
            log("Не удалось переключить бота:", res?.error || res?.runtimeError);
        }
    }

    async function toggleTestMode() {
        const current = settings || await loadSettings();
        const newValue = !(current.stopBeforeFinalSelect !== false);

        const res = await setTabSettings({ stopBeforeFinalSelect: newValue });

        if (res?.ok) {
            settings = res.settings;
            log("Режим изменён:", newValue ? "ТЕСТ (не нажимает «Выбрать»)" : "БОЕВОЙ (нажимает «Выбрать»)");
            updateWidget();
        } else {
            log("Не удалось изменить режим:", res?.error || res?.runtimeError);
        }
    }

    async function forceTimeSync() {
        const ok = (await syncTimeFromTorgiApi()) || (await syncMoscowTime());
        updateWidget();
        log(ok ? "Время синхронизировано" : "Синхронизация времени не удалась");
    }

    function resetStateManually() {
        sessionStorage.setItem("torgiBotState", "WAIT_BUY");
        state = "WAIT_BUY";
        buyClickedAt = 0;
        buyClickedUrl = "";
        buyRecoveryCount = 0;
        softAuthDialogRetryCount = 0;
        postReloadSoftAuthRetryCount = 0;
        softAuthDialogRetryScheduled = false;
        sessionStorage.removeItem("torgiBotSoftAuthDialogRetryCount");
        sessionStorage.removeItem("torgiBotPostReloadSoftAuthRetryCount");
        clearAuthStateMeta();
        buyFlowStartedAt = 0;
        lastBuyButtonFoundAt = 0;
        combatWatchStartedAt = 0;
        combatStartReachedLogged = false;
        lastBuyFlowDurationMs = null;
        lastBuyFlowDurationLabel = "";
        log("Состояние вручную сброшено");
        updateWidget();
    }

    async function copyDiagnosticReportFromWidget() {
        diagnosticRecord("report_copy_requested", {
            lotId: getLotIdFromUrl(),
            apiStatus: diagnosticLastApiStatus,
            state
        });
        const report = buildDiagnosticReport();
        sessionStorage.setItem("torgiBotLastDiagnosticReport", report);
        window.__torgiBotLastDiagnosticReport = report;

        let copied = false;
        try {
            await navigator.clipboard.writeText(report);
            copied = true;
        } catch (_) {
            copied = copyTextFallback(report);
        }

        if (copied) {
            lastReportCopyStatus = `Отчёт скопирован: ${new Date().toLocaleTimeString("ru-RU")}`;
        } else {
            console.log("[TorgiBot DIAG REPORT]", report);
            lastReportCopyStatus = "Не скопировано. Отчёт сохранён в sessionStorage и консоль";
        }
        diagnosticRecord("report_copy", { ok: copied });
        updateWidget();
    }

    async function toggleWidgetMode() {
        const current = settings || await loadSettings();
        const nextTestMode = current.stopBeforeFinalSelect === false;

        const res = await setTabSettings({ stopBeforeFinalSelect: nextTestMode });

        if (!res?.ok) {
            lastReportCopyStatus = "Не удалось переключить режим";
            log("Не удалось переключить режим:", res?.error || res?.runtimeError);
            updateWidget();
            return;
        }

        settings = res.settings;

        if (nextTestMode) {
            if (!diagnosticActive) startDiagnosticMonitor("widget_test_2in1");
            diagnosticRecord("test_2in1_mode", {
                note: "Тест 2-в-1 включён: бот останавливается перед «Выбрать», отчёт доступен в виджете."
            });
            lastReportCopyStatus = "Тест 2-в-1";
        } else {
            lastReportCopyStatus = "Боевой режим";
        }

        updateWidget();
    }

    async function toggleLotPriority() {
        const current = settings || await loadSettings();
        const currentPriority = current?.lotPriority == null
            ? null
            : Math.max(1, Math.min(5, Number(current.lotPriority)));
        const requestedPriority = currentPriority == null
            ? 1
            : (currentPriority >= 5 ? null : currentPriority + 1);
        const res = await setTabSettings({ lotPriority: requestedPriority });

        if (!res?.ok) {
            lastReportCopyStatus = "Не удалось сменить приоритет";
            updateWidget();
            return;
        }

        settings = res.settings;
        const assigned = settings?.lotPriority == null
            ? null
            : Math.max(1, Math.min(5, Number(settings.lotPriority)));
        if (requestedPriority == null) {
            lastReportCopyStatus = "Приоритет отключён";
        } else if (assigned == null) {
            lastReportCopyStatus = `P${requestedPriority} занят, свободных P нет`;
        } else if (assigned !== requestedPriority) {
            lastReportCopyStatus = `P${requestedPriority} занят, назначен P${assigned}`;
        } else {
            lastReportCopyStatus = `Приоритет P${assigned}`;
        }
        diagnosticRecord("priority_changed", {
            requestedPriority,
            assignedPriority: assigned
        });
        updateWidget();
    }

    try {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            (async () => {
                if (message?.type === "PING") {
                    sendResponse({ ok: true, state, botEnabled: !!settings?.botEnabled });
                    return;
                }

                if (message?.type === "QUERY_BUY_BUTTON") {
                    sendResponse({ ok: true, present: isBuyButtonPresentDom() });
                    return;
                }


                if (message?.type === "DIAGNOSTIC_START") {
                    await loadSettings();
                    startDiagnosticMode("popup");
                    sendResponse({ ok: true, active: diagnosticActive });
                    return;
                }

                if (message?.type === "DIAGNOSTIC_TOGGLE") {
                    await loadSettings();
                    toggleJournalMode();
                    sendResponse({ ok: true, active: diagnosticActive });
                    return;
                }

                if (message?.type === "DIAGNOSTIC_STOP") {
                    stopDiagnosticMode("popup");
                    sendResponse({ ok: true, active: diagnosticActive });
                    return;
                }

                if (message?.type === "DIAGNOSTIC_CLEAR") {
                    clearDiagnosticLog();
                    sendResponse({ ok: true });
                    return;
                }

                if (message?.type === "DIAGNOSTIC_RELOAD_TEST") {
                    sendResponse({ ok: true, reloading: true });
                    runDiagnosticReloadTest();
                    return;
                }

                if (message?.type === "DIAGNOSTIC_GET_REPORT") {
                    sendResponse({
                        ok: true,
                        active: diagnosticActive,
                        report: buildDiagnosticReport()
                    });
                    return;
                }

                if (message?.type === "TAB_SETTINGS_CHANGED") {
                    const previousEnabled = !!settings?.botEnabled;
                    settings = message.settings || settings;
                    updateWidget();

                    if (!!settings?.botEnabled && !previousEnabled) {
                        restartBotInPlace().catch(err => log("Ошибка restartBotInPlace:", err));
                    } else if (!settings?.botEnabled && previousEnabled) {
                        stopBot().catch(err => log("Ошибка stopBot:", err));
                    }

                    sendResponse({ ok: true });
                    return;
                }
            })().catch(error => {
                sendResponse({ ok: false, error: String(error) });
            });

            return true;
        });
    } catch (_) {}

    window.addEventListener("keydown", async (e) => {
        if (e.repeat) return;

        if (e.key === "F8") {
            e.preventDefault();
            await toggleBot();
        }

        if (e.key === "F9") {
            e.preventDefault();
            resetStateManually();
        }

        if (e.key === "F10") {
            e.preventDefault();
            await forceTimeSync();
        }

        if (e.key === "F11") {
            e.preventDefault();
            await toggleTestMode();
        }
    }, true);

    try {
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== "local" || !("botEnabled" in changes)) return;
            const enabled = changes.botEnabled.newValue;
            if (enabled) {
                restartBotInPlace().catch(err => log("Ошибка restartBotInPlace:", err));
            } else {
                stopBot().catch(err => log("Ошибка stopBot:", err));
            }
        });
    } catch (_) {}

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => {
            startBot().catch(err => log("Ошибка startBot:", err));
        });
    } else {
        startBot().catch(err => log("Ошибка startBot:", err));
    }
})();
