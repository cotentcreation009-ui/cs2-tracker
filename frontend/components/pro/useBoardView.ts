"use client";

import { useCallback, useEffect, useState } from "react";
import { parseBoardView, withBoardView, type BoardView } from "./boardView";

// The matches column's view, kept in the URL (`?view=results`) so a reload or
// a shared link lands on the same list. Read from the location after mount
// rather than with useSearchParams: that hook would need a Suspense boundary
// around the board, which takes the page's h1 out of the static HTML. The
// first client render shows the board, the effect corrects it — behind the
// loading skeleton, so nothing flashes. Switching replaces the history entry
// (a tab, not a page: Back should leave the board, not undo a toggle), and
// Back/Forward between two states of this page still follow the URL.
export function useBoardView(): [BoardView, (view: BoardView) => void] {
  const [view, setViewState] = useState<BoardView>("board");

  useEffect(() => {
    const sync = () => setViewState(parseBoardView(window.location.search));
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const setView = useCallback((next: BoardView) => {
    setViewState(next);
    const qs = withBoardView(window.location.search, next);
    const url = `${window.location.pathname}${qs}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, []);

  return [view, setView];
}
