"use client";

type Props = {
  onContinue: () => void;
};

/** Blocks interaction when the student leaves the exam window (tab switch, etc.). */
export function RealTestFocusOverlay({ onContinue }: Props) {
  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/95 px-6"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="exam-focus-title"
    >
      <div className="max-w-md w-full rounded-2xl border-2 border-orange-500 bg-slate-900 p-8 text-center shadow-2xl">
        <h2 id="exam-focus-title" className="text-xl font-bold text-white mb-3">
          Return to the exam window
        </h2>
        <p className="text-slate-300 text-sm mb-6">
          You left the secure exam window or opened another tab. For formal exams you must stay in this window until
          you finish and submit.
        </p>
        <button
          type="button"
          onClick={onContinue}
          className="w-full bg-orange-700 hover:bg-orange-600 text-white font-semibold py-3 rounded-xl"
        >
          I am back — continue exam
        </button>
      </div>
    </div>
  );
}
