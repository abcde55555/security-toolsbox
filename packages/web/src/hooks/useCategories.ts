import { useEffect, useState, useCallback } from 'react';
import type { ToolCategoryInfo } from '../api/endpoints';
import { CategoriesApi } from '../api/endpoints';

/**
 * Module-level cache + pub/sub so every component sees the same editable
 * category list without prop drilling. Falls back to the built-in labels
 * until the API responds.
 */

const FALLBACK: ToolCategoryInfo[] = [
  { key: 'network-compliance', label: '网络合规', sortOrder: 10, builtin: true },
  { key: 'crypto-compliance', label: '密码合规', sortOrder: 20, builtin: true },
  { key: 'credential-compliance', label: '凭证合规', sortOrder: 30, builtin: true },
  { key: 'firmware-analysis', label: '固件分析', sortOrder: 40, builtin: true },
  { key: 'authentication', label: '认证安全', sortOrder: 50, builtin: true },
  { key: 'reconnaissance', label: '侦察探测', sortOrder: 60, builtin: true },
  { key: 'other', label: '其他', sortOrder: 999, builtin: true },
];

let cache: ToolCategoryInfo[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function setCache(next: ToolCategoryInfo[]) {
  cache = next;
  emit();
}

let inflight: Promise<ToolCategoryInfo[]> | null = null;

export function refreshCategories(): Promise<ToolCategoryInfo[]> {
  inflight = CategoriesApi.list()
    .then((cats) => {
      setCache(cats.length ? cats : FALLBACK);
      return cache;
    })
    .catch(() => {
      if (cache.length === 0) setCache(FALLBACK);
      return cache;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useCategories() {
  const [cats, setCats] = useState<ToolCategoryInfo[]>(cache.length ? cache : FALLBACK);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const listener = () => setCats(cache.length ? [...cache] : FALLBACK);
    listeners.add(listener);
    if (cache.length === 0) {
      setLoading(true);
      refreshCategories().finally(() => setLoading(false));
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const labelOf = useCallback(
    (key?: string): string => cats.find((c) => c.key === key)?.label ?? key ?? '其他',
    [cats],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try { await refreshCategories(); } finally { setLoading(false); }
  }, []);

  return { categories: cats, loading, labelOf, refresh };
}

/** Synchronous label lookup (uses cache; safe to call outside React). */
export function categoryLabelOf(key?: string): string {
  const list = cache.length ? cache : FALLBACK;
  return list.find((c) => c.key === key)?.label ?? key ?? '其他';
}
