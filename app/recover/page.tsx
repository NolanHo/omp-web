"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { I18nProvider, useI18n } from "@/hooks/useI18n";
import { translateWithCode } from "@/lib/i18n/rich-text";
import type { TranslationParams } from "@/lib/i18n/types";
import styles from "./recover.module.css";

/**
 * Password recovery, reachable without credentials.
 *
 * The page cannot let anyone in on its own. Asking for a code makes the server
 * print one on its own console — the terminal omp-web is running in — so
 * completing the flow proves the person driving it can see that machine. See
 * `app/api/web-access/recovery/route.ts`.
 */

const MIN_PASSWORD_LENGTH = 8;

type Stage = "idle" | "code-sent" | "done";

type Translate = (key: string, params?: TranslationParams) => string;

/** Error body of `POST /api/web-access/recovery`: `error` is the original text, `code` the stable one. */
interface RecoveryErrorBody {
  error?: string;
  code?: string;
  /** Credential file path, sent with the `credentialUnreadable` code. */
  file?: string;
  /** Password length limit, sent with the `passwordTooShort`/`passwordTooLong` codes. */
  count?: number;
  /** Attempts left, sent with the `invalidCode` code. */
  remainingAttempts?: number;
}

/**
 * Translate a server error by its stable code, falling back to the English text.
 * @param body parsed error response
 * @param status HTTP status, used when the body carries no text
 * @param t translation function of the active locale
 * @returns localized message, or the server's original text for unknown codes
 */
function describeServerError(body: RecoveryErrorBody, status: number, t: Translate): string {
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

export default function RecoverPage() {
  // `/recover` is reachable before signing in and sits outside the app shell,
  // so the page carries its own locale context instead of relying on app/page.tsx.
  return (
    <I18nProvider>
      <RecoverCard />
    </I18nProvider>
  );
}

function RecoverCard() {
  const { t, locale } = useI18n();
  const [stage, setStage] = useState<Stage>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");

  const post = useCallback(async (body: Record<string, unknown>) => {
    const response = await fetch("/api/web-access/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as { ok?: boolean; expiresAt?: number } & RecoveryErrorBody;
    if (!response.ok || data.error) throw new Error(describeServerError(data, response.status, t));
    return data;
  }, [t]);

  const requestCode = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const data = await post({ action: "request" });
      setExpiresAt(data.expiresAt ?? null);
      setStage("code-sent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [post]);

  const completeRecovery = useCallback(async () => {
    if (password !== confirmation) {
      setError(t("common.passwordsDoNotMatch"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await post({ action: "complete", code, password });
      setCode("");
      setPassword("");
      setConfirmation("");
      setStage("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [code, confirmation, password, post, t]);

  const canSubmit = !busy
    && code.trim().length > 0
    && password.length >= MIN_PASSWORD_LENGTH
    && password === confirmation;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <div className={styles.eyebrow}>omp-web</div>
        <h1 className={styles.title}>{t("recover.title")}</h1>

        {stage === "done" ? (
          <>
            <p className={styles.lead}>
              {translateWithCode(t, "recover.doneLead", {}, { username: "omp" })}
            </p>
            <Link className={styles.primary} href="/">{t("recover.back")}</Link>
          </>
        ) : (
          <>
            <p className={styles.lead}>
              {t("recover.lead")}
            </p>
            <p className={styles.aside}>
              {translateWithCode(t, "recover.resetAside", {}, { command: "omp-web --reset-password" })}
            </p>

            <button type="button" className={styles.secondary} disabled={busy} onClick={() => void requestCode()}>
              {busy && stage === "idle" ? t("recover.requesting") : stage === "code-sent" ? t("recover.sendAnother") : t("recover.printCode")}
            </button>

            {stage === "code-sent" && (
              <p className={styles.notice}>
                {expiresAt
                  ? t("recover.codeSentValid", { time: new Date(expiresAt).toLocaleTimeString(locale) })
                  : t("recover.codeSent")}
              </p>
            )}

            <label className={styles.field}>
              <span>{t("recover.codeLabel")}</span>
              <input
                className={styles.input}
                value={code}
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXX-XXXX-XXXX"
                disabled={busy}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>{t("access.newPassword")}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span>{t("access.confirmPassword")}</span>
              <input
                className={styles.input}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && canSubmit) void completeRecovery(); }}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="button" className={styles.primary} disabled={!canSubmit} onClick={() => void completeRecovery()}>
              {busy && stage === "code-sent" ? t("recover.setting") : t("recover.set")}
            </button>
          </>
        )}
      </div>
    </main>
  );
}
