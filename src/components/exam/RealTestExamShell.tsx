"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useExamProctor } from "@/hooks/useExamProctor";
import { useRealTestLock } from "@/hooks/useRealTestLock";
import type { ExamProctorEventType } from "@/lib/exam/examProctor";
import type { RealExamKind } from "@/lib/exam/realTestLock";
import { RealTestFocusOverlay } from "@/components/exam/RealTestFocusOverlay";
import { RealTestWindowGate } from "@/components/exam/RealTestWindowGate";

type LockActions = {
  releaseAndClose: () => void;
  isSecureSession: boolean;
};

const RealTestLockContext = createContext<LockActions | null>(null);

type ProctorLogFn = (eventType: ExamProctorEventType, detail?: Record<string, unknown>) => void;

const ExamProctorContext = createContext<ProctorLogFn | null>(null);

export function useRealTestLockActions(): LockActions | null {
  return useContext(RealTestLockContext);
}

/** Log proctor events during assigned real tests (null for practice). */
export function useExamProctorLog(): ProctorLogFn | null {
  return useContext(ExamProctorContext);
}

type Props = {
  kind: RealExamKind;
  testId: string;
  /** Formal exam assigned via Test taking (has `assignment` query param). */
  secureExam: boolean;
  finished: boolean;
  title: string;
  children: ReactNode;
};

export function RealTestExamShell({ kind, testId, secureExam, finished, title, children }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get("assignment")?.trim() || null;
  const proctorEnabled = secureExam && !!assignmentId;

  const examHref = useMemo(() => {
    const q = searchParams.toString();
    return q ? `${pathname}?${q}` : pathname;
  }, [pathname, searchParams]);

  const scope = assignmentId && testId ? { assignmentId, testId, kind } : null;

  const logRef = useRef<ProctorLogFn>(() => {});

  const lock = useRealTestLock({
    enabled: proctorEnabled,
    scope,
    finished,
    examHref,
    onFocusLost: () => logRef.current("focus_lost"),
    onFocusReturned: () => logRef.current("focus_returned"),
  });

  const sessionActive = lock.ready && !finished;

  const { log } = useExamProctor({
    enabled: proctorEnabled,
    assignmentId,
    testKind: kind,
    testId,
    finished,
    requestFullscreen: proctorEnabled,
    sessionActive,
  });

  logRef.current = (eventType, detail) => {
    void log(eventType, detail);
  };

  const proctorLog = useMemo<ProctorLogFn>(
    () => (eventType, detail) => {
      void log(eventType, detail);
    },
    [log],
  );

  const actions = useMemo<LockActions | null>(() => {
    if (!proctorEnabled) return null;
    return {
      releaseAndClose: lock.releaseAndClose,
      isSecureSession: lock.ready || finished,
    };
  }, [proctorEnabled, lock.releaseAndClose, lock.ready, finished]);

  if (!proctorEnabled) {
    return <>{children}</>;
  }

  if (lock.blockedByOtherTab) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white px-6">
        <div className="max-w-md text-center border border-red-200 bg-red-50 rounded-xl p-8">
          <h1 className="text-lg font-bold text-red-900 mb-2">Exam already open</h1>
          <p className="text-sm text-red-800">
            This exam is running in another tab or window. Close that session, then refresh this page.
          </p>
        </div>
      </div>
    );
  }

  if (lock.needsPopup) {
    return <RealTestWindowGate title={title} onOpenWindow={lock.openExamPopup} />;
  }

  if (!lock.ready && !finished) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-white">
        <p className="text-lg font-medium">Preparing secure exam window…</p>
      </div>
    );
  }

  return (
    <ExamProctorContext.Provider value={proctorLog}>
      <RealTestLockContext.Provider value={actions}>
        {children}
        {lock.focusLost ? <RealTestFocusOverlay onContinue={lock.dismissFocusWarning} /> : null}
      </RealTestLockContext.Provider>
    </ExamProctorContext.Provider>
  );
}
