"use client";

import { useState } from "react";
import { openRealExamWindow } from "@/lib/exam/realTestLock";

type Props = {
  href: string;
  label?: string;
  className?: string;
};

export function BeginRealTestButton({ href, label = "Begin", className }: Props) {
  const [popupBlocked, setPopupBlocked] = useState(false);

  const handleClick = () => {
    setPopupBlocked(false);
    const win = openRealExamWindow(href);
    if (!win || win.closed) {
      setPopupBlocked(true);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        className={
          className ??
          "bg-orange-800 text-white px-5 py-2 rounded-lg font-semibold text-sm hover:bg-orange-900"
        }
      >
        {label}
      </button>
      {popupBlocked ? (
        <p className="text-xs text-red-700 max-w-xs text-right">
          Pop-up blocked — allow pop-ups for this site, then click Begin again.
        </p>
      ) : null}
    </div>
  );
}
