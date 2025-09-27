import React, { useMemo, useRef, useState, useEffect } from "react";
import DATA_SETS from "./data/index.js";

// === STATIC UNITS (no IDs on pairs here; we derive ids & global keys at runtime) ===


console.log("Loaded bonus words:", DATA_SETS[2]);

// --- Utils ---
const LS_KEY = "gm-mistakes-v1";
const loadLS = () => {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { return {}; }
};
const saveLS = (obj) => { try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch {} };
const bump = (obj, key, inc = 1) => { const n = { ...obj }; n[key] = (n[key] || 0) + inc; return n; };

function withIdsAndKeys(unit) {
  return {
    ...unit,
    pairs: unit.pairs.map((p, i) => ({ id: i + 1, gk: `${unit.id}:${i + 1}`, ...p })),
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

export default function App() {
  // mistakes persisted across sessions
  const [lsMistakes, setLsMistakes] = useState(loadLS()); // { gk: count }

  // dynamic units (adds a Review unit if there are mistakes)
  const computedUnits = useMemo(() => {
    const withMeta = DATA_SETS.map(withIdsAndKeys);
    // Build Review unit by collecting pairs whose gk appear in localStorage
    const reviewPairs = [];
    Object.keys(lsMistakes).forEach((gk) => {
      if (lsMistakes[gk] > 0) {
        const [uid, idxStr] = gk.split(":");
        const base = withMeta.find((u) => u.id === uid);
        const pair = base?.pairs[Number(idxStr) - 1];
        if (pair) reviewPairs.push({ ...pair });
      }
    });
    if (reviewPairs.length) {
      // Normalize ids 1..n but keep original gk
      const review = { id: "review", name: "Review", pairs: reviewPairs.map((p, i) => ({ ...p, id: i + 1 })) };
      return [review, ...withMeta];
    }
    return withMeta;
  }, [lsMistakes]);

  // selected unit id
  const [activeUnitId, setActiveUnitId] = useState(computedUnits[0].id);
  useEffect(() => {
    // if current id disappears (e.g., review emptied), fallback
    if (!computedUnits.find((u) => u.id === activeUnitId)) {
      setActiveUnitId(computedUnits[0].id);
    }
  }, [computedUnits, activeUnitId]);

  const unit = computedUnits.find((u) => u.id === activeUnitId) || computedUnits[0];
  const currentPairs = unit.pairs; // each has {id, gk, en, de}
  const TOTAL = currentPairs.length;

  // === Game state ===
  const VISIBLE_PAIR_COUNT = 5;
  const initialIds = Array.from({ length: Math.min(VISIBLE_PAIR_COUNT, TOTAL) }, (_, i) => currentPairs[i]?.id).filter(Boolean);
  const [leftOrder, setLeftOrder] = useState(() => shuffle(initialIds));
  const [rightOrder, setRightOrder] = useState(() => shuffle(initialIds));
  const [queueIndex, setQueueIndex] = useState(VISIBLE_PAIR_COUNT);

  const [solved, setSolved] = useState(new Set());
  const [selectedLeft, setSelectedLeft] = useState(null);
  const [selectedRight, setSelectedRight] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [incomingIds, setIncomingIds] = useState(new Set());

  // Results/mistakes (session)
  const [mistakeTotal, setMistakeTotal] = useState(0);
  const [mistakeById, setMistakeById] = useState({}); // pairId -> count (session)
  const [confusions, setConfusions] = useState({}); // pair confusion counts "L->R"
  const [correctStreak, setCorrectStreak] = useState({}); // gk -> consecutive correct matches

  const lockRef = useRef(false);

  // Re-init when unit changes
  useEffect(() => {
    const ids = Array.from({ length: Math.min(VISIBLE_PAIR_COUNT, unit.pairs.length) }, (_, i) => unit.pairs[i]?.id).filter(Boolean);
    setLeftOrder(shuffle(ids));
    setRightOrder(shuffle(ids));
    setQueueIndex(VISIBLE_PAIR_COUNT);
    setSolved(new Set());
    setSelectedLeft(null);
    setSelectedRight(null);
    setFeedback(null);
    setIncomingIds(new Set());
    setMistakeTotal(0);
    setMistakeById({});
    setConfusions({});
  }, [unit.id]);

  // Persist lsMistakes whenever it changes
  useEffect(() => { saveLS(lsMistakes); }, [lsMistakes]);

  const leftCards = useMemo(() => leftOrder.map((id) => {
    if (id == null) return null;
    const p = currentPairs[id - 1];
    if (!p) return null;
    return { key: `${id}-de`, pairId: id, text: p.de };
  }), [leftOrder, currentPairs]);
  const rightCards = useMemo(() => rightOrder.map((id) => {
    if (id == null) return null;
    const p = currentPairs[id - 1];
    if (!p) return null;
    return { key: `${id}-en`, pairId: id, text: p.en };
  }), [rightOrder, currentPairs]);

  const solvedCount = solved.size;
  const allDone = solvedCount === TOTAL;

  function replaceEverywhereImmutable(leftOrder, rightOrder, targetPid, nextId) {
    return {
      left: leftOrder.map((id) => (id === targetPid ? nextId : id)),
      right: rightOrder.map((id) => (id === targetPid ? nextId : id)),
    };
  }
  function replacePairEverywhere(targetPid, nextId) {
    const { left, right } = replaceEverywhereImmutable(leftOrder, rightOrder, targetPid, nextId);
    setLeftOrder(left);
    setRightOrder(right);
    if (nextId != null) {
      setIncomingIds((s) => new Set(s).add(nextId));
      setTimeout(() => setIncomingIds((s) => { const c = new Set(s); c.delete(nextId); return c; }), 260);
    }
  }

  function onWrong(nextLeft, nextRight) {
    setMistakeTotal((n) => n + 1);
    setMistakeById((m) => bump(bump(m, nextLeft.pairId), nextRight.pairId));
    setConfusions((c) => bump(c, `${nextLeft.pairId}->${nextRight.pairId}`));

    // persist per-word mistakes in LS using global keys
    const gkL = currentPairs[nextLeft.pairId - 1].gk;
    const gkR = currentPairs[nextRight.pairId - 1].gk;
    setLsMistakes((prev) => bump(bump(prev, gkL), gkR));
    // reset streaks for both words on mistake
    setCorrectStreak((prev) => ({ ...prev, [gkL]: 0, [gkR]: 0 }));
  }

 function onCorrect(nextLeft, nextRight) {
   const pid = nextLeft.pairId;
   const gk = currentPairs[pid - 1].gk;
   setCorrectStreak((prev) => {
     const next = { ...prev, [gk]: (prev[gk] || 0) + 1 };
     if ((next[gk] || 0) >= 2 && lsMistakes[gk]) {
       setLsMistakes((old) => { const n = { ...old }; delete n[gk]; return n; });
       next[gk] = 0; // reset after clearing
     }
     return next;
   });
 }

  function checkMatch(nextLeft, nextRight) {
    if (!nextLeft || !nextRight) return;
    lockRef.current = true;
    const isMatch = nextLeft.pairId === nextRight.pairId && nextLeft.key !== nextRight.key;

    if (isMatch) {
      setFeedback({ type: "match", leftKey: nextLeft.key, rightKey: nextRight.key });
      setTimeout(() => {
        onCorrect(nextLeft, nextRight);
        const pid = nextLeft.pairId;
        setSolved((prev) => new Set(prev).add(pid));
        let nextId = null;
        if (queueIndex < TOTAL) { nextId = currentPairs[queueIndex].id; setQueueIndex(queueIndex + 1); }
        replacePairEverywhere(pid, nextId);
        setSelectedLeft(null);
        setSelectedRight(null);
        setFeedback(null);
        lockRef.current = false;
      }, 420);
    } else {
      onWrong(nextLeft, nextRight);
      setFeedback({ type: "wrong", leftKey: nextLeft.key, rightKey: nextRight.key });
      setTimeout(() => {
        setSelectedLeft(null);
        setSelectedRight(null);
        setFeedback(null);
        lockRef.current = false;
      }, 420);
    }
  }

  function onPick(side, card) {
    if (lockRef.current) return;
    if (side === "left" && selectedLeft && selectedLeft.key === card.key) { setSelectedLeft(null); return; }
    if (side === "right" && selectedRight && selectedRight.key === card.key) { setSelectedRight(null); return; }

    if (side === "left") { const nl = card; const nr = selectedRight; setSelectedLeft(nl); checkMatch(nl, nr); }
    else { const nr = card; const nl = selectedLeft; setSelectedRight(nr); checkMatch(nl, nr); }
  }

  function restart() {
    const ids = Array.from({ length: Math.min(VISIBLE_PAIR_COUNT, TOTAL) }, (_, i) => currentPairs[i]?.id).filter(Boolean);
    setSolved(new Set());
    setQueueIndex(VISIBLE_PAIR_COUNT);
    setLeftOrder(shuffle(ids));
    setRightOrder(shuffle(ids));
    setSelectedLeft(null);
    setSelectedRight(null);
    setFeedback(null);
    setIncomingIds(new Set());
    setMistakeTotal(0);
    setMistakeById({});
    setConfusions({});
  }

  // Derived helpers for results & indicators
  const weakWords = useMemo(() => {
    const arr = Object.keys(mistakeById).map((idStr) => {
      const id = Number(idStr);
      const p = currentPairs[id - 1];
      return { id, count: mistakeById[idStr], en: p?.en, de: p?.de };
    }).filter((x) => x.en && x.de);
    arr.sort((a, b) => b.count - a.count);
    return arr;
  }, [mistakeById, currentPairs]);

  const topConfusions = useMemo(() => {
    const entries = Object.entries(confusions).map(([k, v]) => {
      const [l, r] = k.split("->").map(Number);
      return { key: k, left: l, right: r, count: v, en: currentPairs[l - 1]?.en, de: currentPairs[r - 1]?.de };
    }).filter(e => e.en && e.de);
    entries.sort((a, b) => b.count - a.count);
    return entries.slice(0, 6);
  }, [confusions, currentPairs]);

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center p-5 gap-5">
      <style>{`
        .match-flash { background:#22c55e !important; color:#0a0a0a !important; }
        .wrong-flash { background:#ef4444 !important; color:#fff !important; }
        .card { transition: background 200ms ease, color 200ms ease, border-color 200ms ease; }
        .text-fade { opacity: 0; transition: opacity 240ms ease; }
        .text-fade.mount { opacity: 1; }
      `}</style>

      {/* Header: pills on the left (title removed), progress on the right */}
      <header className="w-full max-w-3xl flex items-center justify-between">
        <div className="overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-2">
            {computedUnits.map((u) => (
              <button
                key={u.id}
                onClick={() => setActiveUnitId(u.id)}
                className={
                  "px-3 py-1.5 rounded-full border text-sm whitespace-nowrap " +
                  (u.id === unit.id ? "bg-indigo-500 border-indigo-400 text-white" : "bg-neutral-900 border-neutral-700 text-neutral-200 hover:border-neutral-600")
                }
              >
                {u.name} ({u.pairs.length})
              </button>
            ))}
          </div>
        </div>
        <span className="px-2 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-xs text-neutral-300">Solved: {solvedCount}/{TOTAL}</span>
      </header>

      <div className="w-full max-w-3xl">
        <progress className="w-full" value={solvedCount} max={TOTAL} />
      </div>

      {allDone ? (
        <div className="text-center mt-6 w-full max-w-3xl">
          <h2 className="text-xl font-semibold mb-2">Results</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-left">
              <div className="text-neutral-400 text-xs">Total words</div>
              <div className="text-2xl font-semibold">{TOTAL}</div>
            </div>
            <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-left">
              <div className="text-neutral-400 text-xs">Solved correctly</div>
              <div className="text-2xl font-semibold">{solvedCount}</div>
            </div>
            <div className="p-4 rounded-2xl bg-neutral-900 border border-neutral-800 text-left">
              <div className="text-neutral-400 text-xs">Mistakes made</div>
              <div className="text-2xl font-semibold">{mistakeTotal}</div>
            </div>
          </div>

          <div className="mt-6 text-left">
            <h3 className="font-semibold mb-2">Words needing more practice</h3>
            {weakWords.length === 0 ? (
              <div className="text-neutral-400 text-sm">No mistakes — awesome! 🎉</div>
            ) : (
              <div className="rounded-2xl overflow-hidden border border-neutral-800">
                <div className="grid grid-cols-12 bg-neutral-900 px-3 py-2 text-xs text-neutral-300">
                  <div className="col-span-6">English</div>
                  <div className="col-span-5">Deutsch</div>
                  <div className="col-span-1 text-right">×</div>
                </div>
                <div className="divide-y divide-neutral-800">
                  {weakWords.map((w) => (
                    <div key={w.id} className="grid grid-cols-12 px-3 py-2 text-sm bg-neutral-950">
                      <div className="col-span-6 pr-2">{w.en}</div>
                      <div className="col-span-5 pr-2">{w.de}</div>
                      <div className="col-span-1 text-right font-semibold">{w.count}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 text-left">
            <h3 className="font-semibold mb-2">Common confusions</h3>
            {topConfusions.length === 0 ? (
              <div className="text-neutral-400 text-sm">No wrong matches recorded.</div>
            ) : (
              <ul className="space-y-2">
                {topConfusions.map((c) => (
                  <li key={c.key} className="p-3 rounded-xl bg-neutral-900 border border-neutral-800">
                    <div className="text-sm"><span className="font-medium">EN:</span> {c.en} ↔ <span className="font-medium">DE (wrong):</span> {c.de}</div>
                    <div className="text-xs text-neutral-400">times mistaken: {c.count}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mt-6 flex gap-2 justify-center">
            <button onClick={restart} className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 transition shadow">Restart</button>
          </div>
        </div>
      ) : (
        <div className="w-full max-w-3xl grid grid-cols-2 gap-3">
          {/* LEFT (DE) */}
          <div className="flex flex-col gap-3">
            {leftCards.map((c, idx) => {
              if (!c) return <div key={`empty-left-${idx}`} className="h-16 md:h-20 p-4 rounded-2xl border border-transparent invisible">.</div>;
              const active = selectedLeft && selectedLeft.key === c.key;
              const isMatch = feedback && feedback.type === "match" && feedback.leftKey === c.key;
              const isWrong = feedback && feedback.type === "wrong" && feedback.leftKey === c.key;
              const incoming = incomingIds.has(c.pairId);
              const gk = currentPairs[c.pairId - 1].gk;
              const hasMistake = (lsMistakes[gk] || 0) > 0;
              return (
                <button
                  key={c.key}
                  onClick={() => onPick("left", c)}
                  className={
                    "card h-16 md:h-20 text-left p-4 rounded-2xl border select-none flex items-center justify-between " +
                    (isMatch ? "match-flash " : isWrong ? "wrong-flash " : active ? "bg-neutral-200 text-neutral-900 border-neutral-400 " : "bg-neutral-900 text-neutral-100 border-neutral-800 hover:border-neutral-700 active:scale-[0.98] ")
                  }
                >
                  <div className={"font-medium leading-snug whitespace-pre-wrap " + (incoming ? "text-fade mount" : "")}>{c.text}</div>
                  {hasMistake ? <span className="ml-2 text-sm"></span> : null}
                </button>
              );
            })}
          </div>

          {/* RIGHT (EN) */}
          <div className="flex flex-col gap-3">
            {rightCards.map((c, idx) => {
              if (!c) return <div key={`empty-right-${idx}`} className="h-16 md:h-20 p-4 rounded-2xl border border-transparent invisible">.</div>;
              const active = selectedRight && selectedRight.key === c.key;
              const isMatch = feedback && feedback.type === "match" && feedback.rightKey === c.key;
              const isWrong = feedback && feedback.type === "wrong" && feedback.rightKey === c.key;
              const incoming = incomingIds.has(c.pairId);
              const gk = currentPairs[c.pairId - 1].gk;
              const hasMistake = false;
              return (
                <button
                  key={c.key}
                  onClick={() => onPick("right", c)}
                  className={
                    "card h-16 md:h-20 text-left p-4 rounded-2xl border select-none flex items-center justify-between " +
                    (isMatch ? "match-flash " : isWrong ? "wrong-flash " : active ? "bg-neutral-200 text-neutral-900 border-neutral-400 " : "bg-neutral-900 text-neutral-100 border-neutral-800 hover:border-neutral-700 active:scale-[0.98] ")
                  }
                >
                  <div className={"font-medium leading-snug whitespace-pre-wrap " + (incoming ? "text-fade mount" : "")}>{c.text}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <footer className="w-full max-w-3xl flex items-center justify-end mt-2">
        <button onClick={restart} className="px-3 py-2 text-sm rounded-xl bg-neutral-800 border border-neutral-700 hover:bg-neutral-700 transition">Restart</button>
      </footer>
    </div>
  );
}
