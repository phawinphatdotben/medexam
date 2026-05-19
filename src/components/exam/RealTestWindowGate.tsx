"use client";

type Props = {
  title: string;
  onOpenWindow: () => void;
  popupBlocked?: boolean;
};

export function RealTestWindowGate({ title, onOpenWindow, popupBlocked }: Props) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-950 text-white px-6 py-12">
      <div className="max-w-lg w-full rounded-2xl border border-slate-700 bg-slate-900 p-8 shadow-2xl text-center space-y-5">
        <p className="text-xs font-bold uppercase tracking-widest text-orange-400">Formal exam</p>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <p className="text-slate-300 text-sm leading-relaxed">
          Real tests open in a dedicated exam window. Stay in that window until you submit — do not open another tab
          or browser window for this exam.
        </p>
        <ul className="text-left text-sm text-slate-400 space-y-2 list-disc list-inside">
          <li>Allow pop-ups for this site if your browser blocks the exam window.</li>
          <li>Close other tabs with this exam before starting.</li>
          <li>Switching away from the exam window will pause your view until you return.</li>
        </ul>
        {popupBlocked ? (
          <p className="text-amber-300 text-sm font-medium rounded-lg border border-amber-600/50 bg-amber-950/40 px-3 py-2">
            Pop-up was blocked. Enable pop-ups for this site, then click the button again.
          </p>
        ) : null}
        <button
          type="button"
          onClick={onOpenWindow}
          className="w-full bg-orange-700 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-xl transition"
        >
          Open secure exam window
        </button>
      </div>
    </div>
  );
}
