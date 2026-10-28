import React from "react";

const TREES = [
  { points: "2,26 8,8 14,26", o: .8 }, { points: "14,26 22,2 30,26", o: .95 },
  { points: "30,26 36,10 42,26", o: .75 }, { points: "41,26 50,0 59,26", o: 1 },
  { points: "58,26 65,7 72,26", o: .85 }, { points: "72,26 80,3 88,26", o: .95 },
  { points: "87,26 94,9 101,26", o: .75 }, { points: "101,26 109,4 117,26", o: .9 },
];

/** Static treeline mark matching the server logoSvg (8 narrow conifers). */
export function TreelineMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 120 28" width="120" height="28" className={className} role="img" aria-label="HWD Farm treeline">
      {TREES.map((t) => (
        <polygon key={t.points} points={t.points} fill="#244b39" fillOpacity={t.o} />
      ))}
    </svg>
  );
}

export function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className="inline-flex items-end gap-2" data-testid="logo">
      <TreelineMark className={large ? "h-10 w-auto" : "h-7 w-auto"} />
      <span className={`font-display font-semibold text-primary leading-none ${large ? "text-3xl" : "text-xl sm:text-2xl"}`}>HWD Farm</span>
    </span>
  );
}
