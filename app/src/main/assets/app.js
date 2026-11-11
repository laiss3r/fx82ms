(() => {
  'use strict';

  if (location.protocol === 'file:' && document.body) document.body.classList.add('native-wrapper');

  const $ = (id) => document.getElementById(id);
  const screen = document.querySelector('.lcd');
  const expressionText = $('expressionText');
  const resultText = $('resultText');
  const statusMode = $('statusMode');
  const statusAngle = $('statusAngle');
  const statusFlags = $('statusFlags');
  const statusMemory = $('statusMemory');
  const liveMessage = $('liveMessage');

  const variableNames = ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y', 'M'];
  const alphaKey = {
    negative: 'A', dms: 'B', hyp: 'C', sin: 'D', cos: 'E', tan: 'F',
    open: 'X', close: 'Y', mplus: 'M'
  };

  const state = {
    on: true,
    expr: '',
    cursor: 0,
    resultValue: 0,
    resultText: '0',
    error: '',
    message: '',
    prompt: null,
    history: [],
    replayIndex: -1,
    draft: null,
    justEvaluated: false,
    shift: false,
    alpha: false,
    hyp: false,
    insertMode: false,
    angle: 'DEG',
    mode: 'COMP',
    regType: 'Lin',
    ans: 0,
    vars: Object.fromEntries(variableNames.map((key) => [key, 0])),
    memory: 0,
    pending: null,
    fractionView: 0,
    dmsDisplay: null,
    engineeringView: false,
    stats: [],
    regression: null,
    lastRegression: null
  };

  class CalcError extends Error {
    constructor(message = 'Math ERROR') { super(message); this.name = 'CalcError'; }
  }

  function speak(message) {
    if (!liveMessage) return;
    liveMessage.textContent = '';
    window.setTimeout(() => { liveMessage.textContent = message; }, 20);
  }

  function showMessage(message, duration = 1500) {
    state.message = message;
    speak(message);
    render();
    if (duration > 0) {
      window.clearTimeout(showMessage.timer);
      showMessage.timer = window.setTimeout(() => {
        if (state.message === message) {
          state.message = '';
          render();
        }
      }, duration);
    }
  }

  function cleanZero(value) {
    return Object.is(value, -0) || Math.abs(value) < 1e-14 ? 0 : value;
  }

  function formatNumber(value, significant = 10) {
    if (!Number.isFinite(value)) return 'Math ERROR';
    value = cleanZero(value);
    if (value === 0) return '0';
    const abs = Math.abs(value);
    if (abs >= 1e10 || abs < 1e-8) {
      return value.toExponential(Math.max(0, significant - 1)).replace(/\.?(?:0+)e/, 'e').replace('e+', 'e');
    }
    return String(Number(value.toPrecision(significant)));
  }

  function scalar(value) {
    if (value && typeof value === 'object' && value.__percent === true) return value.value;
    if (Array.isArray(value)) return scalar(value[0]);
    return Number(value);
  }

  function isPercent(value) {
    return Boolean(value && typeof value === 'object' && value.__percent === true);
  }

  function gcd(a, b) {
    a = Math.abs(Math.trunc(a)); b = Math.abs(Math.trunc(b));
    while (b) [a, b] = [b, a % b];
    return a || 1;
  }

  function rationalApproximation(value) {
    if (!Number.isFinite(value) || Math.abs(value) > 1e7) return null;
    const sign = value < 0 ? -1 : 1;
    const target = Math.abs(value);
    if (Math.abs(target - Math.round(target)) < 1e-10) return { n: sign * Math.round(target), d: 1 };
    let best = null;
    for (let d = 1; d <= 2000; d++) {
      const n = Math.round(target * d);
      const error = Math.abs(target - n / d);
      if (!best || error < best.error) best = { n, d, error };
      if (error < 1e-11) break;
    }
    if (!best || best.error > 1e-9) return null;
    const divisor = gcd(best.n, best.d);
    return { n: sign * best.n / divisor, d: best.d / divisor };
  }

  function formatFraction(value, mixed) {
    const ratio = rationalApproximation(value);
    if (!ratio) return formatNumber(value);
    const negative = ratio.n < 0;
    const absN = Math.abs(ratio.n);
    const d = ratio.d;
    const sign = negative ? '−' : '';
    if (d === 1) return `${sign}${absN}`;
    if (mixed && absN >= d) {
      const whole = Math.floor(absN / d);
      const remainder = absN % d;
      if (!remainder) return `${sign}${whole}`;
      return `${sign}${whole} ${remainder}/${d}`;
    }
    return `${sign}${absN}/${d}`;
  }

  function formatEngineering(value) {
    if (!Number.isFinite(value) || value === 0) return formatNumber(value);
    const exponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3;
    if (exponent === 0) return formatNumber(value);
    const mantissa = value / (10 ** exponent);
    return `${formatNumber(mantissa)}×10^${exponent}`;
  }

  function formatDMS(value) {
    if (!Number.isFinite(value)) return 'Math ERROR';
    const negative = value < 0 ? '−' : '';
    let absolute = Math.abs(value);
    const degrees = Math.floor(absolute);
    absolute = (absolute - degrees) * 60;
    const minutes = Math.floor(absolute);
    const seconds = Math.round((absolute - minutes) * 60 * 100) / 100;
    let secText = formatNumber(seconds, 5);
    if (seconds < 10) secText = `0${secText}`;
    return `${negative}${degrees}° ${minutes}′ ${secText}″`;
  }

  function formatResult(value) {
    if (state.dmsDisplay) return state.dmsDisplay;
    if (state.error) return state.error;
    if (state.prompt) return state.prompt.result;
    if (Array.isArray(value)) {
      const first = formatNumber(scalar(value[0]));
      const second = formatNumber(scalar(value[1]));
      return `${first}; ${second}`;
    }
    const n = scalar(value ?? 0);
    if (!Number.isFinite(n)) return 'Math ERROR';
    if (state.fractionView === 1) return formatFraction(n, false);
    if (state.fractionView === 2) return formatFraction(n, true);
    if (state.engineeringView) return formatEngineering(n);
    return formatNumber(n);
  }

  function expressionWithCursor() {
    const expr = state.expr || '';
    if (!state.on || state.justEvaluated || state.prompt) return expr;
    const pos = Math.max(0, Math.min(state.cursor, expr.length));
    return `${expr.slice(0, pos)}▏${expr.slice(pos)}`;
  }

  function render() {
    statusMode.textContent = state.mode === 'REG' ? `REG ${state.regType}` : state.mode;
    statusAngle.textContent = state.angle === 'DEG' ? 'D' : state.angle === 'RAD' ? 'R' : 'G';
    const flags = [];
    if (state.shift) flags.push('SHIFT');
    if (state.alpha) flags.push('ALPHA');
    if (state.hyp) flags.push('HYP');
    if (state.insertMode) flags.push('INS');
    if (state.message) flags.push(state.message);
    statusFlags.textContent = flags.join(' ');
    statusMemory.textContent = state.memory !== 0 ? 'M' : '';
    expressionText.textContent = state.prompt ? state.prompt.expression : expressionWithCursor();
    resultText.textContent = state.prompt ? state.prompt.result : formatResult(state.resultValue);
    resultText.classList.toggle('prompt-result', Boolean(state.prompt));
    screen.classList.toggle('is-off', !state.on);
    document.querySelectorAll('.round-key[data-key="shift"]').forEach((button) => button.classList.toggle('modifier-active', state.shift));
    document.querySelectorAll('.round-key[data-key="alpha"]').forEach((button) => button.classList.toggle('modifier-active', state.alpha));
    if (expressionText.scrollWidth > expressionText.clientWidth) expressionText.scrollLeft = expressionText.scrollWidth;
  }

  function setPrompt(kind, expression, result) {
    state.pending = kind;
    state.prompt = { expression, result };
    state.message = '';
    render();
  }

  function clearPrompt() {
    state.pending = null;
    state.prompt = null;
  }

  function cancelPrompt() {
    if (!state.pending) return;
    clearPrompt();
    state.shift = false;
    state.alpha = false;
    render();
  }

  function insertRaw(text, kind = 'operand') {
    if (state.justEvaluated) {
      const isOperator = kind === 'operator';
      if (isOperator) {
        state.expr = 'Ans';
        state.cursor = state.expr.length;
      } else {
        state.expr = '';
        state.cursor = 0;
      }
      state.justEvaluated = false;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
    }
    state.error = '';
    state.dmsDisplay = null;
    const at = Math.max(0, Math.min(state.cursor, state.expr.length));
    if (state.insertMode && at < state.expr.length) {
      state.expr = state.expr.slice(0, at) + text + state.expr.slice(at + text.length);
    } else {
      state.expr = state.expr.slice(0, at) + text + state.expr.slice(at);
    }
    state.cursor = at + text.length;
    state.replayIndex = -1;
    render();
  }

  function appendOperator(operator) {
    if (state.justEvaluated) {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
    }
    if (state.cursor === 0 && state.expr.length === 0 && operator !== '−') {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
    }
    const before = state.expr.slice(0, state.cursor);
    if (/[+−×÷^]$/.test(before)) {
      state.expr = state.expr.slice(0, state.cursor - 1) + operator + state.expr.slice(state.cursor);
      state.cursor = state.cursor - 1 + operator.length;
      render();
      return;
    }
    insertRaw(operator, 'operator');
  }

  function insertFunction(name) {
    insertRaw(`${name}(`, 'operand');
  }

  function startPostfix(suffix) {
    if (state.justEvaluated) {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
    }
    if (!state.expr || /[+−×÷^,(]$/.test(state.expr.slice(0, state.cursor))) {
      insertRaw(`Ans${suffix}`, 'operand');
      return;
    }
    insertRaw(suffix, 'operand');
  }

  function toggleSign() {
    if (state.justEvaluated) {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      state.error = '';
    }
    const before = state.expr.slice(0, state.cursor);
    if (before === 'Ans') {
      state.expr = `−${state.expr}`;
      state.cursor += 1;
      state.dmsDisplay = null;
      render();
      return;
    }
    const numberMatch = before.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/);
    if (numberMatch) {
      const start = before.length - numberMatch[0].length;
      const prefix = before.slice(0, start);
      if (prefix.endsWith('−') && (prefix.length === 1 || /[+−×÷^(,]$/.test(prefix.slice(0, -1)))) {
        state.expr = state.expr.slice(0, start - 1) + state.expr.slice(start);
        state.cursor -= 1;
      } else {
        state.expr = state.expr.slice(0, start) + '−' + state.expr.slice(start);
        state.cursor += 1;
      }
    } else if (/[A-FXYM]$/.test(before)) {
      state.expr = state.expr.slice(0, state.cursor - 1) + '−' + state.expr.slice(state.cursor - 1);
      state.cursor += 1;
    } else {
      insertRaw('−', 'operator');
      return;
    }
    state.dmsDisplay = null;
    render();
  }

  function insertDecimal() {
    if (state.justEvaluated) {
      insertRaw('0.', 'operand');
      return;
    }
    const before = state.expr.slice(0, state.cursor);
    const trimmed = before.trimEnd();
    const numberMatch = trimmed.match(/(?:\d+(?:\.\d*)?|\.\d+)$/);
    if (numberMatch && numberMatch[0].includes('.')) return;
    if (!trimmed || /[+−×÷^,(]$/.test(trimmed) || /(?:nCr|nPr|root)$/.test(trimmed)) {
      insertRaw('0.', 'operand');
    } else {
      insertRaw('.', 'operand');
    }
  }

  function deleteBeforeCursor() {
    if (state.justEvaluated) {
      state.expr = state.expr || '';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
    }
    if (state.cursor > 0) {
      state.expr = state.expr.slice(0, state.cursor - 1) + state.expr.slice(state.cursor);
      state.cursor -= 1;
      state.error = '';
      state.dmsDisplay = null;
    }
    render();
  }

  function clearAll() {
    state.expr = '';
    state.cursor = 0;
    state.resultValue = 0;
    state.resultText = '0';
    state.error = '';
    state.message = '';
    state.prompt = null;
    state.pending = null;
    state.justEvaluated = false;
    state.hyp = false;
    state.fractionView = 0;
    state.dmsDisplay = null;
    state.engineeringView = false;
    state.replayIndex = -1;
    state.draft = null;
    render();
  }

  function openModeMenu() {
    setPrompt('mode', 'MODE', '1 COMP   2 SD   3 REG');
  }

  function openClearMenu() {
    setPrompt('clear', 'CLR', '1 Mcl   2 Mode   3 All');
  }

  function selectMode(number) {
    if (number === '1') {
      state.mode = 'COMP';
      state.regType = 'Lin';
      state.stats = [];
      clearPrompt();
      clearAll();
      return;
    }
    if (number === '2') {
      state.mode = 'SD';
      state.regType = 'Lin';
      state.stats = [];
      clearPrompt();
      clearAll();
      showMessage('SD MODE', 1100);
      return;
    }
    if (number === '3') {
      state.mode = 'REG';
      state.stats = [];
      setPrompt('regtype', 'REG', '1 Lin  2 Log  3 Exp  4 Pwr  5 Inv  6 Quad');
    }
  }

  function selectRegression(number) {
    const types = { '1': 'Lin', '2': 'Log', '3': 'Exp', '4': 'Pwr', '5': 'Inv', '6': 'Quad' };
    if (!types[number]) return;
    state.regType = types[number];
    state.stats = [];
    state.lastRegression = null;
    clearPrompt();
    clearAll();
    showMessage(`${state.regType} REG`, 1100);
  }

  function performClear(number) {
    clearPrompt();
    if (number === '1') {
      state.vars = Object.fromEntries(variableNames.map((key) => [key, 0]));
      state.memory = 0;
      state.stats = [];
      state.lastRegression = null;
      clearAll();
      showMessage('MEMORY CLEARED', 1000);
      return;
    }
    if (number === '2') {
      state.mode = 'COMP';
      state.angle = 'DEG';
      state.regType = 'Lin';
      state.hyp = false;
      clearAll();
      showMessage('MODE RESET', 1000);
      return;
    }
    if (number === '3') {
      state.mode = 'COMP';
      state.angle = 'DEG';
      state.regType = 'Lin';
      state.ans = 0;
      state.vars = Object.fromEntries(variableNames.map((key) => [key, 0]));
      state.memory = 0;
      state.stats = [];
      state.lastRegression = null;
      state.history = [];
      clearAll();
      showMessage('ALL RESET', 1000);
    }
  }

  function openMemory(action) {
    state.pending = { type: 'memory', action };
    state.prompt = {
      expression: action === 'store' ? 'STO' : 'RCL',
      result: 'A-F  X-Y  M'
    };
    state.message = '';
    render();
  }

  function completeMemory(letter) {
    const action = state.pending.action;
    clearPrompt();
    if (letter === 'M') state.vars.M = state.memory;
    if (action === 'store') {
      const value = currentValue();
      state.vars[letter] = value;
      if (letter === 'M') state.memory = value;
      state.resultValue = value;
      showMessage(`${letter} STORED`, 1200);
    } else {
      const value = letter === 'M' ? state.memory : (state.vars[letter] ?? 0);
      state.resultValue = value;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
      state.justEvaluated = false;
      insertRaw(formatNumber(value), 'operand');
      showMessage(`${letter} RECALLED`, 900);
    }
  }

  function currentValue() {
    if (state.expr.trim()) {
      try {
        const result = evaluateExpression(autoclose(state.expr));
        const n = scalar(result);
        if (!Number.isFinite(n)) throw new CalcError();
        return n;
      } catch (error) {
        throw error instanceof CalcError ? error : new CalcError('Syntax ERROR');
      }
    }
    return scalar(state.resultValue ?? state.ans ?? 0);
  }

  function addMemory(subtract = false) {
    if (state.mode !== 'COMP') {
      addStatDatum(subtract);
      return;
    }
    try {
      const value = currentValue();
      state.memory = cleanZero(state.memory + (subtract ? -value : value));
      state.vars.M = state.memory;
      showMessage(subtract ? 'M−' : 'M+', 900);
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      render();
    }
  }

  function deleteLastStat() {
    if (!state.stats.length) {
      showMessage('NO DATA', 900);
      return;
    }
    state.stats.pop();
    state.expr = '';
    state.cursor = 0;
    state.justEvaluated = false;
    state.lastRegression = null;
    state.resultValue = state.stats.length;
    state.error = '';
    showMessage('LAST DATA CLEARED', 1000);
  }

  function splitStatPair(expression) {
    let depth = 0;
    let commaIndex = -1;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      else if (expression[i] === ',' && depth === 0) commaIndex = i;
    }
    if (commaIndex < 0) return null;
    return [expression.slice(0, commaIndex), expression.slice(commaIndex + 1)];
  }

  function addStatDatum(remove = false) {
    if (remove) { deleteLastStat(); render(); return; }
    try {
      const source = autoclose(state.expr);
      let datum;
      if (state.mode === 'REG') {
        const pair = splitStatPair(source);
        if (!pair) throw new CalcError('Enter x,y');
        const x = scalar(evaluateExpression(pair[0]));
        const y = scalar(evaluateExpression(pair[1]));
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new CalcError();
        datum = { x, y };
      } else {
        const x = source.trim() ? scalar(evaluateExpression(source)) : scalar(state.resultValue ?? 0);
        if (!Number.isFinite(x)) throw new CalcError();
        datum = { x };
      }
      state.stats.push(datum);
      state.expr = '';
      state.cursor = 0;
      state.justEvaluated = false;
      state.error = '';
      state.lastRegression = null;
      state.resultValue = state.stats.length;
      state.dmsDisplay = null;
      showMessage(`n=${state.stats.length}`, 1100);
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      render();
    }
  }

  function statisticsValues() {
    const xs = state.stats.map((row) => row.x);
    const n = xs.length;
    if (!n) throw new CalcError('NO DATA');
    const sum = xs.reduce((a, b) => a + b, 0);
    const sumSq = xs.reduce((a, b) => a + b * b, 0);
    const mean = sum / n;
    const variancePop = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n;
    const varianceSample = n > 1 ? xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (n - 1) : 0;
    const output = { n, sum, sumSq, mean, sigmaX: Math.sqrt(variancePop), sampleX: Math.sqrt(varianceSample) };
    if (state.mode === 'REG') {
      const ys = state.stats.map((row) => row.y);
      const sumY = ys.reduce((a, b) => a + b, 0);
      const sumY2 = ys.reduce((a, b) => a + b * b, 0);
      const sumXY = state.stats.reduce((acc, row) => acc + row.x * row.y, 0);
      const meanY = sumY / n;
      const varianceY = ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0) / n;
      const sampleY = n > 1 ? ys.reduce((acc, y) => acc + (y - meanY) ** 2, 0) / (n - 1) : 0;
      const fit = regressionFit(state.stats, state.regType);
      Object.assign(output, { sumY, sumY2, sumXY, meanY, sigmaY: Math.sqrt(varianceY), sampleY: Math.sqrt(sampleY), ...fit });
    }
    return output;
  }

  function leastSquares(xs, ys) {
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i] - mx) ** 2;
      syy += (ys[i] - my) ** 2;
      sxy += (xs[i] - mx) * (ys[i] - my);
    }
    const b = sxx === 0 ? 0 : sxy / sxx;
    const a = my - b * mx;
    const r = sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
    return { a, b, r };
  }

  function solve3(matrix, vector) {
    const m = matrix.map((row, i) => [...row, vector[i]]);
    for (let col = 0; col < 3; col++) {
      let pivot = col;
      for (let row = col + 1; row < 3; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
      [m[col], m[pivot]] = [m[pivot], m[col]];
      if (Math.abs(m[col][col]) < 1e-12) throw new CalcError('Math ERROR');
      const divisor = m[col][col];
      for (let j = col; j < 4; j++) m[col][j] /= divisor;
      for (let row = 0; row < 3; row++) {
        if (row === col) continue;
        const factor = m[row][col];
        for (let j = col; j < 4; j++) m[row][j] -= factor * m[col][j];
      }
    }
    return [m[0][3], m[1][3], m[2][3]];
  }

  function regressionFit(rows, type) {
    if (rows.length < (type === 'Quad' ? 3 : 2)) throw new CalcError('NO DATA');
    const xs = rows.map((r) => r.x);
    const ys = rows.map((r) => r.y);
    if (type === 'Quad') {
      const n = rows.length;
      const s1 = xs.reduce((a, x) => a + x, 0);
      const s2 = xs.reduce((a, x) => a + x ** 2, 0);
      const s3 = xs.reduce((a, x) => a + x ** 3, 0);
      const s4 = xs.reduce((a, x) => a + x ** 4, 0);
      const sy = ys.reduce((a, y) => a + y, 0);
      const sxy = rows.reduce((a, r) => a + r.x * r.y, 0);
      const sx2y = rows.reduce((a, r) => a + r.x ** 2 * r.y, 0);
      const [a, b, c] = solve3([[n, s1, s2], [s1, s2, s3], [s2, s3, s4]], [sy, sxy, sx2y]);
      return { a, b, c, r: 0 };
    }
    let tx = [...xs], ty = [...ys], decode = (a, b) => ({ a, b });
    if (type === 'Log') {
      if (xs.some((x) => x <= 0)) throw new CalcError();
      tx = xs.map(Math.log);
    } else if (type === 'Exp') {
      if (ys.some((y) => y <= 0)) throw new CalcError();
      ty = ys.map(Math.log);
      decode = (a, b) => ({ a: Math.exp(a), b });
    } else if (type === 'Pwr') {
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) throw new CalcError();
      tx = xs.map(Math.log); ty = ys.map(Math.log);
      decode = (a, b) => ({ a: Math.exp(a), b });
    } else if (type === 'Inv') {
      if (xs.some((x) => x === 0)) throw new CalcError();
      tx = xs.map((x) => 1 / x);
    }
    const fit = leastSquares(tx, ty);
    return { ...decode(fit.a, fit.b), r: fit.r };
  }

  function openStatisticsMenu(which) {
    if (state.mode === 'COMP') {
      showMessage('SELECT SD OR REG MODE', 1300);
      return;
    }
    if (which === 'sum') {
      const choices = state.mode === 'REG' ? '1 Σx²  2 Σx  3 Σy²  4 Σy  5 Σxy' : '1 Σx²   2 Σx';
      setPrompt('statSum', 'S-SUM', choices);
    } else {
      const choices = state.mode === 'REG'
        ? '1 n  2 x̄  3 σx  4 sx  5 ȳ  6 σy  7 sy  8 a  9 b  0 r'
        : '1 n  2 x̄  3 σx  4 sx';
      setPrompt('statVar', 'S-VAR', choices);
    }
  }

  function selectStatistic(which, choice) {
    try {
      const values = statisticsValues();
      let value;
      if (which === 'sum') {
        value = state.mode === 'REG'
          ? ({ '1': values.sumSq, '2': values.sum, '3': values.sumY2, '4': values.sumY, '5': values.sumXY })[choice]
          : ({ '1': values.sumSq, '2': values.sum })[choice];
      } else if (state.mode === 'REG') {
        value = ({ '1': values.n, '2': values.mean, '3': values.sigmaX, '4': values.sampleX, '5': values.meanY, '6': values.sigmaY, '7': values.sampleY, '8': values.a, '9': values.b, '0': values.r })[choice];
      } else {
        value = ({ '1': values.n, '2': values.mean, '3': values.sigmaX, '4': values.sampleX })[choice];
      }
      if (value === undefined) { clearPrompt(); render(); return; }
      clearPrompt();
      state.resultValue = value;
      state.ans = value;
      state.expr = '';
      state.cursor = 0;
      state.justEvaluated = true;
      state.error = '';
      state.dmsDisplay = null;
      render();
    } catch (error) {
      clearPrompt();
      state.error = error.message || 'NO DATA';
      render();
    }
  }

  function autoclose(expression) {
    let opens = 0, closes = 0;
    for (const char of expression) {
      if (char === '(') opens++;
      else if (char === ')') closes++;
    }
    if (opens > closes) return expression + ')'.repeat(opens - closes);
    return expression;
  }

  function preprocessExpression(expression) {
    let source = expression.replace(/[−–]/g, '-').replace(/×/g, '*').replace(/÷/g, '/');
    // The fx-82MS fraction key uses a two-part separator; three parts are a mixed number.
    source = source.replace(/(\d+(?:\.\d+)?)┘(\d+(?:\.\d+)?)┘(\d+(?:\.\d+)?)/g, '($1+$2/$3)');
    source = source.replace(/┘/g, '/');
    // Convert a degrees-minutes-seconds entry such as 30°30°30 into decimal degrees.
    source = source.replace(/(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)°(\d+(?:\.\d+)?)(?:°)?/g, '($1+$2/60+$3/3600)');
    source = source.replace(/(\d+(?:\.\d+)?|\.\d+)°/g, '$1');
    return source;
  }

  function tokenize(expression) {
    const source = preprocessExpression(expression);
    const tokens = [];
    const pattern = /\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?|π|[A-Za-z][A-Za-z0-9]*|[()+\-*/^,!%]/gy;
    let position = 0;
    while (position < source.length) {
      pattern.lastIndex = position;
      const match = pattern.exec(source);
      if (!match) throw new CalcError('Syntax ERROR');
      position = pattern.lastIndex;
      const raw = match[0];
      if (/^\s+$/.test(raw)) continue;
      if (/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/.test(raw)) {
        tokens.push({ type: 'number', value: Number(raw) });
        continue;
      }
      if (raw === 'π') { tokens.push({ type: 'constant', value: Math.PI }); continue; }
      if (raw === '(') { tokens.push({ type: 'lparen' }); continue; }
      if (raw === ')') { tokens.push({ type: 'rparen' }); continue; }
      if (raw === ',') { tokens.push({ type: 'comma' }); continue; }
      if ('+-*/^!%'.includes(raw)) {
        tokens.push({ type: raw === '!' || raw === '%' ? 'postfix' : 'operator', value: raw });
        continue;
      }
      const lower = raw.toLowerCase();
      if (lower === 'ncr' || lower === 'npr' || lower === 'root') {
        tokens.push({ type: 'operator', value: lower });
      } else if (lower === 'pi') {
        tokens.push({ type: 'constant', value: Math.PI });
      } else if (lower === 'e') {
        tokens.push({ type: 'constant', value: Math.E });
      } else if (lower === 'ans') {
        tokens.push({ type: 'constant', value: state.ans });
      } else if (variableNames.includes(raw.toUpperCase()) && raw.length === 1) {
        const variable = raw.toUpperCase();
        tokens.push({ type: 'constant', value: variable === 'M' ? state.memory : state.vars[variable] ?? 0 });
      } else if (['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'log', 'ln', 'sqrt', 'cbrt', 'exp', 'abs', 'floor', 'ceil', 'rnd', 'rand', 'pol', 'rec'].includes(lower)) {
        tokens.push({ type: 'function', value: lower });
      } else {
        throw new CalcError('Syntax ERROR');
      }
    }

    const out = [];
    const canEnd = (token) => ['number', 'constant', 'rparen', 'postfix'].includes(token.type);
    const canStart = (token) => ['number', 'constant', 'lparen', 'function'].includes(token.type);
    for (const token of tokens) {
      const previous = out[out.length - 1];
      if (previous && canEnd(previous) && canStart(token)) out.push({ type: 'operator', value: '*' });
      out.push(token);
    }
    return out;
  }

  function angleToRadians(value) {
    if (state.angle === 'DEG') return value * Math.PI / 180;
    if (state.angle === 'GRA') return value * Math.PI / 200;
    return value;
  }

  function radiansToAngle(value) {
    if (state.angle === 'DEG') return value * 180 / Math.PI;
    if (state.angle === 'GRA') return value * 200 / Math.PI;
    return value;
  }

  function trig(name, value) {
    if (name === 'sin') return Math.sin(angleToRadians(value));
    if (name === 'cos') return Math.cos(angleToRadians(value));
    if (name === 'tan') return Math.tan(angleToRadians(value));
    if (name === 'asin') return radiansToAngle(Math.asin(value));
    if (name === 'acos') return radiansToAngle(Math.acos(value));
    if (name === 'atan') return radiansToAngle(Math.atan(value));
    if (name === 'sinh') return Math.sinh(value);
    if (name === 'cosh') return Math.cosh(value);
    if (name === 'tanh') return Math.tanh(value);
    if (name === 'asinh') return Math.asinh(value);
    if (name === 'acosh') return Math.acosh(value);
    if (name === 'atanh') return Math.atanh(value);
    return NaN;
  }

  function polar(x, y) {
    const radius = Math.hypot(x, y);
    const theta = radiansToAngle(Math.atan2(y, x));
    state.vars.X = radius;
    state.vars.Y = theta;
    return [radius, theta];
  }

  function rectangular(radius, theta) {
    const radians = angleToRadians(theta);
    const x = radius * Math.cos(radians);
    const y = radius * Math.sin(radians);
    state.vars.X = x;
    state.vars.Y = y;
    return [x, y];
  }

  function applyFunction(name, args) {
    const a = scalar(args[0] ?? 0);
    switch (name) {
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan':
      case 'sinh': case 'cosh': case 'tanh': case 'asinh': case 'acosh': case 'atanh':
        return trig(name, a);
      case 'log': return Math.log10(a);
      case 'ln': return Math.log(a);
      case 'sqrt': return Math.sqrt(a);
      case 'cbrt': return Math.cbrt(a);
      case 'exp': return Math.exp(a);
      case 'abs': return Math.abs(a);
      case 'floor': return Math.floor(a);
      case 'ceil': return Math.ceil(a);
      case 'rnd': return Number(a.toPrecision(10));
      case 'rand': return Math.random();
      case 'pol': return polar(scalar(args[0]), scalar(args[1]));
      case 'rec': return rectangular(scalar(args[0]), scalar(args[1]));
      default: throw new CalcError('Syntax ERROR');
    }
  }

  function factorial(value) {
    const n = scalar(value);
    if (!Number.isInteger(n) || n < 0 || n > 170) throw new CalcError();
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return out;
  }

  function permutation(nValue, rValue, combination) {
    const n = scalar(nValue), r = scalar(rValue);
    if (!Number.isInteger(n) || !Number.isInteger(r) || n < 0 || r < 0 || r > n || n > 170) throw new CalcError();
    let result = 1;
    for (let i = 0; i < r; i++) result *= (n - i);
    if (combination) {
      for (let i = 2; i <= r; i++) result /= i;
    }
    return result;
  }

  function operatorPrecedence(operator) {
    if (operator === '+' || operator === '-') return 1;
    if (operator === '*' || operator === '/') return 2;
    if (operator === 'ncr' || operator === 'npr' || operator === 'root') return 3;
    if (operator === '^') return 4;
    return -1;
  }

  function applyOperator(operator, left, right) {
    const a = scalar(left);
    const b = scalar(right);
    switch (operator) {
      case '+': return isPercent(right) ? a + a * right.value : a + b;
      case '-': return isPercent(right) ? a - a * right.value : a - b;
      case '*': return a * b;
      case '/': if (b === 0) throw new CalcError(); return a / b;
      case '^': return a ** b;
      case 'root': {
        if (a === 0) throw new CalcError();
        if (b < 0 && Number.isInteger(a) && Math.abs(a % 2) === 1) return -((-b) ** (1 / a));
        return b ** (1 / a);
      }
      case 'ncr': return permutation(a, b, true);
      case 'npr': return permutation(a, b, false);
      default: throw new CalcError('Syntax ERROR');
    }
  }

  function parseTokens(tokens) {
    let index = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];

    function parsePrimary() {
      const token = take();
      if (!token) throw new CalcError('Syntax ERROR');
      if (token.type === 'number' || token.type === 'constant') return token.value;
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        const value = parseExpression(4);
        return token.value === '-' ? -scalar(value) : scalar(value);
      }
      if (token.type === 'lparen') {
        const value = parseExpression(0);
        if (!peek() || peek().type !== 'rparen') throw new CalcError('Syntax ERROR');
        take();
        return value;
      }
      if (token.type === 'function') {
        const args = [];
        if (peek() && peek().type === 'lparen') {
          take();
          if (peek() && peek().type !== 'rparen') {
            args.push(parseExpression(0));
            while (peek() && peek().type === 'comma') {
              take();
              args.push(parseExpression(0));
            }
          }
          if (!peek() || peek().type !== 'rparen') throw new CalcError('Syntax ERROR');
          take();
        } else if (peek()) {
          args.push(parseExpression(5));
        }
        if ((token.value === 'pol' || token.value === 'rec') && args.length !== 2) throw new CalcError('Syntax ERROR');
        if (token.value === 'rand' && args.length === 0) return Math.random();
        if (!args.length) throw new CalcError('Syntax ERROR');
        return applyFunction(token.value, args);
      }
      throw new CalcError('Syntax ERROR');
    }

    function parseExpression(minimum) {
      let left = parsePrimary();
      while (peek()) {
        const token = peek();
        if (token.type === 'postfix') {
          take();
          if (token.value === '!') left = factorial(left);
          else if (token.value === '%') left = { __percent: true, value: scalar(left) / 100 };
          continue;
        }
        if (token.type !== 'operator') break;
        const precedence = operatorPrecedence(token.value);
        if (precedence < minimum) break;
        take();
        const rightAssociative = token.value === '^';
        const right = parseExpression(precedence + (rightAssociative ? 0 : 1));
        left = applyOperator(token.value, left, right);
      }
      return left;
    }

    if (!tokens.length) return state.ans;
    const result = parseExpression(0);
    if (index !== tokens.length) throw new CalcError('Syntax ERROR');
    return result;
  }

  function evaluateExpression(expression) {
    const tokens = tokenize(expression);
    const result = parseTokens(tokens);
    if (Array.isArray(result)) {
      if (result.some((value) => !Number.isFinite(scalar(value)))) throw new CalcError();
      return result.map((value) => cleanZero(scalar(value)));
    }
    const numeric = scalar(result);
    if (!Number.isFinite(numeric)) throw new CalcError();
    return cleanZero(numeric);
  }

  function calculate({ addHistory = true } = {}) {
    if (state.prompt) { cancelPrompt(); return; }
    const source = state.expr.trim();
    if (!source) {
      state.resultValue = state.ans;
      state.justEvaluated = true;
      render();
      return;
    }
    try {
      const completed = autoclose(source);
      const value = evaluateExpression(completed);
      state.expr = completed;
      state.cursor = state.expr.length;
      state.resultValue = value;
      state.ans = scalar(value);
      state.error = '';
      state.justEvaluated = true;
      state.dmsDisplay = null;
      state.fractionView = 0;
      state.engineeringView = false;
      if (addHistory) {
        state.history.push({ expr: completed, value: Array.isArray(value) ? [...value] : value });
        if (state.history.length > 100) state.history.shift();
        state.replayIndex = -1;
      }
      render();
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      state.resultValue = 0;
      state.justEvaluated = true;
      state.dmsDisplay = null;
      render();
      speak(state.error);
    }
  }

  function recallHistory(direction) {
    if (!state.history.length) return;
    if (state.replayIndex === -1 && direction < 0) {
      state.draft = { expr: state.expr, value: state.resultValue };
      state.replayIndex = state.history.length;
    }
    let next = state.replayIndex + direction;
    if (next < 0) next = 0;
    if (next >= state.history.length) {
      state.replayIndex = -1;
      if (state.draft) {
        state.expr = state.draft.expr;
        state.resultValue = state.draft.value;
      }
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      render();
      return;
    }
    state.replayIndex = next;
    const item = state.history[next];
    state.expr = item.expr;
    state.cursor = state.expr.length;
    state.resultValue = item.value;
    state.justEvaluated = true;
    state.error = '';
    render();
  }

  function moveCursor(delta) {
    if (state.justEvaluated) state.justEvaluated = false;
    state.cursor = Math.max(0, Math.min(state.expr.length, state.cursor + delta));
    render();
  }

  function cycleAngle() {
    state.angle = state.angle === 'DEG' ? 'RAD' : state.angle === 'RAD' ? 'GRA' : 'DEG';
    state.dmsDisplay = null;
    showMessage(state.angle, 900);
  }

  function applyEngineering() {
    if (state.expr.trim() && !state.justEvaluated) {
      calculate({ addHistory: false });
      if (!state.error) state.engineeringView = true;
    } else {
      state.engineeringView = !state.engineeringView;
    }
    render();
  }

  function applyRnd() {
    if (state.expr.trim() && !state.justEvaluated) {
      const current = state.expr;
      state.expr = `rnd(${autoclose(current)})`;
      state.cursor = state.expr.length;
      calculate();
      return;
    }
    state.resultValue = Number(scalar(state.resultValue ?? state.ans).toPrecision(10));
    state.ans = scalar(state.resultValue);
    state.justEvaluated = true;
    state.error = '';
    render();
  }

  function handlePending(key) {
    const pending = state.pending;
    if (!pending) return false;
    if (pending === 'mode') {
      if (['1', '2', '3'].includes(key)) { selectMode(key); return true; }
      if (key === 'mode') { cancelPrompt(); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'regtype') {
      if (['1', '2', '3', '4', '5', '6'].includes(key)) { selectRegression(key); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'clear') {
      if (['1', '2', '3'].includes(key)) { performClear(key); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'statSum' || pending === 'statVar') {
      if (/^[0-9]$/.test(key)) { selectStatistic(pending === 'statSum' ? 'sum' : 'var', key); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'memory') {
      const letter = alphaKey[key];
      if (letter) { completeMemory(letter); return true; }
      if (key === 'alpha' || key === 'shift') return false;
      cancelPrompt();
      return false;
    }
    return false;
  }

  function setVariable(letter) {
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'memory') {
      completeMemory(letter);
      return;
    }
    if (letter === 'M') {
      insertRaw('M', 'operand');
      return;
    }
    insertRaw(letter, 'operand');
  }

  function executeShift(key) {
    switch (key) {
      case 'inverse': startPostfix('!'); break;
      case 'ncr': appendOperator(' nPr '); break;
      case 'polar': insertFunction('Rec'); break;
      case 'cube': insertFunction('cbrt'); break;
      case 'fraction':
        state.fractionView = (state.fractionView + 1) % 3;
        state.dmsDisplay = null;
        showMessage(state.fractionView === 0 ? 'DECIMAL' : state.fractionView === 1 ? 'IMPROPER FRACTION' : 'MIXED FRACTION', 1000);
        break;
      case 'power': appendOperator(' root '); break;
      case 'log': insertRaw('10^(', 'operand'); break;
      case 'ln': insertRaw('e^(', 'operand'); break;
      case 'sin': insertFunction(state.hyp ? 'asinh' : 'asin'); state.hyp = false; break;
      case 'cos': insertFunction(state.hyp ? 'acosh' : 'acos'); state.hyp = false; break;
      case 'tan': insertFunction(state.hyp ? 'atanh' : 'atan'); state.hyp = false; break;
      case 'rcl': openMemory('store'); break;
      case 'eng': moveCursor(-1); break;
      case 'mplus': addMemory(true); break;
      case 'del': state.insertMode = !state.insertMode; showMessage(state.insertMode ? 'INSERT ON' : 'INSERT OFF', 900); break;
      case 'ac': state.on = false; clearAll(); state.on = false; render(); break;
      case 'mode': openClearMenu(); break;
      case '1': openStatisticsMenu('sum'); break;
      case '2': openStatisticsMenu('var'); break;
      case '3': insertRaw('π', 'operand'); break;
      case 'exp': insertFunction('rand'); break;
      case '0': applyRnd(); break;
      case 'ans': cycleAngle(); break;
      case 'equals': startPostfix('%'); break;
      default: break;
    }
  }

  function executeMain(key) {
    if (/^[0-9]$/.test(key)) { insertRaw(key, 'operand'); return; }
    switch (key) {
      case 'inverse': startPostfix('^(−1)'); break;
      case 'ncr': appendOperator(' nCr '); break;
      case 'polar': insertFunction('Pol'); break;
      case 'cube': startPostfix('^3'); break;
      case 'fraction': insertRaw('┘', 'operand'); break;
      case 'sqrt': insertFunction('sqrt'); break;
      case 'square': startPostfix('^2'); break;
      case 'power': appendOperator('^'); break;
      case 'log': insertFunction('log'); break;
      case 'ln': insertFunction('ln'); break;
      case 'negative': toggleSign(); break;
      case 'dms':
        if (state.justEvaluated) {
          state.dmsDisplay = formatDMS(scalar(state.resultValue));
          render();
        } else insertRaw('°', 'operand');
        break;
      case 'hyp': state.hyp = !state.hyp; showMessage(state.hyp ? 'HYP' : 'HYP OFF', 900); break;
      case 'sin': insertFunction(state.hyp ? 'sinh' : 'sin'); state.hyp = false; break;
      case 'cos': insertFunction(state.hyp ? 'cosh' : 'cos'); state.hyp = false; break;
      case 'tan': insertFunction(state.hyp ? 'tanh' : 'tan'); state.hyp = false; break;
      case 'rcl': openMemory('recall'); break;
      case 'eng': applyEngineering(); break;
      case 'open': insertRaw('(', 'operand'); break;
      case 'close': insertRaw(')', 'operand'); break;
      case 'comma': insertRaw(',', 'operand'); break;
      case 'mplus': addMemory(false); break;
      case 'del': deleteBeforeCursor(); break;
      case 'ac': clearAll(); break;
      case 'multiply': appendOperator('×'); break;
      case 'divide': appendOperator('÷'); break;
      case 'plus': appendOperator('+'); break;
      case 'minus': appendOperator('−'); break;
      case 'decimal': insertDecimal(); break;
      case 'exp': insertRaw('×10^', 'operator'); break;
      case 'ans': insertRaw('Ans', 'operand'); break;
      case 'equals': calculate(); break;
      case 'mode': openModeMenu(); break;
      case 'on':
        state.on = true;
        clearAll();
        state.on = true;
        break;
      default: break;
    }
  }

  function handleKey(key) {
    if (key === 'on') {
      state.on = true;
      state.shift = false;
      state.alpha = false;
      if (state.prompt) clearPrompt();
      render();
      return;
    }
    if (!state.on) return;

    if (key === 'shift') {
      state.shift = !state.shift;
      state.alpha = false;
      state.message = '';
      render();
      return;
    }
    if (key === 'alpha') {
      state.alpha = !state.alpha;
      state.shift = false;
      state.message = '';
      render();
      return;
    }
    if (key === 'up') { recallHistory(-1); return; }
    if (key === 'down') { recallHistory(1); return; }
    if (key === 'left') { moveCursor(-1); return; }
    if (key === 'right') { moveCursor(1); return; }

    if (state.pending && handlePending(key)) {
      state.shift = false;
      state.alpha = false;
      return;
    }

    if (state.alpha && alphaKey[key]) {
      const letter = alphaKey[key];
      state.alpha = false;
      state.shift = false;
      setVariable(letter);
      render();
      return;
    }

    const shifted = state.shift;
    state.shift = false;
    state.alpha = false;
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'memory' && !alphaKey[key]) cancelPrompt();
    if (shifted) executeShift(key);
    else executeMain(key);
    render();
  }

  document.querySelectorAll('[data-key]').forEach((button) => {
    button.addEventListener('click', () => handleKey(button.dataset.key));
  });

  const keyboardMap = {
    Enter: 'equals', '=': 'equals', Escape: 'ac', Backspace: 'del', Delete: 'del',
    '+': 'plus', '-': 'minus', '*': 'multiply', '/': 'divide', '^': 'power',
    '.': 'decimal', ',': 'comma', '(': 'open', ')': 'close',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    Shift: 'shift', Alt: 'alpha'
  };
  document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    let mapped = keyboardMap[event.key];
    if (!mapped && /^[0-9]$/.test(event.key)) mapped = event.key;
    if (!mapped) {
      const key = event.key.toLowerCase();
      mapped = ({ s: 'sin', c: 'cos', t: 'tan', h: 'hyp', l: 'ln', g: 'log', r: 'sqrt', p: 'polar' })[key];
    }
    if (mapped) {
      event.preventDefault();
      handleKey(mapped);
    }
  });

  // Android/Chromium install prompt. The app remains fully usable in a normal browser.
  let deferredInstallPrompt = null;
  const installButton = $('installButton');
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
  window.addEventListener('appinstalled', () => {
    installButton.hidden = true;
    showMessage('APP INSTALLED', 1200);
  });
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
  }

  render();
})();
