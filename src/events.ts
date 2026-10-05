export function on(el: HTMLElement | null, type: string, handler: EventListener, opts?: AddEventListenerOptions): void { if (el) el.addEventListener(type, handler, opts); }
