import { useEffect, useState } from "react";
import { CLIP_ID } from "../shared/bridge";

export type Route = { page: "clips" } | { page: "clip"; id: string } | { page: "add" } | { page: "analysis"; id: string } | { page: "settings" };

/** Pages live in the address's hash, so moving between them never leaves the app. */
export function readRoute(hash: string): Route {
  const [, page, id] = hash.replace(/^#/, "").split("/");
  if (page === "clip" && id && CLIP_ID.test(id)) return { page: "clip", id };
  if (page === "settings") return { page: "settings" };
  if (page === "add") return { page: "add" };
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
