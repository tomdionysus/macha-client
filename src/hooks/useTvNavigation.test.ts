// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSpatialTvNavigation, isTextEditingElement, tvRangeOwnsDirection, tvTextEditingOwnsCommand } from './useTvNavigation';

function element(tagName: string, options: { contentEditable?: boolean; role?: string; type?: string } = {}) {
  return {
    tagName,
    type: options.type,
    isContentEditable: options.contentEditable ?? false,
    getAttribute: (name: string) => name === 'role' ? options.role ?? null : null,
  };
}

describe('TV navigation editor policy', () => {
  it('leaves native editing controls in charge of keyboard input', () => {
    expect(isTextEditingElement(element('input'))).toBe(true);
    expect(isTextEditingElement(element('textarea'))).toBe(true);
    expect(isTextEditingElement(element('select'))).toBe(true);
    expect(isTextEditingElement(element('div', { contentEditable: true }))).toBe(true);
    expect(isTextEditingElement(element('div', { role: 'textbox' }))).toBe(true);
  });

  it('continues spatial navigation from ordinary controls', () => {
    expect(isTextEditingElement(element('button'))).toBe(false);
    expect(isTextEditingElement(element('a'))).toBe(false);
    expect(isTextEditingElement(undefined)).toBe(false);
    expect(isTextEditingElement(element('input', { type: 'range' }))).toBe(false);
  });

  it('leaves range Left/Right to seeking but routes Up/Down through focus navigation', () => {
    const range = element('input', { type: 'range' });
    expect(tvRangeOwnsDirection(range, 'left')).toBe(true);
    expect(tvRangeOwnsDirection(range, 'right')).toBe(true);
    expect(tvRangeOwnsDirection(range, 'up')).toBe(false);
    expect(tvRangeOwnsDirection(range, 'down')).toBe(false);
  });
});

