const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

class Element {
  constructor(key = '') {
    this.dataset = key ? { key } : {};
    this.textContent = '';
    this.scrollWidth = 0;
    this.clientWidth = 1000;
    this.scrollLeft = 0;
    this.hidden = false;
    this.listeners = {};
    const classes = new Set();
    this.classList = {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, force) {
        const shouldHave = force === undefined ? !classes.has(name) : Boolean(force);
        if (shouldHave) classes.add(name); else classes.delete(name);
        return shouldHave;
      },
      contains(name) { return classes.has(name); }
    };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (this.listeners.click) this.listeners.click({ preventDefault() {} }); }
}

function makeApp(persistentStorage = new Map()) {
  const keys = [...html.matchAll(/<button\b[^>]*\bdata-key="([^"]+)"[^>]*>/g)].map((m) => new Element(m[1]));
  const byId = new Map();
  for (const id of ['expressionText', 'resultText', 'statusMode', 'statusAngle', 'statusFlags', 'statusMemory', 'statusHistory', 'statusSteps', 'liveMessage', 'installButton']) {
    byId.set(id, new Element());
  }
  const lcd = new Element();
  const documentListeners = {};
  const windowListeners = {};
  const vibrationDurations = [];
  let timerId = 0;
  const document = {
    body: new Element(),
    querySelector(selector) { return selector === '.lcd' ? lcd : null; },
    querySelectorAll(selector) {
      if (selector === '[data-key]') return keys;
      return [];
    },
    getElementById(id) { return byId.get(id) || null; },
    addEventListener(name, callback) { documentListeners[name] = callback; }
  };
  const navigator = { vibrate(ms) { vibrationDurations.push(ms); return true; } };
  const timers = new Map();
  let timerNow = 0;
  const localStorage = {
    getItem(key) { return persistentStorage.has(key) ? persistentStorage.get(key) : null; },
    setItem(key, value) { persistentStorage.set(key, String(value)); },
    removeItem(key) { persistentStorage.delete(key); }
  };
  const window = {
    localStorage,
    setTimeout(callback, delay = 0) {
      const id = ++timerId;
      timers.set(id, { at: timerNow + Math.max(0, Number(delay) || 0), callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      timerNow += ms;
      while (true) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= timerNow).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
      }
    },
    addEventListener(name, callback) { windowListeners[name] = callback; }
  };
  const context = vm.createContext({
    document, window, navigator, location: { protocol: 'https:' },
    console, Math, Number, Object, Array, String, Boolean, RegExp, Error
  });
  vm.runInContext(script, context, { filename: 'app.js' });
  return {
    press(key) {
      const button = keys.find((candidate) => candidate.dataset.key === String(key));
      assert.ok(button, `No on-screen key found for ${key}`);
      button.click();
    },
    pressMany(...items) { for (const item of items) this.press(item); },
    result() { return byId.get('resultText').textContent; },
    expression() { return byId.get('expressionText').textContent; },
    mode() { return byId.get('statusMode').textContent; },
    angle() { return byId.get('statusAngle').textContent; },
    flags() { return byId.get('statusFlags').textContent; },
    memory() { return byId.get('statusMemory').textContent; },
    isOff() { return lcd.classList.contains('is-off'); },
    advance(ms) { window.advance(ms); },
    historyIndicators() { return byId.get('statusHistory').textContent; },
    steps() { return byId.get('statusSteps').textContent; },
    storage: persistentStorage,
    vibrations: vibrationDurations
  };
}

