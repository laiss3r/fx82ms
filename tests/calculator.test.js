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
    this.classList = { add() {}, remove() {}, toggle() {} };
  }
  addEventListener(name, callback) { this.listeners[name] = callback; }
  click() { if (this.listeners.click) this.listeners.click({ preventDefault() {} }); }
}

function makeApp() {
  const keys = [...html.matchAll(/<button\b[^>]*\bdata-key="([^"]+)"[^>]*>/g)].map((m) => new Element(m[1]));
  const byId = new Map();
  for (const id of ['expressionText', 'resultText', 'statusMode', 'statusAngle', 'statusFlags', 'statusMemory', 'liveMessage', 'installButton']) {
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
  const window = {
    setTimeout() { return ++timerId; },
    clearTimeout() {},
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
  for (const character of String(value)) app.press(character === '.' ? 'decimal' : character);
}
function addRegressionPair(x, y) {
  enterNumber(x); app.press('comma'); enterNumber(y); app.press('equals');
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
  app.press('dms');
  assert.equal(app.result(), '12° 34′ 56.00″');
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

test('SD mode records data with equals, repeats the last value, and recalls statistics', () => {
  clear(); app.press('mode'); app.press('2');
  app.press('2'); app.press('equals'); app.press('4'); app.press('equals'); app.press('equals');
  app.press('shift'); app.press('2'); app.press('1'); closeTo(app.result(), 10 / 3);
  app.press('shift'); app.press('1'); app.press('3'); assert.equal(app.result(), '3');
  app.press('shift'); app.press('1'); app.press('2'); assert.equal(app.result(), '10');
});

test('REG mode fits a line and evaluates regression predictions', () => {
  clear(); app.press('mode'); app.press('3'); app.press('1');
  app.pressMany('1', 'comma', '3', 'equals');
  app.pressMany('2', 'comma', '5', 'equals');
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
  assert.match(app.result(), /×10\^6$/);
});

test('Ran# is bounded to 0.000–0.999, cursor/replay and haptic taps are connected', () => {
  clear(); app.press('shift'); app.press('exp'); app.press('equals');
  const randomNumber = Number(app.result().replace(',', '.'));
  assert.ok(randomNumber >= 0 && randomNumber <= 0.999);
  clear(); app.pressMany('2', 'plus', '3', 'equals'); app.press('up'); assert.match(app.expression(), /2\+3/);
  assert.ok(app.vibrations.length > 0);
  assert.ok(app.vibrations.every((duration) => duration === 8));
});

console.log(`\n${passed} calculator behavior tests passed.`);
