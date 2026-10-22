"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { translateWithCode } from "@/lib/i18n/rich-text";
import type { TranslationParams } from "@/lib/i18n/types";
import type { WebAccessStatus } from "@/lib/api-types";
import styles from "./SettingsConfig.module.css";

/**
 * The password lock, from the settings dialog.
 *
 * omp-web can drive a high-privilege agent, so the panel is deliberately blunt
 * about what the lock does and does not protect: it authenticates, it does not
 * encrypt, and the password itself is never readable back — which is why the
 * recovery paths are spelled out here rather than left to the documentation.
 */

type AccessAction = "set-password" | "enable" | "disable" | "clear";

type Translate = (key: string, params?: TranslationParams) => string;

/** Error body shared by both web-access routes: `error` is the original text, `code` the stable one. */
interface AccessErrorBody {
  error?: string;
  code?: string;
  /** Credential file path, sent with the `credentialUnreadable` code. */
  file?: string;
  /** Password length limit, sent with the `passwordTooShort`/`passwordTooLong` codes. */
  count?: number;
  /** Attempts left, sent with the `invalidCode` code. */
  remainingAttempts?: number;
}

const MIN_PASSWORD_LENGTH = 8;

function describeState(status: WebAccessStatus, t: Translate): string {
  if (status.managedByEnvironment) {
    return t("access.stateEnv");
  }
  if (status.unreadable) {
    return t("access.stateUnreadable");
  }
  if (!status.configured) return t("access.stateNone");
  return status.enabled
    ? t("access.stateEnabled")
    : t("access.stateDisabled");
}

/**
 * Translate a server error by its stable code, falling back to the English text.
 * @param body parsed error response
 * @param status HTTP status, used when the body carries no text
 * @param t translation function of the active locale
 * @returns localized message, or the server's original text for unknown codes
 */
function describeServerError(body: AccessErrorBody, status: number, t: Translate): string {
  const fallback = body.error ?? `HTTP ${status}`;
  if (!body.code) return fallback;
  const key = `access.error.${body.code}`;
  const count = body.remainingAttempts ?? body.count;
  const params: TranslationParams = {};
  if (body.file) params.file = body.file;
  if (count !== undefined) params.count = count;
  const translated = t(key, params);
  return translated === key ? fallback : translated;
}

export function AccessConfig() {
  const { t, locale } = useI18n();
  const [status, setStatus] = useState<WebAccessStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/web-access", { cache: "no-store" });
      const data = await response.json() as WebAccessStatus & AccessErrorBody;
      if (!response.ok || data.error) throw new Error(describeServerError(data, response.status, t));
      setStatus(data);
      setLoadError(null);
    } catch (caught) {
      setLoadError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [t]);

  useEffect(() => { void load(); }, [load]);

  const send = useCallback(async (action: AccessAction, body: { password?: string } = {}) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/web-access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...body }),
      });
      const data = await response.json() as WebAccessStatus & AccessErrorBody;
      if (!response.ok || data.error) throw new Error(describeServerError(data, response.status, t));
      setStatus(data);
      return data;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return null;
    } finally {
      setBusy(false);
    }
  }, [t]);

  const savePassword = useCallback(async () => {
    if (password !== confirmation) {
      setError(t("common.passwordsDoNotMatch"));
      return;
    }
    const updated = await send("set-password", { password });
    if (!updated) return;
    setPassword("");
    setConfirmation("");
    setNotice(t("access.noticeSaved", { username: updated.username }));
  }, [confirmation, password, send, t]);

  const toggleEnabled = useCallback(async () => {
    if (!status) return;
    const updated = await send(status.enabled ? "disable" : "enable");
    if (!updated) return;
    setNotice(updated.enabled
      ? t("access.noticeEnabled", { username: updated.username })
      : t("access.noticeDisabled"));
  }, [send, status, t]);

  const clearPassword = useCallback(async () => {
    const updated = await send("clear");
    if (!updated) return;
    setNotice(t("access.noticeCleared"));
  }, [send, t]);

  if (!status) {
    return <div className={styles.empty}>{loadError ?? t("access.loading")}</div>;
  }

  const readOnly = status.managedByEnvironment;
  const canSave = !busy && !readOnly && password.length >= MIN_PASSWORD_LENGTH && password === confirmation;

  return (
    <div className={styles.scrollContent}>
      <header className={styles.contentHeader}>
        <h2 className={styles.contentTitle}>{t("access.title")}</h2>
        <p className={styles.contentDescription}>
          {translateWithCode(t, "access.description", {}, { username: status.username, file: status.file })}
        </p>
        {readOnly && (
          <div className={styles.readOnlyNotice}>
            {translateWithCode(t, "access.readOnlyNotice", {}, { variable: "OMP_WEB_PASSWORD" })}
          </div>
        )}
        {notice && (
          <div className={styles.reloadNotice}><span>{notice}</span></div>
        )}
      </header>

      <div className={styles.settingsBody}>
        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("access.passwordAccess")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("access.requirePassword")}</div>
              <div className={styles.settingDescription}>{describeState(status, t)}</div>
              {!status.configured && !readOnly && (
                <div className={styles.settingDescription}>{t("access.setFirst")}</div>
              )}
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <div className={styles.settingControl}>
              <button
                type="button"
                className={styles.switch}
                data-on={status.enabled}
                aria-pressed={status.enabled}
                aria-label={t("access.requirePassword")}
                disabled={busy || readOnly || (!status.enabled && !status.stored)}
                onClick={() => void toggleEnabled()}
              />
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{status.stored ? t("access.replacePassword") : t("access.setPassword")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("access.newPassword")}</div>
              <div className={styles.settingDescription}>
                {t("access.newPasswordHint", { count: MIN_PASSWORD_LENGTH })}
              </div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy || readOnly}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("access.confirmPassword")}</div>
              <div className={styles.settingDescription}>{t("access.confirmHint")}</div>
            </div>
            <div className={styles.settingControl}>
              <input
                className={styles.textInput}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy || readOnly}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSave) void savePassword(); }}
              />
            </div>
          </div>
          <div className={styles.editorActions}>
            <div>
              <div className={styles.saveState}>
                {status.stored && status.updatedAt
                  ? t("access.lastChanged", { date: new Date(status.updatedAt).toLocaleString(locale) })
                  : t("access.notStored")}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {status.stored && !readOnly && (
                <button type="button" className={styles.dangerButton} disabled={busy} onClick={() => void clearPassword()}>
                  {t("access.removePassword")}
                </button>
              )}
              <button type="button" className={styles.primaryButton} disabled={!canSave} onClick={() => void savePassword()}>
                {busy ? t("i18n.saving") : t("access.savePassword")}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.group}>
          <h3 className={styles.groupTitle}>{t("access.forgotTitle")}</h3>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("access.recovery")}</div>
              <div className={styles.settingDescription}>
                {translateWithCode(t, "access.recoveryDescription", {}, { command: "omp-web --reset-password", path: "/recover" })}
              </div>
            </div>
            <div className={styles.settingControl}>
              <a className={styles.linkButton} href="/recover" target="_blank" rel="noreferrer">{t("access.openRecover")}</a>
            </div>
          </div>
          <div className={styles.settingRow}>
            <div>
              <div className={styles.settingLabel}>{t("access.basicAuthTitle")}</div>
              <div className={styles.settingDescription}>
                {t("access.basicAuthDescription")}
              </div>
            </div>
            <div className={styles.settingControl} />
          </div>
        </section>
      </div>
    </div>
  );
}
