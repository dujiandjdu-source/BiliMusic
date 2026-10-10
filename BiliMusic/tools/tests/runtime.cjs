const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");

function createRuntime(overrides = {}, globals = {}) {
  const modules = new Map();
  const load = (name) => {
    const filename = path.resolve(root, name);
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
      fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const requireModule = (request) => {
      if (Object.hasOwn(overrides, request)) return overrides[request];
      if (!request.startsWith(".")) return require(request);
      const base = path.resolve(path.dirname(filename), request);
      const resolved = [base + ".ts", base + ".tsx", path.join(base, "index.ts")].find(fs.existsSync);
      if (!resolved) throw new Error(`Cannot resolve ${request} from ${filename}`);
      return load(path.relative(root, resolved).replaceAll("\\", "/"));
    };
    vm.runInNewContext(output, {
      require: requireModule, module, exports: module.exports,
      console, setTimeout, clearTimeout, URL, Blob, crypto: require("node:crypto").webcrypto,
      window: {}, ...globals,
    }, { filename });
    return module.exports;
  };
  return load;
}

function createHooks() {
  let cursor = 0, dirty = false, effects = [], render, result;
  const slots = [];
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) {
        slots[index] = { value: typeof initial === "function" ? initial() : initial };
        slots[index].set = (update) => {
          // React may replay an updater. These tests deliberately do so.
          if (typeof update === "function") update(slots[index].value);
          const next = typeof update === "function" ? update(slots[index].value) : update;
          if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
        };
      }
      return [slots[index].value, slots[index].set];
    },
    useRef(initial) { const index = cursor++; return slots[index] || (slots[index] = { current: initial }); },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) slots[index] = { callback, deps };
      return slots[index].callback;
    },
    useMemo(callback, deps) { return hooks.useCallback(callback, deps)(); },
    useEffect(callback, deps) {
      const index = cursor++;
      if (!slots[index] || !same(slots[index].deps, deps)) {
        const old = slots[index]; slots[index] = { deps };
        effects.push(() => { old?.cleanup?.(); slots[index].cleanup = callback(); });
      }
    },
  };
  function flush() {
    for (let attempt = 0; attempt < 40; attempt++) {
      cursor = 0; dirty = false; effects = []; result = render();
      effects.forEach((effect) => effect());
      if (!dirty) return result;
    }
    throw new Error("Unexpected render loop");
  }
  return {
    hooks,
    mount(callback) { render = callback; return flush(); },
    flush,
    get current() { return result; },
    async settle() { await new Promise(setImmediate); flush(); await new Promise(setImmediate); return flush(); },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const song = (id, extra = {}) => ({ id, title: id, artist: "artist", fileUrl: `blob:${id}`, lyrics: [{ time: 0, text: "lyrics" }], ...extra });

module.exports = { createRuntime, createHooks, deferred, song };
