"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  claimRealExamLock,
  createLockToken,
  isExamPopupWindow,
  isLockHeldByOther,
  openRealExamWindow,
  releaseRealExamLock,
  setRealExamSessionActive,
  startRealExamLockHeartbeat,
  type RealExamLockScope,
} from "@/lib/exam/realTestLock";

type Options = {
  enabled: boolean;
  scope: RealExamLockScope | null;
  finished: boolean;
  examHref: string;
  onFocusLost?: () => void;
  onFocusReturned?: () => void;
};

export type RealTestLockState = {
  /** Must open / continue in the dedicated exam popup. */
  needsPopup: boolean;
  /** Another browser tab already has this exam. */
  blockedByOtherTab: boolean;
  /** User left the exam window (tab switch, minimized, etc.). */
  focusLost: boolean;
  /** Lock is active — exam UI may proceed. */
  ready: boolean;
  openExamPopup: () => void;
  dismissFocusWarning: () => void;
  releaseAndClose: () => void;
};

export function useRealTestLock({
  enabled,
  scope,
  finished,
  examHref,
  onFocusLost,
  onFocusReturned,
}: Options): RealTestLockState {
  const tokenRef = useRef<string | null>(null);
  const [inPopup, setInPopup] = useState(false);
  const [lockReady, setLockReady] = useState(false);
  const [blockedByOtherTab, setBlockedByOtherTab] = useState(false);
  const [focusLost, setFocusLost] = useState(false);
  const [dismissedFocus, setDismissedFocus] = useState(false);

  const openExamPopup = useCallback(() => {
    openRealExamWindow(examHref);
  }, [examHref]);

  useEffect(() => {
    if (!enabled) {
      setInPopup(false);
      setLockReady(false);
      setBlockedByOtherTab(false);
      return;
    }
    setInPopup(isExamPopupWindow());
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !scope || !inPopup || finished) {
      setLockReady(false);
      return;
    }

    if (!tokenRef.current) {
      tokenRef.current = createLockToken();
    }
    const token = tokenRef.current;

    if (!claimRealExamLock(scope, token)) {
      setBlockedByOtherTab(true);
      setLockReady(false);
      return;
    }

    setBlockedByOtherTab(false);
    setLockReady(true);
    setRealExamSessionActive(true);

    const stopHeartbeat = startRealExamLockHeartbeat(scope, token);

    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key.includes(scope.assignmentId) && isLockHeldByOther(scope, token)) {
        setBlockedByOtherTab(true);
        setLockReady(false);
      }
    };
    window.addEventListener("storage", onStorage);

    return () => {
      stopHeartbeat();
      window.removeEventListener("storage", onStorage);
      releaseRealExamLock(scope, token);
      setRealExamSessionActive(false);
    };
  }, [enabled, scope, inPopup, finished]);

  useEffect(() => {
    if (!enabled || !lockReady || finished) return;

    const onVis = () => {
      if (document.hidden) {
        setFocusLost(true);
        setDismissedFocus(false);
        onFocusLost?.();
      } else {
        onFocusReturned?.();
      }
    };
    const onBlur = () => {
      if (document.hidden) return;
      setFocusLost(true);
      setDismissedFocus(false);
      onFocusLost?.();
    };

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, lockReady, finished, onFocusLost, onFocusReturned]);

  useEffect(() => {
    if (!enabled || !lockReady || finished) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, lockReady, finished]);

  useEffect(() => {
    if (!finished || !scope) return;
    const token = tokenRef.current;
    if (token) releaseRealExamLock(scope, token);
    setRealExamSessionActive(false);
    setLockReady(false);
  }, [finished, scope]);

  const releaseAndClose = useCallback(() => {
    if (scope && tokenRef.current) {
      releaseRealExamLock(scope, tokenRef.current);
    }
    setRealExamSessionActive(false);
    try {
      window.close();
    } catch {
      /* ignore */
    }
  }, [scope]);

  const dismissFocusWarning = useCallback(() => {
    setDismissedFocus(true);
    setFocusLost(false);
    onFocusReturned?.();
  }, [onFocusReturned]);

  return useMemo(
    () => ({
      needsPopup: enabled && !inPopup,
      blockedByOtherTab: enabled && blockedByOtherTab,
      focusLost: enabled && lockReady && focusLost && !dismissedFocus && !finished,
      ready: enabled && inPopup && lockReady && !blockedByOtherTab,
      openExamPopup,
      dismissFocusWarning,
      releaseAndClose,
    }),
    [
      enabled,
      inPopup,
      blockedByOtherTab,
      focusLost,
      dismissedFocus,
      finished,
      lockReady,
      openExamPopup,
      dismissFocusWarning,
      releaseAndClose,
    ],
  );
}
