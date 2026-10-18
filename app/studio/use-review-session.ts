"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { emptyReview, parseWorkspaceReview, sourceHash, type ReviewSession } from "./review-session.ts";

export function useReviewSession(file: File | null) {
  const [session, setSession] = useState<ReviewSession | null>(null);
  const [loadedFile, setLoadedFile] = useState<File | null>(null);
  const [message, setMessage] = useState("");
  const current = useRef(session);
  const currentFile = useRef<File | null>(null);
  useEffect(() => {
    let active = true;
    current.current = null;
    currentFile.current = null;
    queueMicrotask(() => { if (active) { setSession(null); setMessage(""); } });
    if (file) void sourceHash(file).then(hash => {
      if (!active) return;
      let loaded = emptyReview(hash);
      try {
        const stored = localStorage.getItem(`reviter.workspace-review.${hash}`);
        if (stored) loaded = parseWorkspaceReview(stored, hash);
      } catch { setMessage("Saved review could not be read. Import a review copy to recover it."); }
      current.current = loaded; currentFile.current = file; setLoadedFile(file); setSession(loaded);
    }).catch(() => { if (active) setMessage("Source identity could not be checked; portable review saving is unavailable."); });
    return () => { active = false; };
  }, [file]);
  const update = useCallback((change: (value: ReviewSession) => ReviewSession) => {
    if (!current.current || currentFile.current !== file) throw new Error("Source identity is still being checked.");
    const next = change(current.current);
    parseWorkspaceReview(JSON.stringify(next), current.current.modelHash);
    current.current = next; setSession(next);
    try { localStorage.setItem(`reviter.workspace-review.${next.modelHash}`, JSON.stringify(next)); }
    catch { setMessage("Browser storage is unavailable or full. Export a review copy to keep these changes."); }
  }, [file]);
  const importReview = useCallback((text: string) => update(value => {
    const incoming = parseWorkspaceReview(text, value.modelHash);
    const merge = <T extends { id: string }>(current: T[], added: T[]) => [...new Map([...current, ...added].map(item => [item.id, item])).values()];
    return { ...value, views: merge(value.views, incoming.views), dimensions: merge(value.dimensions, incoming.dimensions) };
  }), [update]);
  return { session: loadedFile === file ? session : null, update, importReview, message };
}
