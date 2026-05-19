"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  logExamProctorEvent,
  type ExamProctorEventType,
} from "@/lib/exam/examProctor";
import type { RealExamKind } from "@/lib/exam/realTestLock";

type Options = {
  enabled: boolean;
  assignmentId: string | null;
  testKind: RealExamKind;
  testId: string;
  finished: boolean;
  /** Request fullscreen when the secure session becomes active (real tests). */
  requestFullscreen: boolean;
  sessionActive: boolean;
};

export function useExamProctor({
  enabled,
  assignmentId,
  testKind,
  testId,
  finished,
  requestFullscreen,
  sessionActive,
}: Options) {
  const startedRef = useRef(false);
  const endedRef = useRef(false);

  const log = useCallback(
    async (eventType: ExamProctorEventType, detail?: Record<string, unknown>) => {
      if (!enabled || !assignmentId) return;
      await logExamProctorEvent({
        assignmentId,
        testKind,
        testId,
        eventType,
        detail,
      });
    },
    [enabled, assignmentId, testKind, testId],
  );

  useEffect(() => {
    if (!enabled || !assignmentId || !sessionActive || finished) return;
    if (startedRef.current) return;
    startedRef.current = true;
    void log("session_started");
  }, [enabled, assignmentId, sessionActive, finished, log]);

  useEffect(() => {
    if (!enabled || !assignmentId || !startedRef.current) return;
    if (!finished) return;
    if (endedRef.current) return;
    endedRef.current = true;
    void log("session_ended");
  }, [enabled, assignmentId, finished, log]);

  useEffect(() => {
    if (!requestFullscreen || !sessionActive || finished) return;
    const el = document.documentElement;
    void el.requestFullscreen?.().catch(() => {
      /* user denied or unsupported */
    });
  }, [requestFullscreen, sessionActive, finished]);

  useEffect(() => {
    if (!enabled || !sessionActive || finished) return;

    let hadFullscreen = false;
    const onFullscreen = () => {
      if (document.fullscreenElement) {
        hadFullscreen = true;
        void log("fullscreen_entered");
      } else if (hadFullscreen) {
        void log("fullscreen_exited");
      }
    };
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => document.removeEventListener("fullscreenchange", onFullscreen);
  }, [enabled, sessionActive, finished, log]);

  return { log };
}
