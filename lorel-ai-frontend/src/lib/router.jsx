import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/* A small client-side router: the app has four pages, which doesn't justify a
   routing library. Paths are real URLs (the API serves index.html for them). */

const RouterContext = createContext(null);

const readLocation = () => ({
  path: window.location.pathname,
  search: window.location.search,
  hash: window.location.hash,
});

export function RouterProvider({ children }) {
  const [location, setLocation] = useState(readLocation);

  useEffect(() => {
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    const url = new URL(to, window.location.origin);
    const samePage = url.pathname === window.location.pathname;
    window.history[replace ? "replaceState" : "pushState"](null, "", url.pathname + url.search + url.hash);
    setLocation(readLocation());
    if (!url.hash && !samePage) window.scrollTo(0, 0);
  }, []);

  const value = useMemo(
    () => ({ ...location, query: new URLSearchParams(location.search), navigate }),
    [location, navigate]
  );
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRouter() {
  return useContext(RouterContext);
}

/** An <a> that navigates without a page load (modifier-clicks still open new tabs). */
export function Link({ to, onClick, ...props }) {
  const { navigate } = useRouter();
  return (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.target
        ) {
          return;
        }
        event.preventDefault();
        navigate(to);
      }}
    />
  );
}
