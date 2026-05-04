const MOSCOW_OFFSET_HOURS = 3;

function toLocalDatetimeValue(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "";
    const msk = new Date(d.getTime() + MOSCOW_OFFSET_HOURS * 3600 * 1000);
    return msk.toISOString().slice(0, 19);
}

function fromLocalDatetimeValueToIso(value) {
    if (!value) return null;
    const localMs = new Date(value + "Z").getTime() - MOSCOW_OFFSET_HOURS * 3600 * 1000;
    if (Number.isNaN(localMs)) return null;
    return new Date(localMs).toISOString();
}

function formatDateMoscow(isoString) {
    if (!isoString) return "—";
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat("ru-RU", {
        timeZone: "Europe/Moscow",
        year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(d);
}

function showMessage(text, type) {
    const el = document.getElementById("message");
    el.textContent = text;
    el.className = type;
    setTimeout(() => { el.className = ""; el.textContent = ""; }, 2500);
}

async function loadSettings() {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "GET_ACTIVE_TAB_SETTINGS" }, res => {
            if (chrome.runtime.lastError || !res?.ok) {
                resolve(null);
            } else {
                resolve(res.settings);
            }
        });
    });
}

async function saveSettings(payload) {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "SET_ACTIVE_TAB_SETTINGS", payload }, res => {
            if (chrome.runtime.lastError || !res?.ok) {
                resolve(null);
            } else {
                resolve(res.settings);
            }
        });
    });
}

async function sendActiveTabMessage(message) {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            const tab = tabs?.[0];
            if (!tab?.id) {
                resolve({ ok: false, error: "Активная вкладка не найдена" });
                return;
            }

            chrome.tabs.sendMessage(tab.id, message, res => {
                if (chrome.runtime.lastError) {
                    resolve({ ok: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(res || { ok: false });
                }
            });
        });
    });
}

async function render() {
    const settings = await loadSettings();
    if (!settings) {
        showMessage("Не удалось загрузить настройки", "error");
        return;
    }

    const badge = document.getElementById("status-badge");
    const toggleBtn = document.getElementById("toggle-btn");
    const widgetToggleBtn = document.getElementById("widget-toggle-btn");
    const widgetToggleHint = document.getElementById("widget-toggle-hint");
    const input = document.getElementById("start-time-input");
    const manualBox = document.getElementById("manual-active-box");
    const manualText = document.getElementById("manual-active-text");
    const hintOverride = document.getElementById("hint-override");
    const buyDelaySelect = document.getElementById("buy-delay-select");
    const pageAgeSelect = document.getElementById("page-age-select");

    if (settings.botEnabled) {
        badge.textContent = "Включён";
        badge.className = "badge badge-on";
        toggleBtn.textContent = "Выключить бота";
        toggleBtn.className = "toggle-btn on";
        widgetToggleBtn.textContent = "Виджет нужен в работе";
        widgetToggleBtn.disabled = true;
        widgetToggleHint.textContent = "Во время ожидания или работы бота виджет остаётся на странице.";
    } else {
        badge.textContent = "Выключен";
        badge.className = "badge badge-off";
        toggleBtn.textContent = "Включить бота";
        toggleBtn.className = "toggle-btn off";
        widgetToggleBtn.textContent = settings.widgetHidden ? "Показать виджет" : "Скрыть виджет";
        widgetToggleBtn.disabled = false;
        widgetToggleHint.textContent = settings.widgetHidden
            ? "Виджет скрыт на этой вкладке, пока бот выключен."
            : "Можно убрать виджет, если он мешает обычному просмотру torgi.gov.ru.";
    }

    if (settings.manualStartTime) {
        input.value = toLocalDatetimeValue(settings.manualStartTime);
        manualBox.style.display = "flex";
        manualText.textContent = "Задано: " + formatDateMoscow(settings.manualStartTime);
        hintOverride.style.display = "block";
    } else {
        input.value = "";
        manualBox.style.display = "none";
        hintOverride.style.display = "none";
    }

    document.getElementById("val-pre").textContent = settings.preStartSeconds ?? "—";
    document.getElementById("val-reload").textContent = settings.reloadInterval ?? "—";
    document.getElementById("val-buy-delay").textContent = `${settings.buyClickDelayMs ?? 500} мс`;
    document.getElementById("val-page-age").textContent = `${settings.minPageAgeBeforeBuyClickMs ?? 500} мс`;
    document.getElementById("val-session-refresh").textContent =
        settings.preStartSessionRefreshEnabled
            ? `раз в ${Math.round((settings.preStartSessionRefreshInterval ?? 60000) / 1000)}с, стоп за ${Math.round((settings.preStartSessionRefreshStopBefore ?? 30000) / 1000)}с`
            : "Выкл";
    document.getElementById("val-test").textContent =
        settings.stopBeforeFinalSelect ? "Вкл (не жмёт «Выбрать»)" : "Выкл";

    if (buyDelaySelect) buyDelaySelect.value = String(settings.buyClickDelayMs ?? 500);
    if (pageAgeSelect) pageAgeSelect.value = String(settings.minPageAgeBeforeBuyClickMs ?? 500);
}

