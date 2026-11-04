/** The part of foliate-js the reader uses. The package ships no types. */
declare module 'foliate-js/view.js' {
  export interface FoliateLocation {
    /** How far through the whole book, 0 to 1. */
    fraction?: number;
    cfi: string;
    tocItem?: { label?: string };
  }

  export interface FoliateRenderer extends HTMLElement {
    setStyles?(styles: string): void;
    prev(): Promise<void>;
    next(): Promise<void>;
  }

  export interface FoliateView extends HTMLElement {
    renderer: FoliateRenderer;
    book?: { metadata?: { title?: unknown } };
    open(book: File | Blob): Promise<void>;
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>;
    goLeft(): Promise<void>;
    goRight(): Promise<void>;
    goToFraction(fraction: number): Promise<void>;
    close(): void;
  }
}
