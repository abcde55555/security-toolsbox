import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { Notification, NotificationStatus } from '@en18031/shared';
import { NotificationsApi } from '../api/endpoints';

/**
 * Global notification feed for the header bell.
 *
 * One dedicated socket connection listens to the platform-wide
 * `notification:new` broadcast; an initial fetch plus a slow poll reconcile
 * anything missed while disconnected (same push+poll+reconcile pattern as the
 * rest of the app).
 */
export function useNotifications(onNew?: (n: Notification) => void) {
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);
  const onNewRef = useRef(onNew);
  onNewRef.current = onNew;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [list, count] = await Promise.all([
        NotificationsApi.list(),
        NotificationsApi.unreadCount(),
      ]);
      setItems(list);
      setUnread(count.count);
    } catch {
      // bell is non-critical UI: swallow transport errors, keep last state
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const socket: Socket = io({ transports: ['websocket', 'polling'] });
    socket.on('notification:new', (payload: { notification?: Notification }) => {
      const n = payload?.notification;
      if (!n) return;
      setItems((prev) => (prev.some((x) => x.id === n.id) ? prev : [n, ...prev].slice(0, 50)));
      setUnread((c) => c + 1);
      onNewRef.current?.(n);
    });
    const poll = setInterval(() => {
      NotificationsApi.unreadCount()
        .then((r) => setUnread(r.count))
        .catch(() => undefined);
    }, 30_000);
    return () => {
      clearInterval(poll);
      socket.disconnect();
    };
  }, [refresh]);

  const setStatus = useCallback(
    async (id: string, status: NotificationStatus, snoozeHours?: number) => {
      await NotificationsApi.setStatus(id, status, snoozeHours);
      setItems((prev) =>
        prev.map((n) =>
          n.id === id
            ? { ...n, status, actedAt: status === 'accepted' || status === 'dismissed' ? new Date().toISOString() : n.actedAt }
            : n,
        ),
      );
      setUnread((c) => Math.max(0, c - (status !== 'unread' ? 1 : 0)));
    },
    [],
  );

  const markRead = useCallback((id: string) => setStatus(id, 'read').catch(() => undefined), [setStatus]);
  const dismiss = useCallback((id: string) => setStatus(id, 'dismissed').catch(() => undefined), [setStatus]);
  const snooze = useCallback(
    (id: string, hours = 8) => setStatus(id, 'snoozed', hours).catch(() => undefined),
    [setStatus],
  );
  /** Accept an AI sedimentation proposal; resolves to the created draft Skill key. */
  const acceptSkill = useCallback(async (id: string): Promise<string> => {
    const r = await NotificationsApi.acceptSkill(id);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, status: 'accepted' } : n)));
    setUnread((c) => Math.max(0, c - 1));
    return r.skill.skillKey;
  }, []);

  return { items, unread, loading, refresh, markRead, dismiss, snooze, acceptSkill };
}
