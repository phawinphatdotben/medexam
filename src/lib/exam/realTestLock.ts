/** Dedicated popup name — must match `window.open` second argument. */
export const REAL_EXAM_WINDOW_NAME = "meq-real-exam";

/** Navbar hides while a real exam session is active in this browser tab/window. */
export const REAL_EXAM_SESSION_ACTIVE = "meq-real-exam-active";

const LOCK_PREFIX = "meq-real-exam-lock:";
const HEARTBEAT_MS = 2000;
const STALE_MS = 6000;

export type RealExamKind = "meq" | "sba";

export type RealExamLockScope = {
  assignmentId: string;
  testId: string;
  kind: RealExamKind;
};

export type RealExamLockRecord = {
  token: string;
  updatedAt: number;
};

const POPUP_FEATURES =
  "popup=yes,width=1280,height=800,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes";

export function lockStorageKey(scope: RealExamLockScope): string {
  return `${LOCK_PREFIX}${scope.assignmentId}:${scope.kind}:${scope.testId}`;
}

export function buildRealExamUrl(href: string): string {
  if (typeof window === "undefined") return href;
  const url = new URL(href, window.location.origin);
  url.searchParams.set("examWindow", "1");
  return `${url.pathname}${url.search}`;
}

/** Opens the exam in a dedicated popup; parent tab stays on Test taking. */
export function openRealExamWindow(href: string): Window | null {
  const target = buildRealExamUrl(href);
  const win = window.open(target, REAL_EXAM_WINDOW_NAME, POPUP_FEATURES);
  if (win) {
    try {
      win.focus();
    } catch {
      /* ignore */
    }
  }
  return win;
}

export function isExamPopupWindow(): boolean {
  if (typeof window === "undefined") return false;
  if (window.name === REAL_EXAM_WINDOW_NAME) return true;
  return new URLSearchParams(window.location.search).get("examWindow") === "1";
}

function readLock(key: string): RealExamLockRecord | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RealExamLockRecord;
    if (!parsed?.token || typeof parsed.updatedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeLock(key: string, record: RealExamLockRecord): void {
  localStorage.setItem(key, JSON.stringify(record));
}

function clearLock(key: string, token: string): void {
  const cur = readLock(key);
  if (cur?.token === token) localStorage.removeItem(key);
}

/** Claim cross-tab lock; returns false if another live session owns it. */
export function claimRealExamLock(scope: RealExamLockScope, token: string): boolean {
  const key = lockStorageKey(scope);
  const now = Date.now();
  const cur = readLock(key);
  if (cur && cur.token !== token && now - cur.updatedAt < STALE_MS) {
    return false;
  }
  writeLock(key, { token, updatedAt: now });
  return true;
}

export function touchRealExamLock(scope: RealExamLockScope, token: string): void {
  const key = lockStorageKey(scope);
  const cur = readLock(key);
  if (cur?.token === token) {
    writeLock(key, { token, updatedAt: Date.now() });
  }
}

export function releaseRealExamLock(scope: RealExamLockScope, token: string): void {
  clearLock(lockStorageKey(scope), token);
}

export function startRealExamLockHeartbeat(
  scope: RealExamLockScope,
  token: string,
): () => void {
  const id = window.setInterval(() => {
    touchRealExamLock(scope, token);
  }, HEARTBEAT_MS);
  return () => window.clearInterval(id);
}

export function setRealExamSessionActive(active: boolean): void {
  if (active) {
    sessionStorage.setItem(REAL_EXAM_SESSION_ACTIVE, "1");
  } else {
    sessionStorage.removeItem(REAL_EXAM_SESSION_ACTIVE);
  }
  window.dispatchEvent(new CustomEvent("meq-real-exam-session-change"));
}

export function isRealExamSessionActive(): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(REAL_EXAM_SESSION_ACTIVE) === "1";
}

export function createLockToken(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Another tab/window still holds this exam lock. */
export function isLockHeldByOther(scope: RealExamLockScope, token: string): boolean {
  const cur = readLock(lockStorageKey(scope));
  if (!cur) return false;
  if (cur.token === token) return false;
  return Date.now() - cur.updatedAt < STALE_MS;
}
