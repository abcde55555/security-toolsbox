import type { CancelToken } from '@en18031/shared';

export function createCancelToken(): CancelToken & { cancel: () => void } {
  let resolveFn: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  let requested = false;
  const token: CancelToken = {
    promise,
    get isRequested() {
      return requested;
    },
  };
  return {
    ...token,
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