describe('attachSpatialTvNavigation', () => {
  let detach: (() => void) | undefined;
  let top: HTMLButtonElement;
  let middle: HTMLButtonElement;
  let bottom: HTMLButtonElement;

  // jsdom reports every element's layout as zero-size by default; stub real,
  // vertically stacked rects so the geometry scorer (not the DOM-order
  // fallback) is what this test actually exercises.
  function stackRect(element: HTMLElement, top: number) {
    element.getBoundingClientRect = () => ({
      top, bottom: top + 50, left: 0, right: 50, width: 50, height: 50, x: 0, y: top, toJSON: () => ({}),
    });
  }

  function press(key: string, keyCode: number) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  beforeEach(() => {
    document.body.innerHTML = `
      <button data-tv-focusable="true" id="top">Top</button>
      <button data-tv-focusable="true" id="middle">Middle</button>
      <button data-tv-focusable="true" id="bottom">Bottom</button>
    `;
    top = document.getElementById('top') as HTMLButtonElement;
    middle = document.getElementById('middle') as HTMLButtonElement;
    bottom = document.getElementById('bottom') as HTMLButtonElement;
    stackRect(top, 0);
    stackRect(middle, 100);
    stackRect(bottom, 200);
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    document.body.innerHTML = '';
  });

  it('selects the first focusable element on attach', () => {
    detach = attachSpatialTvNavigation();
    expect(top.getAttribute('data-tv-selected')).toBe('true');
    expect(document.activeElement).toBe(top);
  });

  it('moves selection down through visual order via ArrowDown', () => {
    // SamsungDpadInput suppresses a repeated command inside a short real-time
    // floor; advance a fake clock between presses so this test exercises
    // navigation, not that unrelated repeat-suppression policy.
    vi.useFakeTimers();
    try {
      detach = attachSpatialTvNavigation();
      press('ArrowDown', 40);
      expect(middle.getAttribute('data-tv-selected')).toBe('true');
      expect(top.getAttribute('data-tv-selected')).toBeNull();
      vi.advanceTimersByTime(200);
      press('ArrowDown', 40);
      expect(bottom.getAttribute('data-tv-selected')).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('activates the selected element with Enter', () => {
    detach = attachSpatialTvNavigation();
    const onClick = vi.fn();
    top.addEventListener('click', onClick);
    press('Enter', 13);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('routes a Back command to the supplied handler instead of moving focus', () => {
    const onBack = vi.fn(() => true);
    detach = attachSpatialTvNavigation(onBack);
    press('Back', 10009);
    expect(onBack).toHaveBeenCalledOnce();
    expect(top.getAttribute('data-tv-selected')).toBe('true');
  });

  it('stops responding to keys once detached', () => {
    detach = attachSpatialTvNavigation();
    detach();
    detach = undefined;
    press('ArrowDown', 40);
    expect(middle.getAttribute('data-tv-selected')).toBeNull();
  });

  describe('escaping a focused text field', () => {
    it('lets up and down leave a single-line input, so a search box is not a trap', () => {
      // There is no pointer on a TV: an input that swallows vertical
      // navigation can only be left with Back, which exits the screen.
      expect(tvTextEditingOwnsCommand(element('input'), 'up')).toBe(false);
      expect(tvTextEditingOwnsCommand(element('input'), 'down')).toBe(false);
    });

    it('still gives the input its caret keys and Enter', () => {
      expect(tvTextEditingOwnsCommand(element('input'), 'left')).toBe(true);
      expect(tvTextEditingOwnsCommand(element('input'), 'right')).toBe(true);
      expect(tvTextEditingOwnsCommand(element('input'), 'activate')).toBe(true);
    });

    it('lets up and down leave a multi-line or list editor too', () => {
      // The endpoints box is a textarea, and on the television it was a trap:
      // up and down moved the caret and nothing else, so the Save button below
      // it could not be reached at all. Between-controls beats between-lines
      // on a remote that has no other way of doing the former.
      for (const editor of [element('textarea'), element('select'), element('div', { contentEditable: true })]) {
        expect(tvTextEditingOwnsCommand(editor, 'up')).toBe(false);
        expect(tvTextEditingOwnsCommand(editor, 'down')).toBe(false);
        expect(tvTextEditingOwnsCommand(editor, 'left')).toBe(true);
        expect(tvTextEditingOwnsCommand(editor, 'right')).toBe(true);
      }
    });

    it('claims nothing when focus is not in an editor at all', () => {
      expect(tvTextEditingOwnsCommand(element('button'), 'up')).toBe(false);
      expect(tvTextEditingOwnsCommand(undefined, 'down')).toBe(false);
    });
  });
});

describe('a wide element beside smaller ones', () => {
  // The search row: a field spanning most of the width, then the sort and a
  // far refresh, with a row of result cards below. Centres misjudge it: most
  // cards' centres lie right of the field's centre.
  let detach: (() => void) | undefined;

  function place(id: string, left: number, top: number, width: number, height: number) {
    const node = document.getElementById(id) as HTMLElement;
    node.getBoundingClientRect = () => ({
      top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}),
    });
    return node;
  }

  function press(key: string, keyCode: number) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  function selected(): string | undefined {
    return document.querySelector('[data-tv-selected="true"]')?.id;
  }

  function layout(withSort: boolean) {
    document.body.innerHTML = `
      <button data-tv-focusable="true" id="field">Field</button>
      ${withSort ? '<button data-tv-focusable="true" id="sort">Sort</button>' : ''}
      <button data-tv-focusable="true" id="refresh">Refresh</button>
      <button data-tv-focusable="true" id="card-1">1</button>
      <button data-tv-focusable="true" id="card-2">2</button>
      <button data-tv-focusable="true" id="card-3">3</button>
      <button data-tv-focusable="true" id="card-4">4</button>
      <button data-tv-focusable="true" id="card-5">5</button>
      <button data-tv-focusable="true" id="card-6">6</button>
      <button data-tv-focusable="true" id="card-7">7</button>
      <button data-tv-focusable="true" id="card-8">8</button>
    `;
    place('field', 0, 0, 1200, 49);
    if (withSort) place('sort', 1216, 0, 213, 49);
    place('refresh', 1800, 0, 49, 49);
    for (let index = 0; index < 8; index += 1) place(`card-${index + 1}`, index * 160, 81, 150, 225);
  }

  afterEach(() => {
    detach?.();
    detach = undefined;
    document.body.innerHTML = '';
  });

  it('goes right from the field to the sort, not to a card below', () => {
    layout(true);
    detach = attachSpatialTvNavigation();
    expect(selected()).toBe('field');
    press('ArrowRight', 39);
    expect(selected()).toBe('sort');
  });

  it('goes right from the field to a far refresh on its row, over a near card below', () => {
    layout(false);
    detach = attachSpatialTvNavigation();
    press('ArrowRight', 39);
    expect(selected()).toBe('refresh');
  });

  it('goes right from a card to the next card', () => {
    layout(true);
    detach = attachSpatialTvNavigation();
    (document.getElementById('card-2') as HTMLElement).focus();
    press('ArrowRight', 39);
    expect(selected()).toBe('card-3');
  });

  it('goes down from the field into the results', () => {
    layout(true);
    detach = attachSpatialTvNavigation();
    press('ArrowDown', 40);
    expect(selected()).toMatch(/^card-/);
  });
});

describe('up and down go to the nearest row', () => {
  // Home: the top bar, a short Continue Watching row, and a longer Movies row
  // below. The Movies cards at the right have nothing directly above them in
  // Continue Watching; the only thing in their column is a nav item.
  let detach: (() => void) | undefined;

  function place(id: string, left: number, top: number, width: number, height: number) {
    const node = document.getElementById(id) as HTMLElement;
    node.getBoundingClientRect = () => ({
      top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}),
    });
  }

  function press(key: string, keyCode: number) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  function selected(): string | undefined {
    return document.querySelector('[data-tv-selected="true"]')?.id;
  }

  function home() {
    const ids = ['nav-home', 'nav-search', 'cw-0', 'cw-1', 'cw-2', 'movie-0', 'movie-1', 'movie-2', 'movie-3', 'movie-4'];
    document.body.innerHTML = ids.map((id) => `<button data-tv-focusable="true" id="${id}">${id}</button>`).join('');
    place('nav-home', 740, 20, 60, 40);
    place('nav-search', 1040, 20, 70, 40);
    [60, 290, 520].forEach((left, index) => place(`cw-${index}`, left, 140, 200, 330));
    [60, 290, 520, 745, 975].forEach((left, index) => place(`movie-${index}`, left, 640, 200, 320));
  }

  afterEach(() => {
    detach?.();
    detach = undefined;
    document.body.innerHTML = '';
  });

  it('goes up from a card with nothing above it to the nearest card in the row above, not the top bar', () => {
    home();
    detach = attachSpatialTvNavigation();
    (document.getElementById('movie-4') as HTMLElement).focus();
    press('ArrowUp', 38);
    expect(selected()).toBe('cw-2');
  });

  it('still goes up from the top row of cards into the top bar', () => {
    home();
    detach = attachSpatialTvNavigation();
    (document.getElementById('cw-0') as HTMLElement).focus();
    press('ArrowUp', 38);
    expect(selected()).toMatch(/^nav-/);
  });
});

describe('left and right stop at the end of a row', () => {
  let detach: (() => void) | undefined;

  function place(id: string, left: number, top: number, width: number, height: number) {
    const node = document.getElementById(id) as HTMLElement;
    node.getBoundingClientRect = () => ({
      top, bottom: top + height, left, right: left + width, width, height, x: left, y: top, toJSON: () => ({}),
    });
  }

  function press(key: string, keyCode: number) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, bubbles: true, cancelable: true } as KeyboardEventInit));
  }

  function selected(): string | undefined {
    return document.querySelector('[data-tv-selected="true"]')?.id;
  }

  beforeEach(() => {
    document.body.innerHTML = ['nav-home', 'nav-movies', 'card'].map((id) => `<button data-tv-focusable="true" id="${id}">${id}</button>`).join('');
    place('nav-home', 740, 20, 60, 40);
    place('nav-movies', 820, 20, 80, 40);
    place('card', 60, 140, 200, 330);
  });

  afterEach(() => {
    detach?.();
    detach = undefined;
    document.body.innerHTML = '';
  });

  it('stays on the first item of the top bar rather than dropping to a card below', () => {
    detach = attachSpatialTvNavigation();
    expect(selected()).toBe('nav-home');
    press('ArrowLeft', 37);
    expect(selected()).toBe('nav-home');
  });

  it('still moves along the row', () => {
    detach = attachSpatialTvNavigation();
    (document.getElementById('nav-movies') as HTMLElement).focus();
    press('ArrowLeft', 37);
    expect(selected()).toBe('nav-home');
  });
});
