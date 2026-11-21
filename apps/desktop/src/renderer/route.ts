import { useEffect, useState } from "react";
import { CLIP_ID } from "../shared/bridge";
import type { Pick } from "./rower-stats";

const SEAT = /^(?:[1-9]|rower)$/;

export type Route = { page: "clips" } | { page: "clip"; id: string } | { page: "add" } | { page: "analysis"; id: string } | { page: "settings" } | { page: "guide" } | { page: "compare"; first: string; second: string }
  | { page: "rowers"; first: Pick; second: Pick | null };

/** Pages live in the address's hash, so moving between them never leaves the app. */
export function readRoute(hash: string): Route {
  const [, page, id, other, more, last] = hash.replace(/^#/, "").split("/");
  if (page === "rowers" && id && CLIP_ID.test(id) && other && SEAT.test(other)) {
    const first = { clip: id, seat: other };
    if (more === undefined) return { page: "rowers", first, second: null };
    if (CLIP_ID.test(more) && last && SEAT.test(last) && !(more === id && last === other)) return { page: "rowers", first, second: { clip: more, seat: last } };
  }
  if (page === "compare" && id && other && id !== other && CLIP_ID.test(id) && CLIP_ID.test(other)) return { page: "compare", first: id, second: other };
  if (page === "clip" && id && CLIP_ID.test(id)) return { page: "clip", id };
  if (page === "settings") return { page: "settings" };
  if (page === "add") return { page: "add" };
  if (page === "guide") return { page: "guide" };
  if (page === "analysis" && id && CLIP_ID.test(id)) return { page: "analysis", id };
  return { page: "clips" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => readRoute(window.location.hash));
  useEffect(() => {
    const changed = () => {
      setRoute(readRoute(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  return route;
}
