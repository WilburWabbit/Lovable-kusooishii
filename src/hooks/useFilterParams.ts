import { useSearchParams } from "react-router-dom";
import { useCallback } from "react";

/**
 * Manages filter/search state via URL search params so it persists across navigation.
 * Each key maps to a URL param. Default values are omitted from the URL to keep it clean.
 */
export function useFilterParams<T extends Record<string, string>>(
  defaults: T,
): [T, (key: keyof T, value: string) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = {} as T;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    values[key] = (searchParams.get(key as string) ?? defaults[key]) as T[keyof T];
  }

  const set = useCallback(
    (key: keyof T, value: string) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value === defaults[key]) {
          next.delete(key as string);
        } else {
          next.set(key as string, value);
        }
        return next;
      }, { replace: true });
    },
    [setSearchParams, defaults],
  );

  return [values, set];
}
