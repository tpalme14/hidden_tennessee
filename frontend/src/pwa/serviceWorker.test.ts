import { describe, expect, it, vi } from "vitest";
import type { RegisterSWOptions } from "virtual:pwa-register";
import {
  createServiceWorkerController,
  type ServiceWorkerEnvironment,
  type ServiceWorkerState,
} from "./serviceWorker";

/**
 * M06-T02 Increment 2 — the application-owned registration wrapper. A fake
 * register function stands in for vite-plugin-pwa's helper; real
 * registration, installation, and control are verified in the browser
 * (e2e/sw). The fake's `controllingAfterAcceptanceElsewhere` mirrors the
 * installed helper's prompt-mode behavior: it calls `onNeedReload()` when
 * supplied and otherwise reloads the page.
 */

const SUPPORTED: ServiceWorkerEnvironment = {
  isProduction: true,
  isSecureContext: true,
  hasServiceWorker: true,
};

function fakeRegister() {
  const calls: RegisterSWOptions[] = [];
  const updateServiceWorker = vi.fn(async () => {});
  const register = vi.fn((options: RegisterSWOptions) => {
    calls.push(options);
    return updateServiceWorker;
  });
  return {
    register,
    updateServiceWorker,
    options: () => {
      expect(calls).toHaveLength(1);
      return calls[0]!;
    },
  };
}

/** What the installed helper does on a `controlling` event after showing a prompt. */
function controllingAfterAcceptanceElsewhere(options: RegisterSWOptions, reloadPage: () => void) {
  if (options.onNeedReload) options.onNeedReload();
  else reloadPage();
}

describe("service-worker registration conditions", () => {
  it("registers once in a supported production environment, after load (not immediately)", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    expect(controller.register().registration).toBe("registering");
    expect(fake.register).toHaveBeenCalledTimes(1);
    expect(fake.options().immediate).toBe(false);
  });

  it.each<[string, Partial<ServiceWorkerEnvironment>, ServiceWorkerState["registration"]]>([
    ["a development build", { isProduction: false }, "skipped"],
    ["a browser without the service-worker API", { hasServiceWorker: false }, "unsupported"],
    ["an insecure context", { isSecureContext: false }, "unsupported"],
  ])("does not register in %s", (_label, patch, expected) => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(
      () => ({ ...SUPPORTED, ...patch }),
      fake.register,
    );
    expect(controller.register().registration).toBe(expected);
    expect(fake.register).not.toHaveBeenCalled();
  });

  it("is idempotent: repeated initialisation never registers twice", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    controller.register();
    controller.register();
    expect(fake.register).toHaveBeenCalledTimes(1);
  });

  it("records a successful registration", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    fake.options().onRegisteredSW?.("/sw.js", undefined);
    expect(controller.getState().registration).toBe("registered");
  });

  it("records an asynchronous registration failure without throwing", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    expect(() => fake.options().onRegisterError?.(new Error("blocked"))).not.toThrow();
    expect(controller.getState().registration).toBe("failed");
  });

  it("records a synchronous registration failure without throwing", () => {
    const controller = createServiceWorkerController(
      () => SUPPORTED,
      () => {
        throw new Error("register threw");
      },
    );
    expect(() => controller.register()).not.toThrow();
    expect(controller.getState().registration).toBe("failed");
  });
});

describe("service-worker lifecycle safeguards", () => {
  it("always supplies onNeedReload, so the helper never falls back to reloading the page", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    const options = fake.options();
    expect(typeof options.onNeedReload).toBe("function");

    const reloadPage = vi.fn();
    controllingAfterAcceptanceElsewhere(options, reloadPage);
    // Repeated controlling callbacks (one listener per prompt) are harmless.
    controllingAfterAcceptanceElsewhere(options, reloadPage);
    controllingAfterAcceptanceElsewhere(options, reloadPage);
    expect(reloadPage).not.toHaveBeenCalled();
    expect(controller.getState().updateActivatedElsewhere).toBe(true);
  });

  it("distinguishes the first installation from a waiting update", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    fake.options().onOfflineReady?.();
    expect(controller.getState()).toMatchObject({ offlineReady: true, updateWaiting: false });
    fake.options().onNeedRefresh?.();
    expect(controller.getState()).toMatchObject({ offlineReady: true, updateWaiting: true });
  });

  it("never accepts a waiting update or activates it automatically", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    controller.register();
    // Including a worker that was already waiting when the application started.
    fake.options().onNeedRefresh?.();
    fake.options().onNeedRefresh?.();
    expect(controller.getState().updateWaiting).toBe(true);
    expect(fake.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("notifies subscribers once per actual change and supports unsubscribing", () => {
    const fake = fakeRegister();
    const controller = createServiceWorkerController(() => SUPPORTED, fake.register);
    const seen: ServiceWorkerState[] = [];
    const unsubscribe = controller.subscribe((state) => seen.push(state));
    controller.register();
    fake.options().onNeedRefresh?.();
    fake.options().onNeedRefresh?.();
    expect(seen.map((s) => [s.registration, s.updateWaiting])).toEqual([
      ["registering", false],
      ["registering", true],
    ]);
    unsubscribe();
    fake.options().onRegisteredSW?.("/sw.js", undefined);
    expect(seen).toHaveLength(2);
  });
});
