// jsdom lacks what the civitai elements and the viewer lean on; none of it is under test here.

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

if (typeof HTMLElement.prototype.attachInternals !== 'function') {
  HTMLElement.prototype.attachInternals = function attachInternals() {
    return {
      form: null,
      labels: [],
      willValidate: false,
      validity: { valid: true },
      validationMessage: '',
      states: new Set(),
      setFormValue() {},
      setValidity() {},
      checkValidity: () => true,
      reportValidity: () => true,
    } as unknown as ElementInternals;
  };
}

// jsdom's ElementInternals exists but cannot take a form value.
const internals = (globalThis as unknown as { ElementInternals?: { prototype: Record<string, unknown> } })
  .ElementInternals;
if (internals) {
  internals.prototype.setFormValue ??= () => {};
  internals.prototype.setValidity ??= () => {};
}

window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }) as MediaQueryList;

HTMLMediaElement.prototype.play ??= () => Promise.resolve();
HTMLMediaElement.prototype.pause ??= () => {};
HTMLMediaElement.prototype.load ??= () => {};
Element.prototype.scrollTo ??= function scrollTo() {};
Element.prototype.scrollIntoView ??= function scrollIntoView() {};
URL.createObjectURL ??= () => 'blob:stub';
URL.revokeObjectURL ??= () => {};

class IntersectionObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
globalThis.IntersectionObserver ??= IntersectionObserverStub as unknown as typeof IntersectionObserver;

export {};
HTMLDialogElement.prototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close(this: HTMLDialogElement) {
  this.open = false;
};
