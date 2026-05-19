"use client";

import { useRealTestLockActions } from "@/components/exam/RealTestExamShell";

type Props = {
  isRealTest: boolean;
};

export function RealTestCompleteActions({ isRealTest }: Props) {
  const lock = useRealTestLockActions();
  if (!isRealTest || !lock?.isSecureSession) return null;

  return (
    <button
      type="button"
      onClick={lock.releaseAndClose}
      className="mt-6 w-full bg-slate-800 text-white font-semibold px-5 py-2 rounded-lg hover:bg-slate-900"
    >
      Close exam window
    </button>
  );
}
