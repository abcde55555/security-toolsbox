import type { CancelToken } from '@en18031/shared';

export function createCancelToken(): CancelToken & { cancel: () => void } {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  let requested = false;
  return {
    promise,
    get isRequested() {
      return requested;
    },
    cancel: () => {
      requested = true;
      resolveFn();
    },
  };
}

export function alreadyCancelledToken(): CancelToken {
  return {
    promise: Promise.resolve(),
    isRequested: true,
  };
}