const app = makeApp();
let passed = 0;
function test(name, callback) {
  callback();
  passed += 1;
  console.log(`✓ ${name}`);
}
function closeTo(actual, expected, epsilon = 1e-8) {
  const value = Number(String(actual).replace(/,/g, ''));
  assert.ok(Math.abs(value - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}
function clear() { app.press('ac'); }
function setAngle(angleKey) {
  app.press('mode');
  app.press('mode');
  app.press(angleKey);
}
function setDisplayDigits(modeKey, digits) {
  app.press('mode'); app.press('mode'); app.press('mode');
  app.press(modeKey);
  for (const digit of String(digits)) app.press(digit);
  if (String(digits).length > 1) app.press('equals');
}
function enterNumber(value) {
  for (const character of String(value)) {
    app.press(character === '.' ? 'decimal' : character === '-' ? 'negative' : character);
  }
}
function addRegressionPair(x, y) {
  enterNumber(x); app.press('comma'); enterNumber(y); app.press('mplus'); // DT
}
function selectRegressionType(number) {
  app.press('mode'); app.press('3');
  if (number >= 4) { app.press('shift'); app.press(String(number - 3)); }
  else app.press(String(number));
}
function regressionValueMenu(primaryKey, option) {
  app.press('shift'); app.press(primaryKey); app.press(option);
}

// Basic arithmetic and the higher-priority function families.
test('basic arithmetic respects precedence and parentheses', () => {
  clear(); app.pressMany('2', 'plus', '3', 'multiply', '4', 'equals');
  assert.equal(app.result(), '14');
  clear(); app.pressMany('open', '2', 'plus', '3', 'close', 'multiply', '4', 'equals');
  assert.equal(app.result(), '20');
});

test('squares, reciprocal, roots, cube roots, factorial, powers and nCr/nPr', () => {
  clear(); app.pressMany('5', 'square', 'equals'); assert.equal(app.result(), '25');
  clear(); app.pressMany('sqrt', '9', 'equals'); assert.equal(app.result(), '3');
  clear(); app.pressMany('2', 'cube', 'equals'); assert.equal(app.result(), '8');
  clear(); app.pressMany('shift', 'cube', '2', '7', 'equals'); assert.equal(app.result(), '3');
  clear(); app.pressMany('5', 'shift', 'inverse', 'equals'); assert.equal(app.result(), '120');
  clear(); app.pressMany('5', 'ncr', '2', 'equals'); assert.equal(app.result(), '10');
  clear(); app.pressMany('5', 'shift', 'ncr', '2', 'equals'); assert.equal(app.result(), '20');
  clear(); app.pressMany('2', 'power', '3', 'equals'); assert.equal(app.result(), '8');
  clear(); app.pressMany('3', 'shift', 'power', '2', '7', 'equals'); closeTo(app.result(), 3);
  clear(); app.pressMany('4', 'inverse', 'equals'); closeTo(app.result(), 0.25);
});

test('trigonometric, inverse and hyperbolic functions follow the selected angle unit', () => {
  clear(); app.pressMany('sin', '3', '0', 'equals'); closeTo(app.result(), 0.5);
  clear(); app.pressMany('shift', 'sin', '1', 'equals'); closeTo(app.result(), 90);
  clear(); app.pressMany('hyp', 'sin', '1', 'equals'); closeTo(app.result(), Math.sinh(1));
  setAngle('2'); assert.equal(app.angle(), 'RAD');
  clear(); app.pressMany('sin', '1', 'equals'); closeTo(app.result(), Math.sin(1));
  setAngle('1'); assert.equal(app.angle(), 'DEG');
});

test('exponential, logarithmic, percentage and Rnd functions work', () => {
  clear(); app.pressMany('log', '1', '0', '0', 'equals'); assert.equal(app.result(), '2');
  clear(); app.pressMany('ln', '1', 'equals'); assert.equal(app.result(), '0');
  clear(); app.pressMany('shift', 'log', '2', 'equals'); assert.equal(app.result(), '100');
  clear(); app.pressMany('1', '5', '0', '0', 'multiply', '1', '2', 'shift', 'equals', 'equals'); assert.equal(app.result(), '180');
  setDisplayDigits('1', 2);
  clear(); app.pressMany('1', 'divide', '3', 'shift', '0');
  assert.equal(app.result(), '0.33');
  assert.match(app.flags(), /FIX/);
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('3'); app.press('1');
});

test('fraction entry, decimal conversion, mixed/improper display and setup format', () => {
  clear(); app.pressMany('1', 'fraction', '2', 'equals'); assert.equal(app.result(), '1/2');
  app.press('fraction'); assert.equal(app.result(), '0.5');
  app.press('fraction'); assert.equal(app.result(), '1/2');
  clear(); app.pressMany('2', 'decimal', '7', '5', 'equals'); assert.equal(app.result(), '2.75');
  app.press('fraction'); assert.equal(app.result(), '2 3/4');
  app.press('fraction'); assert.equal(app.result(), '2.75');
  clear(); app.pressMany('7', 'fraction', '2', 'equals'); assert.equal(app.result(), '3 1/2');
  app.press('shift'); app.press('fraction'); assert.equal(app.result(), '7/2');
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('mode'); app.press('2');
  clear(); app.pressMany('1', 'fraction', '2', 'fraction', '3', 'equals');
  assert.equal(app.result(), 'Math ERROR');
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('mode'); app.press('1');
});

test('DMS entry and displayed-value conversion use degree-minute-second notation', () => {
  clear(); app.pressMany('1', '2', 'dms', '3', '4', 'dms', '5', '6', 'dms', 'equals');
  closeTo(app.result(), 12 + 34 / 60 + 56 / 3600);
  app.press('shift'); app.press('dms');
  assert.equal(app.result(), '12° 34′ 56″');
  app.press('dms');
  closeTo(app.result(), 12 + 34 / 60 + 56 / 3600);
});

test('DRG▶ converts the displayed angle without changing the selected unit', () => {
  clear(); app.pressMany('1', '8', '0', 'equals', 'shift', 'ans', '2');
  closeTo(app.result(), Math.PI);
  assert.equal(app.angle(), 'DEG');
});

test('Pol/Rec convert coordinates and save their results to E and F', () => {
  clear(); app.pressMany('polar', '3', 'comma', '4', 'close', 'equals');
  closeTo(app.result().split(';')[0], 5);
  closeTo(app.result().split(';')[1], Math.atan2(4, 3) * 180 / Math.PI);
  clear(); app.pressMany('alpha', 'cos', 'equals'); closeTo(app.result(), 5);
  clear(); app.pressMany('alpha', 'tan', 'equals'); closeTo(app.result(), Math.atan2(4, 3) * 180 / Math.PI);
  clear(); app.pressMany('shift', 'polar', '2', 'comma', '6', '0', 'close', 'equals');
  closeTo(app.result().split(';')[0], 1);
  closeTo(app.result().split(';')[1], Math.sqrt(3));
});

test('memory store/recall, Alpha variables including E, and M+/M− are functional', () => {
  clear(); app.press('7'); app.press('shift'); app.press('rcl'); app.press('negative');
  assert.equal(app.memory(), '');
  clear(); app.press('rcl'); app.press('negative'); app.press('equals'); assert.equal(app.result(), '7');
  clear(); app.pressMany('9', 'shift', 'rcl', 'cos');
  clear(); app.pressMany('alpha', 'cos', 'equals'); assert.equal(app.result(), '9');
  clear(); app.pressMany('5', 'mplus'); assert.equal(app.memory(), 'M');
  clear(); app.pressMany('2', 'shift', 'mplus');
  clear(); app.pressMany('rcl', 'mplus', 'equals'); assert.equal(app.result(), '3');
});

test('SD mode registers data with DT, repeats the last value, and recalls statistics', () => {
  clear(); app.press('mode'); app.press('2');
  app.press('2'); app.press('mplus'); app.press('4'); app.press('mplus'); app.press('mplus');
  app.press('shift'); app.press('2'); app.press('1'); closeTo(app.result(), 10 / 3);
  app.press('shift'); app.press('1'); app.press('3'); assert.equal(app.result(), '3');
  app.press('shift'); app.press('1'); app.press('2'); assert.equal(app.result(), '10');
});

test('REG mode fits a line and evaluates regression predictions', () => {
  clear(); app.press('mode'); app.press('3'); app.press('1');
  app.pressMany('1', 'comma', '3', 'mplus');
  app.pressMany('2', 'comma', '5', 'mplus');
  app.press('shift'); app.press('2'); app.press('7'); assert.equal(app.result(), '1');
  app.press('shift'); app.press('2'); app.press('8'); assert.equal(app.result(), '2');
  clear(); app.press('3'); app.press('shift'); app.press('2'); app.press('0'); app.press('3');
  assert.equal(app.result(), '7');
});

test('Log, exponential, power, inverse and quadratic REG modes calculate coefficients and estimates', () => {
  selectRegressionType(2);
  addRegressionPair(1, 1); addRegressionPair(10, 3);
  app.press('shift'); app.press('2'); app.press('7'); closeTo(app.result(), 1);

  selectRegressionType(3);
  addRegressionPair(0, 1); addRegressionPair(1, 2);
  clear(); app.press('2'); app.press('shift'); app.press('2'); app.press('0'); app.press('3'); closeTo(app.result(), 4);

  selectRegressionType(4);
  addRegressionPair(1, 2); addRegressionPair(2, 4);
  clear(); app.press('3'); app.press('shift'); app.press('2'); app.press('0'); app.press('3'); closeTo(app.result(), 6);

  selectRegressionType(5);
  addRegressionPair(1, 3); addRegressionPair(2, 2);
  clear(); app.pressMany('1', 'decimal', '5', 'shift', '2', '0', '2'); closeTo(app.result(), 4);

  selectRegressionType(6);
  addRegressionPair(0, 1); addRegressionPair(1, 4); addRegressionPair(2, 9);
  app.press('shift'); app.press('2'); app.press('0'); app.press('1'); closeTo(app.result(), 1);
  clear(); app.press('3'); app.press('shift'); app.press('2'); app.press('0'); app.press('2'); closeTo(app.result(), 16);
  clear(); app.press('9'); app.press('shift'); app.press('2'); app.press('0'); app.press('3'); closeTo(app.result(), 2);
  clear(); app.press('9'); app.press('shift'); app.press('2'); app.press('0'); app.press('4'); closeTo(app.result(), -4);
});

test('MODE pages configure angle, Fix/Sci/Norm, fraction format and decimal separator', () => {
  clear(); app.press('mode'); app.press('mode'); app.press('2'); assert.equal(app.angle(), 'RAD');
  app.press('mode'); app.press('1');
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('1'); app.press('2');
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('mode'); app.press('mode'); app.press('2');
  clear(); app.pressMany('1', 'decimal', '2', '3', '4', 'equals');
  assert.equal(app.result(), '1,23');
  assert.match(app.flags(), /FIX/);
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('2'); app.press('4'); app.press('equals');
  clear(); app.pressMany('1', '2', '3', '4', 'equals');
  assert.equal(app.result(), '1,234e3');
  assert.match(app.flags(), /SCI/);
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('3'); app.press('2');
  clear(); app.pressMany('sqrt', '0', 'decimal', '0', '0', '0', '0', '2', '5', 'equals');
  assert.equal(app.result(), '0,005');
  app.press('mode'); app.press('mode'); app.press('mode'); app.press('3'); app.press('1');
  clear(); app.pressMany('sqrt', '0', 'decimal', '0', '0', '0', '0', '2', '5', 'equals');
  assert.equal(app.result(), '5e-3');
});

test('Ans and engineering notation keys reuse and shift displayed results', () => {
  clear(); app.pressMany('2', 'plus', '3', 'equals', 'multiply', '2', 'equals');
  assert.equal(app.result(), '10');
  clear(); app.pressMany('1', '0', '0', '0', 'equals', 'eng');
  assert.equal(app.result(), '1×10^3');
  app.press('eng');
  assert.equal(app.result(), '1.000×10^0');
  clear(); app.pressMany('1', '2', '3', 'equals', 'shift', 'eng');
  assert.equal(app.result(), '0,123×10^3');
  app.press('shift'); app.press('eng');
  assert.equal(app.result(), '0,000123×10^6');
});

test('Ran# is bounded to 0.000–0.999, cursor/replay and haptic taps are connected', () => {
  clear(); app.press('shift'); app.press('decimal'); app.press('equals');
  const randomNumber = Number(app.result().replace(',', '.'));
  assert.ok(randomNumber >= 0 && randomNumber <= 0.999);
  clear(); app.pressMany('2', 'plus', '3', 'equals'); app.press('up'); assert.match(app.expression(), /2\+3/);
  assert.ok(app.vibrations.length > 0);
  assert.ok(app.vibrations.every((duration) => duration === 8));
});

// Manual-derived edge cases and lifecycle behavior.
function openSetupPage(page, choice) {
  app.press('mode');
  for (let index = 0; index < page; index++) app.press('mode');
  app.press(String(choice));
}
function selectSDMode() {
  app.press('mode');
  app.press('2');
}
function selectCOMPMode() {
  if (app.mode() !== 'COMP') { app.press('mode'); app.press('1'); }
}
function recallStatSum(choice) { app.press('shift'); app.press('1'); app.press(String(choice)); }
function recallStatVar(choice) { app.press('shift'); app.press('2'); app.press(String(choice)); }
function registerSD(value, frequency) {
  enterNumber(value);
  if (frequency !== undefined) {
    app.press('shift'); app.press('comma'); enterNumber(frequency);
  }
  app.press('mplus'); // DT in SD/REG
}

test('unary-minus priority, implicit multiplication, omitted final parenthesis, and recovery', () => {
  clear(); app.pressMany('negative', '2', 'power', '4', 'equals'); assert.equal(app.result(), '-16');
  clear(); app.pressMany('open', 'negative', '2', 'close', 'power', '4', 'equals'); assert.equal(app.result(), '16');
  clear(); app.pressMany('2', 'open', '3', 'plus', '4', 'close', 'equals'); assert.equal(app.result(), '14');
  clear(); app.pressMany('sqrt', 'open', '9', 'equals'); assert.equal(app.result(), '3');
  clear(); app.pressMany('1', 'plus', 'equals'); assert.equal(app.result(), 'Syntax ERROR');
  app.press('4'); app.press('equals'); assert.equal(app.result(), '4');
});

test('exact fractions, Ans fraction continuation, decimal mixing, and manual percent examples', () => {
  openSetupPage(4, 1); // Dot decimal-point mode
  clear(); app.pressMany('1', 'fraction', '3', 'plus', '1', 'fraction', '3', 'equals'); assert.equal(app.result(), '2/3');
  app.press('plus'); app.pressMany('1', 'fraction', '3', 'equals'); assert.equal(app.result(), '1');
  clear(); app.pressMany('0', 'decimal', '1', 'plus', '0', 'decimal', '2', 'equals'); assert.equal(app.result(), '0.3');
  clear(); app.pressMany('1', 'decimal', '5', 'plus', '1', 'fraction', '2', 'equals'); assert.equal(app.result(), '2');
  clear(); app.pressMany('2', '5', '0', '0', 'plus', '1', '5', 'shift', 'equals', 'equals'); assert.equal(app.result(), '2,875');
  clear(); app.pressMany('3', '5', '0', '0', 'minus', '2', '5', 'shift', 'equals', 'equals'); assert.equal(app.result(), '2,625');
  clear(); app.pressMany('1', '2', 'shift', 'equals', 'equals'); assert.equal(app.result(), '0.12');
});

test('colon multi-statements evaluate left-to-right and preserve replay history', () => {
  clear();
  app.pressMany('2', 'plus', '3', 'alpha', 'polar', 'ans', 'multiply', '2', 'equals');
  assert.equal(app.result(), '10');
  assert.match(app.historyIndicators(), /↑/);
  app.press('up'); assert.match(app.expression(), /2\+3:Ans×2/);
  app.press('down');
  assert.match(app.expression(), /2\+3:Ans×2/);
});

test('79-step entry cap, warning cursor, status count, and AC history reset', () => {
  clear();
  for (let index = 0; index < 72; index++) app.press('1');
  assert.equal(app.steps(), '72/79');
  app.press('1');
  assert.equal(app.steps(), '73/79');
  assert.match(app.expression(), /■/);
  for (let index = 0; index < 6; index++) app.press('1');
  assert.equal(app.steps(), '79/79');
  const before = app.expression();
  app.press('1');
  assert.equal(app.steps(), '79/79');
  assert.equal(app.expression(), before);
  assert.match(app.flags(), /79 STEP LIMIT/);
  app.press('ac');
  assert.equal(app.steps(), '');
  assert.equal(app.historyIndicators(), '');
});

test('stack, range, divide-by-zero, factorial and permutation errors recover cleanly', () => {
  clear();
  for (let index = 0; index < 25; index++) app.press('sqrt');
  app.press('1'); app.press('equals'); assert.equal(app.result(), 'Stack ERROR');
  app.press('7'); app.press('equals'); assert.equal(app.result(), '7');
  clear(); app.pressMany('1', 'divide', '0', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.pressMany('7', '0', 'shift', 'inverse', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.pressMany('1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0', 'ncr', '0', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.pressMany('1', 'exp', '1', '0', '0', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.pressMany('1', 'exp', 'negative', '1', '0', '0', 'equals'); assert.equal(app.result(), 'Math ERROR');
});

test('SD manual dataset: frequency, DT repeat, count, sums, mean and sample/population deviations', () => {
  clear(); selectSDMode();
  registerSD(55); registerSD(54); registerSD(51); registerSD(55); registerSD(53);
  app.press('mplus'); // DT twice repeats the currently entered 53
  registerSD(54); registerSD(52);
  recallStatSum(3); assert.equal(app.result(), '8');
  recallStatSum(2); assert.equal(app.result(), '427');
  recallStatSum(1); assert.equal(app.result(), '22,805');
  recallStatVar(1); assert.equal(app.result(), '53.375');
  recallStatVar(2); closeTo(app.result(), 1.316956719);
  recallStatVar(3); closeTo(app.result(), 1.407885953);
});

test('SD frequency entry, data browsing/edit replacement, CL deletion, and mode-change lifecycle', () => {
  clear(); selectSDMode();
  registerSD(110, 10);
  recallStatSum(3); assert.equal(app.result(), '10');
  recallStatVar(1); assert.equal(app.result(), '110');

  clear(); selectSDMode(); registerSD(10); registerSD(20);
  app.press('up'); // select the most recently entered datum
  enterNumber(30);
  app.press('equals'); // = replaces the selected datum
  app.press('ac'); // AC exits the data display without clearing statistics
  recallStatSum(3); assert.equal(app.result(), '2');
  recallStatVar(1); assert.equal(app.result(), '20');

  app.press('up'); app.press('shift'); app.press('mplus'); // SHIFT+CL deletes displayed row
  app.press('ac');
  recallStatSum(3); assert.equal(app.result(), '1');
  app.press('mode'); app.press('3'); app.press('1'); // changing mode/type clears editable data
  recallStatSum(3); assert.equal(app.result(), 'NO DATA');
});

test('official linear-regression example coefficients, correlation and estimates', () => {
  selectRegressionType(1);
  addRegressionPair(10, 1003); addRegressionPair(15, 1005); addRegressionPair(20, 1010);
  addRegressionPair(25, 1011); addRegressionPair(30, 1014);
  recallStatVar(7); closeTo(app.result(), 997.4);
  recallStatVar(8); closeTo(app.result(), 0.56);
  recallStatVar(0); app.press('1'); closeTo(app.result(), 0.982607368);
  clear(); enterNumber(-5); app.press('shift'); app.press('2'); app.press('0'); app.press('3'); closeTo(app.result(), 994.6);
  clear(); enterNumber(1000); app.press('shift'); app.press('2'); app.press('0'); app.press('2'); closeTo(app.result(), 4.642857143);

  // The manual's sample covariance formula: (Σxy − n·x̄·ȳ)/(n−1) = 35.
  recallStatSum(6); assert.equal(app.result(), '101,000');
  clear(); app.press('mode'); app.press('1');
  app.pressMany('open', '1', '0', '1', '0', '0', '0', 'minus', '5', 'multiply', '2', '0', 'multiply', '1', '0', '0', '8', 'decimal', '6', 'close', 'divide', 'open', '5', 'minus', '1', 'close', 'equals');
  closeTo(app.result(), 35);
});

test('official quadratic-regression coefficients, y-hat and both x-hat roots', () => {
  selectRegressionType(6);
  addRegressionPair(29, 1.6); addRegressionPair(50, 23.5); addRegressionPair(74, 38.0);
  addRegressionPair(103, 46.4); addRegressionPair(118, 48.0);
  recallStatVar(7); closeTo(app.result(), -35.59856934, 1e-7);
  recallStatVar(8); closeTo(app.result(), 1.495939413, 1e-8);
  recallStatVar(0); app.press('1'); closeTo(app.result(), -0.00671629667, 1e-10);
  clear(); enterNumber(16); app.press('shift'); app.press('2'); app.press('0'); app.press('2'); closeTo(app.result(), -13.38291067, 1e-7);
  clear(); enterNumber(20); app.press('shift'); app.press('2'); app.press('0'); app.press('3'); closeTo(app.result(), 47.14556728, 1e-7);
  clear(); enterNumber(20); app.press('shift'); app.press('2'); app.press('0'); app.press('4'); closeTo(app.result(), 175.5872105, 1e-7);
});

test('DMS arithmetic and decimal↔sexagesimal conversion follow the manual examples', () => {
  if (app.mode() !== 'COMP') { app.press('mode'); app.press('1'); }
  clear();
  app.pressMany('2', 'dms', '2', '0', 'dms', '3', '0', 'dms', 'plus', '0', 'dms', '3', '9', 'dms', '3', '0', 'dms', 'equals');
  assert.equal(app.result(), '3° 00′ 00″');
  clear();
  app.pressMany('1', '2', 'dms', '3', '4', 'dms', '5', '6', 'dms', 'multiply', '3', 'decimal', '4', '5', 'equals');
  assert.equal(app.result(), '43° 24′ 31.2″');
  clear(); app.pressMany('2', 'decimal', '2', '5', '8', 'equals', 'shift', 'dms');
  assert.equal(app.result(), '2° 15′ 28.8″');
  app.press('dms'); assert.equal(app.result(), '2.258');
});

test('Android app is fully native Kotlin while the browser PWA remains separate', () => {
  const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
  const manifest = fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
  const activity = fs.readFileSync(path.join(root, 'app/src/main/java/com/arena/fx82ms/MainActivity.kt'), 'utf8');
  const engine = fs.readFileSync(path.join(root, 'app/src/main/java/com/arena/fx82ms/CalculatorEngine.kt'), 'utf8');
  const kotlinBuild = fs.readFileSync(path.join(root, 'build.gradle'), 'utf8');
  assert.match(kotlinBuild, /org\.jetbrains\.kotlin\.android/);
  assert.equal(fs.existsSync(path.join(root, 'app/src/main/java/com/arena/fx82ms/MainActivity.java')), false);
  assert.equal(fs.existsSync(path.join(root, 'app/src/main/assets')), false);
  assert.match(activity, /CalculatorEngine/);
  assert.match(activity, /createFunctionGrid/);
  assert.doesNotMatch(activity, /WebView|JavascriptInterface|loadUrl/);
  assert.doesNotMatch(engine, /android\.webkit|JavascriptInterface|WebView/);
  assert.match(sw, /fx82ms-calculator-v1\.1\.0/);
  assert.match(html, /user-scalable=no/);
  assert.match(css, /html, body\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.app-shell\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(manifest, /"display":\s*"fullscreen"/);
  assert.match(manifest, /"orientation":\s*"portrait"/);
  assert.match(activity, /createOneShot\(8L/);
  assert.match(activity, /WindowInsetsController\.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE/);
});

test('persistent calculator settings, variables, Ans, memory and SD dataset survive app recreation', () => {
  const saved = new Map();
  const first = makeApp(saved);
  first.press('mode'); first.press('mode'); first.press('2'); // RAD
  first.press('3'); first.press('shift'); first.press('rcl'); first.press('negative'); // STO A
  first.press('ac'); first.press('5'); first.press('mplus'); // independent M
  assert.equal(first.memory(), 'M');
  first.press('mode'); first.press('2'); // SD, new mode clears previous data
  first.press('8'); first.press('mplus');

  const reloaded = makeApp(saved);
  assert.equal(reloaded.mode(), 'SD');
  assert.equal(reloaded.angle(), 'RAD');
  assert.equal(reloaded.memory(), 'M');
  reloaded.press('shift'); reloaded.press('1'); reloaded.press('3');
  assert.equal(reloaded.result(), '1');
  reloaded.press('mode'); reloaded.press('1'); // switch to COMP to read the independent memory
  reloaded.press('ac'); reloaded.press('rcl'); reloaded.press('mplus'); reloaded.press('equals');
  assert.equal(reloaded.result(), '5');
  reloaded.press('ac'); reloaded.press('rcl'); reloaded.press('negative'); reloaded.press('equals');
  assert.equal(reloaded.result(), '3');
});

test('SD/REG data registration uses DT; equals evaluates and editing equals replaces', () => {
  selectSDMode(); clear(); enterNumber(2); app.press('equals');
  assert.equal(app.result(), '2');
  recallStatSum(3); assert.equal(app.result(), 'NO DATA');
  clear(); registerSD(2);
  recallStatSum(3); assert.equal(app.result(), '1');
});

test('independent-memory M indicator follows the stored nonzero value', () => {
  selectCOMPMode(); clear(); app.press('0'); app.press('shift'); app.press('rcl'); app.press('mplus');
  clear(); app.press('5'); app.press('mplus');
  assert.equal(app.memory(), 'M');
  app.press('shift'); app.press('mplus');
  assert.equal(app.memory(), '');
  clear(); app.press('0'); app.press('shift'); app.press('rcl'); app.press('mplus');
  assert.equal(app.memory(), '');
});

test('SD Data Full offers cancel or register-without-retaining, then blocks individual editing', () => {
  selectSDMode();
  for (let value = 1; value <= 80; value++) registerSD(value);
  assert.equal(app.result(), '80');

  registerSD(81);
  assert.equal(app.result(), 'PRESS AC TO CONTINUE');
  app.press('ac');
  assert.equal(app.result(), '1 CANCEL  2 REGISTER');
  app.press('1');
  assert.equal(app.result(), '80');
  recallStatSum(3); assert.equal(app.result(), '80');

  clear(); registerSD(81); app.press('ac'); app.press('2');
  assert.equal(app.result(), '81');
  app.press('up');
  assert.match(app.flags(), /DATA NOT STORED/);
  recallStatSum(3); assert.equal(app.result(), '81');
  recallStatSum(2); assert.equal(app.result(), '3,321');
  const reloaded = makeApp(app.storage);
  reloaded.press('up'); assert.match(reloaded.flags(), /DATA NOT STORED/);
  reloaded.press('shift'); reloaded.press('1'); reloaded.press('3');
  assert.equal(reloaded.result(), '81');
  clear(); registerSD(82); // Subsequent unretained entries need no second confirmation.
  assert.equal(app.result(), '82');
  recallStatSum(2); assert.equal(app.result(), '3,403');
});

test('unretained statistical data stops at the 10,000-record safety limit', () => {
  const saved = new Map([['fx82ms.calculator.state.v2', JSON.stringify({
    version: 2, mode: 'SD', statsRetained: false,
    stats: Array.from({ length: 10000 }, () => ({ x: 1, f: 1 }))
  })]]);
  const capped = makeApp(saved);
  capped.press('2'); capped.press('mplus');
  assert.equal(capped.result(), 'Data Full');
});

test('manual domain limits and argument errors cover tangent, hyperbolic, Pol/Rec, and powers', () => {
  selectCOMPMode(); setAngle('1');
  clear(); app.press('tan'); enterNumber(90); app.press('equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.press('sin'); enterNumber(9000000000); app.press('equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.press('hyp'); app.press('cos'); enterNumber(230.2585092); app.press('equals'); assert.ok(Number(app.result().replace(/,/g, '')) > 4e99);
  clear(); app.press('hyp'); app.press('cos'); enterNumber(230.2585093); app.press('equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.press('hyp'); app.press('shift'); app.press('tan'); enterNumber(0.9999999999); app.press('equals'); assert.ok(Number(app.result().replace(/,/g, '')) > 10);
  clear(); app.press('hyp'); app.press('shift'); app.press('tan'); enterNumber(1); app.press('equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.press('polar'); enterNumber(1); app.press('equals'); assert.equal(app.result(), 'Arg ERROR');
  clear(); app.pressMany('shift', 'polar', 'negative', '2', 'comma', '3', '0', 'close', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.pressMany('1', '0', 'power', '9', '9', 'equals'); closeTo(app.result(), 1e99, 1e90);
  clear(); app.pressMany('1', '0', 'power', '1', '0', '0', 'equals'); assert.equal(app.result(), 'Math ERROR');
  clear(); app.press('sqrt'); app.press('1'); app.press('exp'); app.pressMany('1', '0', '0'); app.press('equals'); assert.equal(app.result(), 'Math ERROR');
});

test('numeric and command stacks respect their 10-level and 24-level limits', () => {
  selectCOMPMode(); clear();
  for (let index = 0; index < 24; index++) app.press('sqrt');
  app.press('1'); app.press('equals'); assert.equal(app.result(), '1');
  clear();
  for (let index = 0; index < 25; index++) app.press('sqrt');
  app.press('1'); app.press('equals'); assert.equal(app.result(), 'Stack ERROR');

  const nestedSum = (levels) => {
    clear();
    for (let index = 0; index < levels; index++) app.pressMany('1', 'plus', 'open');
    app.press('1');
    for (let index = 0; index < levels; index++) app.press('close');
    app.press('equals');
  };
  nestedSum(10); assert.equal(app.result(), '11');
  nestedSum(11); assert.equal(app.result(), 'Stack ERROR');

  clear(); app.press('1');
  for (let index = 0; index < 10; index++) app.pressMany('power', '1');
  app.press('equals'); assert.equal(app.result(), '1');
  clear(); app.press('1');
  for (let index = 0; index < 11; index++) app.pressMany('power', '1');
  app.press('equals'); assert.equal(app.result(), 'Stack ERROR');
});

test('ON wakes the LCD, SHIFT+AC powers off, and ten minutes of inactivity auto-powers off', () => {
  selectCOMPMode(); clear(); app.press('3');
  app.press('shift'); app.press('ac');
  assert.equal(app.isOff(), true);
  const retainedExpression = app.expression();
  app.press('8'); assert.equal(app.expression(), retainedExpression);
  app.press('on'); assert.equal(app.isOff(), false);
  assert.match(app.expression(), /^3/);

  clear(); app.press('4');
  app.advance(599999); assert.equal(app.isOff(), false);
  app.advance(1); assert.equal(app.isOff(), true);
  app.press('on'); assert.equal(app.isOff(), false);
});

test('history replay trims entries to the manual-sized 150-byte buffer', () => {
  selectCOMPMode(); clear();
  for (let value = 1; value <= 4; value++) {
    for (let digit = 0; digit < 60; digit++) app.press(String(value));
    app.press('equals');
  }
  assert.match(app.historyIndicators(), /↑/);
  const replayed = new Set();
  for (let index = 0; index < 8; index++) {
    app.press('up'); replayed.add(app.expression());
  }
  assert.ok(replayed.size >= 1 && replayed.size < 4, `expected history trimming, retained ${replayed.size} entries`);
  clear(); assert.equal(app.historyIndicators(), '');
});

console.log(`\n${passed} calculator behavior tests passed.`);
