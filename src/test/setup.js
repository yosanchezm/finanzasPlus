import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// findBy*/waitFor must outlast React.lazy chunk imports under parallel load.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver; Recharts' ResponsiveContainer needs one.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// Width-aware matchMedia stub: evaluates simple min-/max-width queries against window.innerWidth.
const evaluateQuery = (query) => {
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(query);
  const width = window.innerWidth;
  return (!min || width >= Number(min[1])) && (!max || width <= Number(max[1]));
};

window.matchMedia = (query) => ({
  get matches() { return evaluateQuery(query); },
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});

const defaultWidth = window.innerWidth;

afterEach(() => {
  cleanup();
  window.innerWidth = defaultWidth;
});