document.getElementById("toggle-btn").addEventListener("click", async () => {
    const settings = await loadSettings();
    if (!settings) return;
    const newValue = !settings.botEnabled;
    const res = await saveSettings({ botEnabled: newValue });
    if (res) {
        await render();
        showMessage(newValue ? "Бот включён" : "Бот выключен", "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("widget-toggle-btn").addEventListener("click", async () => {
    const settings = await loadSettings();
    if (!settings) return;
    if (settings.botEnabled) {
        showMessage("Во время работы бот держит виджет включённым", "error");
        return;
    }

    const nextHidden = !settings.widgetHidden;
    const res = await saveSettings({ widgetHidden: nextHidden });
    if (res) {
        await render();
        showMessage(nextHidden ? "Виджет скрыт" : "Виджет показан", "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("save-time-btn").addEventListener("click", async () => {
    const value = document.getElementById("start-time-input").value;
    if (!value) {
        showMessage("Введите дату и время", "error");
        return;
    }
    const iso = fromLocalDatetimeValueToIso(value);
    if (!iso) {
        showMessage("Неверный формат даты", "error");
        return;
    }
    const res = await saveSettings({ manualStartTime: iso });
    if (res) {
        await render();
        showMessage("Время сохранено: " + formatDateMoscow(iso), "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("clear-time-btn").addEventListener("click", async () => {
    const res = await saveSettings({ manualStartTime: null });
    if (res) {
        await render();
        showMessage("Ручное время очищено", "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("buy-delay-select").addEventListener("change", async (event) => {
    const value = Number(event.target.value);
    const res = await saveSettings({ buyClickDelayMs: value });
    if (res) {
        await render();
        showMessage(`Пауза перед Купить: ${value} мс`, "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("page-age-select").addEventListener("change", async (event) => {
    const value = Number(event.target.value);
    const res = await saveSettings({ minPageAgeBeforeBuyClickMs: value });
    if (res) {
        await render();
        showMessage(`Возраст страницы: ${value} мс`, "ok");
    } else {
        showMessage("Ошибка сохранения", "error");
    }
});

document.getElementById("diag-toggle-btn").addEventListener("click", async () => {
    const res = await sendActiveTabMessage({ type: "DIAGNOSTIC_TOGGLE" });
    if (!res?.ok) {
        showMessage("Откройте страницу лота torgi.gov.ru", "error");
        return;
    }
    showMessage(res.active ? "Журнал включён" : "Журнал выключен", "ok");
});

document.getElementById("diag-reload-btn").addEventListener("click", async () => {
    const res = await sendActiveTabMessage({ type: "DIAGNOSTIC_RELOAD_TEST" });
    showMessage(res?.ok ? "Тестовая перезагрузка запущена" : "Не удалось запустить reload", res?.ok ? "ok" : "error");
});

document.getElementById("diag-copy-btn").addEventListener("click", async () => {
    const res = await sendActiveTabMessage({ type: "DIAGNOSTIC_GET_REPORT" });
    if (!res?.ok || !res.report) {
        showMessage("Не удалось получить отчёт", "error");
        return;
    }

    try {
        await navigator.clipboard.writeText(res.report);
        showMessage("Отчёт скопирован", "ok");
    } catch (e) {
        console.log(res.report);
        showMessage("Отчёт выведен в консоль popup", "error");
    }
});

document.getElementById("diag-clear-btn").addEventListener("click", async () => {
    const res = await sendActiveTabMessage({ type: "DIAGNOSTIC_CLEAR" });
    showMessage(res?.ok ? "Журнал очищен" : "Не удалось очистить", res?.ok ? "ok" : "error");
});

render();
