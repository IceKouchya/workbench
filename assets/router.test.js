const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

class Container {
  constructor() {
    this.children = [];
    this.attributes = {};
    this._innerHTML = '';
  }

  get firstChild() {
    return this.children[0] || null;
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this.children = [];
    this._innerHTML = value;
    if (value) {
      this.appendChild({ html: value });
    }
  }

  appendChild(node) {
    if (node.children) {
      while (node.firstChild) {
        this.appendChild(node.firstChild);
      }
      return node;
    }
    if (node.parent) {
      node.parent.children.splice(node.parent.children.indexOf(node), 1);
    }
    node.parent = this;
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

function createNavigationEntry(route) {
  return {
    dataset: { route },
    attributes: {},
    classList: {
      active: false,
      toggle(name, value) {
        if (name === 'nav-entry--active') {
          this.active = value;
        }
      }
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

function createHarness(hash) {
  const root = new Container();
  const scripts = [];
  const listeners = {};
  const entries = ['home', 'tasks', 'planned-01', 'planned-02', 'planned-03']
    .map(createNavigationEntry);
  const document = {
    title: '',
    head: {
      appendChild(script) {
        scripts.push(script);
      }
    },
    getElementById() {
      return root;
    },
    querySelectorAll() {
      return entries;
    },
    createDocumentFragment() {
      return new Container();
    },
    createElement() {
      return {};
    }
  };
  const window = {
    location: {
      hash,
      replace(nextHash) {
        this.hash = nextHash;
      }
    },
    addEventListener(name, handler) {
      listeners[name] = handler;
    }
  };
  const source = fs.readFileSync(path.join(__dirname, 'router.js'), 'utf8');
  vm.runInNewContext(source, { Promise, document, window });

  return {
    document,
    entries,
    root,
    scripts,
    navigate(nextHash) {
      window.location.hash = nextHash;
      listeners.hashchange();
    },
    register(route, renderer) {
      window.WorkbenchViews.register(route, renderer);
      scripts.at(-1).onload();
    },
    failLatestScript() {
      scripts.at(-1).onerror();
    }
  };
}

async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}

test('retries a failed script load and updates loading and failure titles', async () => {
  const harness = createHarness('#tasks');

  assert.equal(harness.document.title, '工作台 | 个人待办 | 正在打开');
  harness.failLatestScript();
  await settle();
  assert.equal(harness.document.title, '工作台 | 个人待办 | 模块暂不可用');
  assert.match(harness.root.innerHTML, /模块暂不可用/);

  harness.navigate('#tasks');
  assert.equal(harness.scripts.length, 2);
});

test('maps planned-01 to its dedicated ledger view while planned-02 and planned-03 use the reserved view script', async () => {
  const ledger = createHarness('#planned-01');
  assert.equal(ledger.scripts.at(-1).src, 'assets/views/taobao-flash-sale-ledger.js');
  ledger.register('planned-01', (root) => { root.innerHTML = 'ledger'; });
  await settle();
  assert.equal(ledger.document.title, '工作台 | 淘宝闪购店铺台账');

  const planned02 = createHarness('#planned-02');
  const planned03 = createHarness('#planned-03');
  assert.equal(planned02.scripts.at(-1).src, 'assets/views/planned.js');
  assert.equal(planned03.scripts.at(-1).src, 'assets/views/planned.js');
});

test('restores an already rendered view without rerunning its renderer', async () => {
  const harness = createHarness('#tasks');
  let taskRenderCount = 0;

  harness.register('tasks', (root) => {
    taskRenderCount += 1;
    root.innerHTML = 'tasks';
  });
  await settle();
  harness.root.firstChild.localState = 'preserved';

  harness.navigate('#home');
  harness.register('home', (root) => {
    root.innerHTML = 'home';
  });
  await settle();

  harness.navigate('#tasks');
  assert.equal(taskRenderCount, 1);
  assert.equal(harness.root.firstChild.localState, 'preserved');
  assert.equal(harness.entries.find((entry) => entry.dataset.route === 'tasks').classList.active, true);
});
