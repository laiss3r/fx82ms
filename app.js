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
  const statusHistory = $('statusHistory');
  const statusSteps = $('statusSteps');
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
    modeSetupPage: 0,
    contrast: 5,
    ans: 0,
    vars: Object.fromEntries(variableNames.map((key) => [key, 0])),
    memory: 0,
    memorySet: false,
    pending: null,
    fractionView: 0,
    fractionFormat: 'mixed',
    displayFormat: 'Norm',
    displayDigits: 10,
    normSetting: 1,
    decimalSymbol: '.',
    dmsDisplay: null,
    engineeringView: false,
    engineeringShift: 0,
    stats: [],
    statsRetained: true,
    dataEdit: null,
    statMenuIndex: 0,
    regTypePage: 0,
    regression: null,
    lastRegression: null
  };

  const STORAGE_KEY = 'fx82ms.calculator.state.v2';

  function encodeStoredValue(value) {
    if (isRational(value)) return { __rationalStored: true, n: String(value.n), d: String(value.d) };
    if (Array.isArray(value)) return value.map(encodeStoredValue);
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  }

  function decodeStoredValue(value) {
    if (Array.isArray(value)) return value.map(decodeStoredValue);
    if (value && value.__rationalStored === true) {
      return makeRational(BigInt(value.n), BigInt(value.d));
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function persistState() {
    try {
      if (!window.localStorage) return;
      const saved = {
        version: 2, mode: state.mode, angle: state.angle, regType: state.regType,
        displayFormat: state.displayFormat, displayDigits: state.displayDigits,
        normSetting: state.normSetting, fractionFormat: state.fractionFormat,
        decimalSymbol: state.decimalSymbol, contrast: state.contrast,
        ans: encodeStoredValue(state.ans), vars: Object.fromEntries(
          Object.entries(state.vars).map(([key, value]) => [key, encodeStoredValue(value)])
        ),
        memory: state.memory, memorySet: state.memorySet,
        statsRetained: state.statsRetained,
        stats: state.stats.map((row) => ({ x: row.x, y: row.y, f: row.f || 1 }))
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (_) { /* Storage is optional (private browsing or file URLs). */ }
  }

  function restoreState() {
    try {
      if (!window.localStorage) return;
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 2) return;
      if (['COMP', 'SD', 'REG'].includes(saved.mode)) state.mode = saved.mode;
      if (['DEG', 'RAD', 'GRA'].includes(saved.angle)) state.angle = saved.angle;
      if (['Lin', 'Log', 'Exp', 'Pwr', 'Inv', 'Quad'].includes(saved.regType)) state.regType = saved.regType;
      if (['Norm', 'Fix', 'Sci'].includes(saved.displayFormat)) state.displayFormat = saved.displayFormat;
      if (Number.isInteger(saved.displayDigits) && saved.displayDigits >= 0 && saved.displayDigits <= 10) state.displayDigits = saved.displayDigits;
      if ([1, 2].includes(saved.normSetting)) state.normSetting = saved.normSetting;
      if (['mixed', 'improper'].includes(saved.fractionFormat)) state.fractionFormat = saved.fractionFormat;
      if (['.', ','].includes(saved.decimalSymbol)) state.decimalSymbol = saved.decimalSymbol;
      if (Number.isInteger(saved.contrast) && saved.contrast >= 0 && saved.contrast <= 10) state.contrast = saved.contrast;
      if (saved.vars && typeof saved.vars === 'object') {
        for (const name of variableNames) if (name in saved.vars) state.vars[name] = decodeStoredValue(saved.vars[name]);
      }
      state.ans = decodeStoredValue(saved.ans ?? 0);
      state.memory = Number(saved.memory) || 0;
      state.memorySet = Boolean(saved.memorySet) || state.memory !== 0;
      state.vars.M = state.memory;
      state.statsRetained = saved.statsRetained !== false;
      state.stats = Array.isArray(saved.stats) ? saved.stats.filter((row) =>
        row && Number.isFinite(row.x) && (state.mode !== 'REG' || Number.isFinite(row.y))
      ).slice(0, state.statsRetained ? 80 : 10000).map((row) => ({ x: row.x, ...(state.mode === 'REG' ? { y: row.y } : {}), f: Number.isInteger(row.f) && row.f > 0 ? Math.min(row.f, 999) : 1 })) : [];
      state.history = [];
      state.replayIndex = -1;
    } catch (_) { /* Ignore corrupt or unavailable saved state. */ }
  }

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

  function isRational(value) {
    return Boolean(value && typeof value === 'object' && value.__rational === true);
  }

  function gcdBigInt(a, b) {
    a = a < 0n ? -a : a;
    b = b < 0n ? -b : b;
    while (b) [a, b] = [b, a % b];
    return a || 1n;
  }

  function rationalToNumber(value) {
    if (!isRational(value)) return Number(value);
    if (value.n === 0n) return 0;
    const sign = value.n < 0n ? -1 : 1;
    const numerator = (value.n < 0n ? -value.n : value.n).toString();
    const denominator = value.d.toString();
    const leading = (digits) => {
      const head = digits.slice(0, 16);
      return { mantissa: Number(head) / (10 ** (head.length - 1)), exponent: digits.length - 1 };
    };
    const n = leading(numerator);
    const d = leading(denominator);
    const exponent = n.exponent - d.exponent;
    if (exponent > 308) return sign * Infinity;
    if (exponent < -324) return sign * 0;
    return sign * (n.mantissa / d.mantissa) * (10 ** exponent);
  }

  function makeRational(numerator, denominator = 1n) {
    let n = BigInt(numerator), d = BigInt(denominator);
    if (d === 0n) throw new CalcError('Math ERROR');
    if (d < 0n) { n = -n; d = -d; }
    if (n === 0n) return { __rational: true, n: 0n, d: 1n };
    const divisor = gcdBigInt(n, d);
    n /= divisor; d /= divisor;
    if (n.toString().replace('-', '').length > 400 || d.toString().length > 400) {
      assertCalculatorRange({ __rational: true, n, d });
      return roundInternal(rationalToNumber({ __rational: true, n, d }));
    }
    return { __rational: true, n, d };
  }

  function rationalFromDecimal(text) {
    const match = String(text).match(/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/);
    if (!match) throw new CalcError('Syntax ERROR');
    const sign = match[1] === '-' ? -1n : 1n;
    const whole = match[2] || '0';
    const fraction = match[3] ?? match[4] ?? '';
    const exponent = Number(match[5] || 0);
    if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) throw new CalcError('Math ERROR');
    let numerator = BigInt((whole + fraction).replace(/^0+(?=\d)/, '') || '0') * sign;
    const scale = fraction.length - exponent;
    let value;
    if (scale >= 0) value = makeRational(numerator, 10n ** BigInt(scale));
    else {
      numerator *= 10n ** BigInt(-scale);
      value = makeRational(numerator, 1n);
    }
    const significantDigits = (whole + fraction).replace(/^0+/, '').replace(/0+$/, '').length;
    if (significantDigits > 15) return roundInternal(rationalToNumber(value));
    return value;
  }

  function roundInternal(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number === 0) return Object.is(number, -0) ? 0 : number;
    return Number(number.toPrecision(15));
  }

  function cleanZero(value) {
    if (isRational(value)) return value.n === 0n ? makeRational(0n) : value;
    const number = Number(value);
    return Object.is(number, -0) ? 0 : number;
  }

  function assertCalculatorRange(value) {
    const number = scalar(value);
    if (!Number.isFinite(number) || Math.abs(number) > 9.999999999e99) throw new CalcError('Math ERROR');
    if (isRational(value) && value.n !== 0n) {
      const numerator = value.n < 0n ? -value.n : value.n;
      if (numerator * (10n ** 99n) < value.d) throw new CalcError('Math ERROR');
    } else if (number !== 0 && Math.abs(number) < 1e-99) {
      throw new CalcError('Math ERROR');
    }
    return value;
  }

  function rationalBinary(operator, left, right) {
    if (!isRational(left) || !isRational(right)) return null;
    const a = left, b = right;
    if (operator === '+') return makeRational(a.n * b.d + b.n * a.d, a.d * b.d);
    if (operator === '-') return makeRational(a.n * b.d - b.n * a.d, a.d * b.d);
    if (operator === '*') return makeRational(a.n * b.n, a.d * b.d);
    if (operator === '/') {
      if (b.n === 0n) throw new CalcError('Math ERROR');
      return makeRational(a.n * b.d, a.d * b.n);
    }
    return null;
  }

  function calculatorStepSpans(expression) {
    const source = String(expression || '');
    const tokens = [
      '×10^', '10^(', 'e^(', 'asinh(', 'acosh(', 'atanh(', 'sinh(', 'cosh(', 'tanh(',
      'asin(', 'acos(', 'atan(', 'sqrt(', 'cbrt(', 'floor(', 'ceil(', 'abs(', 'rnd(',
      'sin(', 'cos(', 'tan(', 'log(', 'ln(', 'pol(', 'rec(', 'ncr', 'npr', 'root', 'ans'
    ];
    const spans = [];
    for (let i = 0; i < source.length;) {
      if (/\s/.test(source[i])) { i++; continue; }
      const match = tokens.find((token) => source.slice(i).toLowerCase().startsWith(token));
      const length = match ? match.length : 1;
      spans.push({ start: i, end: i + length });
      i += length;
    }
    return spans;
  }

  function expressionStepCount(expression) {
    return calculatorStepSpans(expression).length;
  }

  function byteLength(text) {
    let bytes = 0;
    for (const character of String(text)) {
      const code = character.codePointAt(0);
      bytes += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    }
    return bytes;
  }

  function historyEntryBytes(entry) {
    const value = Array.isArray(entry.value) ? entry.value.map((part) => formatNumber(part)).join(';') : formatNumber(entry.value);
    return byteLength(entry.expr) + byteLength(value) + 1;
  }

  function pushHistory(expression, value) {
    const item = { expr: expression, value: Array.isArray(value) ? [...value] : value };
    state.history.push(item);
    let used = state.history.reduce((sum, row) => sum + historyEntryBytes(row), 0);
    while (state.history.length && used > 150) {
      used -= historyEntryBytes(state.history[0]);
      state.history.shift();
    }
    state.replayIndex = -1;
    state.draft = null;
  }
  function formatNumber(value, significant = 15) {
    value = scalar(value);
    if (!Number.isFinite(value)) return String(value);
    if (value === 0 || Object.is(value, -0)) return '0';
    let text;
    const abs = Math.abs(value);
    if (abs >= 1e15 || abs < 1e-6) {
      text = value.toExponential(Math.max(0, significant - 1));
      text = text.replace(/(?:\.\d*?[1-9])0+e/i, '$1e').replace(/\.0+e/i, 'e').replace(/e\+/, 'e');
    } else {
      text = String(Number(value.toPrecision(significant)));
    }
    return text;
  }

  function localizeDisplayText(text) {
    const match = String(text).match(/^([+-]?)(\d+)(?:\.(\d+))?([eE].*)?$/);
    if (!match) return String(text);
    const [, sign, integer, decimals, exponent = ''] = match;
    const group = state.decimalSymbol === ',' ? '.' : ',';
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, group);
    return `${sign}${grouped}${decimals ? `${state.decimalSymbol}${decimals}` : ''}${exponent}`;
  }
  function formatDisplayNumber(value) {
    value = scalar(value);
    if (!Number.isFinite(value)) return 'Math ERROR';
    value = cleanZero(value);
    if (value === 0) return state.displayFormat === 'Fix' && state.displayDigits > 0
      ? `0${state.decimalSymbol}${'0'.repeat(state.displayDigits)}` : '0';

    let text;
    if (state.displayFormat === 'Fix' && Math.abs(value) < 1e21) {
      text = value.toFixed(state.displayDigits);
    } else if (state.displayFormat === 'Sci') {
      text = value.toExponential(Math.max(0, state.displayDigits - 1));
    } else {
      const abs = Math.abs(value);
      const lowerLimit = state.normSetting === 1 ? 1e-2 : 1e-9;
      text = abs >= 1e10 || abs < lowerLimit
        ? value.toExponential(9)
        : String(Number(value.toPrecision(10)));
    }
    text = text.replace(/e([+-]?)0+(\d+)/i, 'e$1$2').replace(/e\+/, 'e');
    if (state.displayFormat === 'Norm' || Math.abs(value) >= 1e21) {
      text = text.replace(/\.0+e/i, 'e').replace(/(\.\d*?[1-9])0+e/i, '$1e');
    }
    return localizeDisplayText(text);
  }
  function roundToDisplayPrecision(value) {
    value = scalar(value);
    if (!Number.isFinite(value)) return value;
    if (state.displayFormat === 'Fix') {
      const factor = 10 ** state.displayDigits;
      return roundInternal(Math.sign(value) * Math.round(Math.abs(value) * factor) / factor);
    }
    const digits = state.displayFormat === 'Sci' ? state.displayDigits : 10;
    return Number(value.toPrecision(digits));
  }

  function scalar(value) {
    if (isPercent(value)) return scalar(value.raw) / 100;
    if (isRational(value)) return rationalToNumber(value);
    if (Array.isArray(value)) return scalar(value[0]);
    return Number(value);
  }

  function answerValue(value) {
    return Array.isArray(value) ? answerValue(value[0]) : value;
  }

  function isPercent(value) {
    return Boolean(value && typeof value === 'object' && value.__percent === true);
  }

  function rationalApproximation(value) {
    if (isRational(value)) return { n: value.n, d: value.d };
    const number = scalar(value);
    if (!Number.isFinite(number) || Math.abs(number) > 1e7) return null;
    const sign = number < 0 ? -1n : 1n;
    const target = Math.abs(number);
    if (Math.abs(target - Math.round(target)) < 1e-12) return { n: sign * BigInt(Math.round(target)), d: 1n };
    let x = target;
    let h0 = 0n, h1 = 1n, k0 = 1n, k1 = 0n;
    let best = null;
    for (let i = 0; i < 32; i++) {
      const whole = Math.floor(x);
      const a = BigInt(whole);
      const h2 = a * h1 + h0;
      const k2 = a * k1 + k0;
      if (k2 > 1000000n) break;
      const error = Math.abs(target - Number(h2) / Number(k2));
      best = { n: h2, d: k2, error };
      if (error < 1e-13) break;
      const remainder = x - whole;
      if (remainder < 1e-15) break;
      x = 1 / remainder;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    }
    return best && best.error <= 1e-11 ? { n: sign * best.n, d: best.d } : null;
  }
  function formatFraction(value, mixed) {
    const ratio = rationalApproximation(value);
    if (!ratio) return formatDisplayNumber(value);
    const negative = ratio.n < 0n;
    const absN = negative ? -ratio.n : ratio.n;
    const d = ratio.d;
    const sign = negative ? '−' : '';
    let text;
    if (d === 1n) text = `${sign}${absN}`;
    else if (mixed && absN >= d) {
      const whole = absN / d;
      const remainder = absN % d;
      text = remainder === 0n ? `${sign}${whole}` : `${sign}${whole} ${remainder}/${d}`;
    } else text = `${sign}${absN}/${d}`;
    return byteLength(text) > 10 ? formatDisplayNumber(value) : text;
  }
  function formatEngineering(value) {
    value = scalar(value);
    if (!Number.isFinite(value) || value === 0) return formatDisplayNumber(value);
    const requestedExponent = Math.floor(Math.log10(Math.abs(value)) / 3) * 3 - state.engineeringShift * 3;
    const exponent = Math.max(-99, Math.min(99, requestedExponent));
    const mantissa = value / (10 ** exponent);
    let text;
    if (state.displayFormat === 'Fix') {
      text = mantissa.toFixed(state.displayDigits);
    } else {
      const digits = state.displayFormat === 'Sci' ? Math.max(1, state.displayDigits) : 10;
      const precision = Number(mantissa.toPrecision(digits));
      const magnitude = Math.floor(Math.log10(Math.abs(mantissa)));
      const decimals = Math.min(30, Math.max(0, digits - 1 - magnitude));
      text = precision === 0 ? '0'
        : Math.abs(precision) >= 1e21 ? precision.toString()
          : precision.toFixed(decimals).replace(/\.?0+$/, '');
    }
    return `${localizeDisplayText(text)}×10^${exponent}`;
  }
  function formatDMS(value) {
    value = scalar(value);
    const maximum = 9999999 + 59 / 60;
    if (!Number.isFinite(value) || Math.abs(value) > maximum) return 'Math ERROR';
    const negative = value < 0 ? '−' : '';
    let totalHundredths = Math.round(Math.abs(value) * 360000);
    let degrees = Math.floor(totalHundredths / 360000);
    totalHundredths -= degrees * 360000;
    let minutes = Math.floor(totalHundredths / 6000);
    totalHundredths -= minutes * 6000;
    let seconds = totalHundredths / 100;
    if (seconds >= 60) { seconds = 0; minutes += 1; }
    if (minutes >= 60) { minutes = 0; degrees += 1; }
    const wholeSeconds = Math.floor(seconds);
    const fraction = Math.round((seconds - wholeSeconds) * 100);
    const secText = `${String(wholeSeconds).padStart(2, '0')}${fraction ? `.${String(fraction).padStart(2, '0').replace(/0+$/, '')}` : ''}`;
    return `${negative}${degrees}° ${String(minutes).padStart(2, '0')}′ ${secText}″`;
  }

  function isFractionCalculationExpression(expression) {
    if (/[A-Za-z]{2,}\(/.test(expression)) return false;
    return /[┘÷]/.test(expression);
  }

  function hasDecimalLiteral(expression) {
    return /(?:\d+\.\d*|\.\d+)(?:[eE][+\-]?\d+)?/.test(expression);
  }

  function formatResult(value) {
    if (state.error) return state.error;
    if (state.dmsDisplay) return state.dmsDisplay;
    if (state.prompt) return state.prompt.result;
    if (Array.isArray(value)) {
      return `${formatDisplayNumber(value[0])}; ${formatDisplayNumber(value[1])}`;
    }
    const number = scalar(value ?? 0);
    if (!Number.isFinite(number)) return 'Math ERROR';
    if (state.fractionView === 1) return formatDisplayNumber(number);
    if (state.fractionView === 2) return formatFraction(value, false);
    if (state.fractionView === 3) return formatFraction(value, true);
    const fractionResult = state.justEvaluated
      && isFractionCalculationExpression(state.expr)
      && !hasDecimalLiteral(state.expr);
    if (fractionResult && !Number.isInteger(number)) return formatFraction(value, state.fractionFormat === 'mixed');
    if (state.engineeringView) return formatEngineering(number);
    return formatDisplayNumber(number);
  }
  function expressionWithCursor() {
    const expr = state.expr || '';
    if (!state.on || state.justEvaluated || state.prompt) return expr;
    const pos = Math.max(0, Math.min(state.cursor, expr.length));
    const marker = expressionStepCount(expr) >= 73 ? '■' : state.insertMode ? '▯' : '▏';
    return `${expr.slice(0, pos)}${marker}${expr.slice(pos)}`;
  }
  function render() {
    statusMode.textContent = state.mode === 'REG' ? `REG ${state.regType}` : state.mode;
    statusAngle.textContent = state.angle;
    const flags = [];
    if (state.shift) flags.push('SHIFT');
    if (state.alpha) flags.push('ALPHA');
    if (state.hyp) flags.push('HYP');
    if (state.displayFormat === 'Fix') flags.push('FIX');
    if (state.displayFormat === 'Sci') flags.push('SCI');
    if (state.insertMode) flags.push('INS');
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'memory') flags.push(state.pending.action === 'store' ? 'STO' : 'RCL');
    if (state.dataEdit !== null) flags.push('EDIT');
    if (state.message) flags.push(state.message);
    statusFlags.textContent = flags.join(' ');
    statusMemory.textContent = state.memory !== 0 ? 'M' : '';
    if (statusHistory) {
      const index = state.replayIndex;
      statusHistory.textContent = state.mode !== 'COMP' || !state.history.length ? ''
        : `${index > 0 || index === -1 ? '↑' : ''}${index >= 0 && index < state.history.length - 1 ? '↓' : ''}`;
    }
    if (statusSteps) {
      const steps = expressionStepCount(state.expr);
      statusSteps.textContent = state.mode === 'COMP' && steps ? `${steps}/79` : '';
    }
    expressionText.textContent = state.prompt ? state.prompt.expression : expressionWithCursor();
    if (!state.prompt && expressionText.scrollWidth > expressionText.clientWidth) {
      let fontSize = 14;
      try { fontSize = Number.parseFloat(window.getComputedStyle(expressionText).fontSize) || fontSize; } catch (_) { /* Test and legacy WebViews may omit computed styles. */ }
      const cursorPosition = state.justEvaluated ? state.expr.length : state.cursor;
      const target = Math.max(0, cursorPosition * fontSize * 0.58 - expressionText.clientWidth + fontSize * 1.5);
      expressionText.scrollLeft = Math.min(target, expressionText.scrollWidth - expressionText.clientWidth);
    } else if (expressionText.scrollWidth <= expressionText.clientWidth) {
      expressionText.scrollLeft = 0;
    }
    resultText.textContent = state.prompt ? state.prompt.result : formatResult(state.resultValue);
    resultText.classList.toggle('prompt-result', Boolean(state.prompt));
    screen.classList.toggle('is-off', !state.on);
    if (screen.style && typeof screen.style.setProperty === 'function') {
      screen.style.setProperty('--lcd-contrast', String(0.72 + (state.contrast / 10) * 0.56));
    }
    document.querySelectorAll('.round-key[data-key="shift"]').forEach((button) => button.classList.toggle('modifier-active', state.shift));
    document.querySelectorAll('.round-key[data-key="alpha"]').forEach((button) => button.classList.toggle('modifier-active', state.alpha));
    const mplus = document.querySelector('.key[data-key="mplus"]');
    if (mplus) {
      const main = mplus.querySelector('.key-main');
      const shifted = mplus.querySelector('.shift-label');
      if (main) main.textContent = state.mode === 'COMP' ? 'M+' : 'DT';
      if (shifted) shifted.textContent = state.mode === 'COMP' ? 'M−' : 'CL';
      mplus.setAttribute('aria-label', state.mode === 'COMP' ? 'Memory plus; Shift memory minus; Alpha M' : 'Data entry; Shift clear selected datum');
    }
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
      state.expr = isOperator ? 'Ans' : '';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
      state.engineeringShift = 0;
    }
    state.error = '';
    state.dmsDisplay = null;
    const at = Math.max(0, Math.min(state.cursor, state.expr.length));
    let end = at;
    if (state.insertMode && at < state.expr.length) {
      const nextSpanCount = Math.max(1, expressionStepCount(text));
      const spans = calculatorStepSpans(state.expr);
      let found = 0;
      for (const span of spans) {
        if (span.start < at) continue;
        if (found >= nextSpanCount) break;
        end = span.end;
        found++;
      }
    }
    const next = state.expr.slice(0, at) + text + state.expr.slice(end);
    if (expressionStepCount(next) > 79) {
      state.message = '79 STEP LIMIT';
      render();
      return false;
    }
    state.expr = next;
    state.cursor = at + text.length;
    state.replayIndex = -1;
    state.message = '';
    if (state.dataEdit) state.dataEdit.dirty = true;
    render();
    return true;
  }
  function appendOperator(operator) {
    if (state.justEvaluated) {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
      state.justEvaluated = false;
      state.error = '';
      state.dmsDisplay = null;
      state.engineeringView = false;
      state.engineeringShift = 0;
    }
    if (state.cursor === 0 && state.expr.length === 0 && operator !== '−') {
      state.expr = 'Ans';
      state.cursor = state.expr.length;
    }
    const before = state.expr.slice(0, state.cursor);
    const trailing = before.match(/(?:\s*(?:nCr|nPr|root)\s*|[+−×÷^])$/i);
    if (trailing) {
      const start = before.length - trailing[0].length;
      state.expr = state.expr.slice(0, start) + operator + state.expr.slice(state.cursor);
      state.cursor = start + operator.length;
      state.error = '';
      state.message = '';
      if (state.dataEdit) state.dataEdit.dirty = true;
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
      state.dmsDisplay = null;
      state.engineeringView = false;
    }
    const before = state.expr.slice(0, state.cursor);
    if (before === 'Ans') {
      state.cursor = 0;
      insertRaw('−', 'operator');
      return;
    }
    const numberMatch = before.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+\-]?\d+)?$/);
    if (numberMatch) {
      const start = before.length - numberMatch[0].length;
      const prefix = before.slice(0, start);
      if (prefix.endsWith('−') && (prefix.length === 1 || /[+−×÷^(,]/.test(prefix.slice(-2, -1)))) {
        state.expr = state.expr.slice(0, start - 1) + state.expr.slice(start);
        state.cursor -= 1;
      } else {
        state.cursor = start;
        if (!insertRaw('−', 'operator')) return;
      }
    } else if (/[A-FXYM]$/.test(before)) {
      state.cursor = Math.max(0, state.cursor - 1);
      if (!insertRaw('−', 'operator')) return;
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
    if (state.justEvaluated) state.justEvaluated = false;
    if (state.error) state.error = '';
    const spans = calculatorStepSpans(state.expr);
    if (!spans.length) { render(); return; }
    let span = spans.find((item) => state.cursor >= item.start && state.cursor < item.end);
    if (!span) span = spans.find((item) => item.start >= state.cursor) || spans[spans.length - 1];
    state.expr = state.expr.slice(0, span.start) + state.expr.slice(span.end);
    state.cursor = span.start;
    state.replayIndex = -1;
    state.dmsDisplay = null;
    state.message = '';
    if (state.dataEdit) state.dataEdit.dirty = true;
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
    state.history = [];
    state.replayIndex = -1;
    state.draft = null;
    state.justEvaluated = false;
    state.hyp = false;
    state.fractionView = 0;
    state.dmsDisplay = null;
    state.engineeringView = false;
    state.engineeringShift = 0;
    state.dataEdit = null;
    state.statMenuIndex = 0;
    render();
  }
  function showModeSetupPage(page) {
    const pages = [
      ['MODE', '1 COMP  2 SD  3 REG'],
      ['ANGLE', '1 DEG  2 RAD  3 GRA'],
      ['FORMAT', '1 FIX  2 SCI  3 NORM'],
      ['FRACTION', '1 ab/c  2 d/c'],
      ['DISP', '1 DOT  2 COMMA'],
      ['CONT', '1 ADJUST']
    ];
    state.modeSetupPage = (page + pages.length) % pages.length;
    const [expression, result] = pages[state.modeSetupPage];
    state.pending = { type: 'setup', page: state.modeSetupPage };
    state.prompt = { expression, result };
    state.message = '';
    render();
  }
  function openModeMenu() {
    if (state.dataEdit !== null) {
      state.pending = { type: 'editOff' };
      state.prompt = { expression: 'DATA EDIT', result: '1 OFF  2 ESC' };
      render();
      return;
    }
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'setup') {
      showModeSetupPage((state.pending.page + 1) % 6);
    } else {
      showModeSetupPage(0);
    }
  }
  function openClearMenu() {
    const first = state.mode === 'COMP' ? 'Mcl' : 'Scl';
    setPrompt('clear', 'CLR', `1 ${first}  2 Mode  3 All`);
  }
  function commitSetupMessage(message) {
    state.modeSetupPage = 0;
    clearPrompt();
    persistState();
    showMessage(message, 1100);
  }
  function selectModeSetup(page, number) {
    if (page === 0) { state.modeSetupPage = 0; selectMode(number); return; }
    if (page === 1) {
      const angle = { '1': 'DEG', '2': 'RAD', '3': 'GRA' }[number];
      if (!angle) return;
      state.angle = angle;
      state.dmsDisplay = null;
      commitSetupMessage(angle);
      return;
    }
    if (page === 2) {
      if (number === '1' || number === '2') {
        const format = number === '1' ? 'Fix' : 'Sci';
        state.pending = { type: 'precision', format, buffer: '' };
        state.prompt = { expression: format.toUpperCase(), result: format === 'Fix' ? '0-9 DECIMALS' : '0-9 SIG DIGITS' };
        render();
      } else if (number === '3') {
      state.displayFormat = 'Norm';
      state.displayDigits = 10;
      state.pending = { type: 'norm' };
        state.prompt = { expression: 'NORM', result: '1 NORM 1  2 NORM 2' };
        render();
      }
      return;
    }
    if (page === 3) {
      if (number !== '1' && number !== '2') return;
      state.fractionFormat = number === '1' ? 'mixed' : 'improper';
      state.fractionView = 0;
      commitSetupMessage(number === '1' ? 'MIXED FRACTION' : 'IMPROPER FRACTION');
      return;
    }
    if (page === 4) {
      if (number !== '1' && number !== '2') return;
      state.decimalSymbol = number === '1' ? '.' : ',';
      commitSetupMessage(number === '1' ? 'DOT' : 'COMMA');
      return;
    }
    if (page === 5 && number === '1') {
      state.pending = { type: 'contrast' };
      state.prompt = { expression: 'CONTRAST', result: '◀ DARKER  BRIGHTER ▶' };
      render();
    }
  }
  function commitPrecision() {
    const pending = state.pending;
    if (!pending || pending.type !== 'precision' || !pending.buffer) return false;
    const digits = Number(pending.buffer);
    const valid = pending.format === 'Fix'
      ? digits >= 0 && digits <= 9
      : digits >= 0 && digits <= 10;
    if (!valid) {
      clearPrompt();
      state.error = 'Math ERROR';
      render();
      return true;
    }
    state.displayFormat = pending.format;
    state.displayDigits = pending.format === 'Sci' && digits === 0 ? 10 : digits;
    commitSetupMessage(`${pending.format.toUpperCase()} ${state.displayDigits}`);
    return true;
  }
  function selectMode(number) {
    const next = { '1': 'COMP', '2': 'SD', '3': 'REG' }[number];
    if (!next) return;
    state.mode = next;
    state.history = [];
    state.replayIndex = -1;
    state.draft = null;
    state.stats = [];
    state.statsRetained = true;
    state.dataEdit = null;
    state.lastRegression = null;
    state.regTypePage = 0;
    if (next === 'COMP') {
      state.regType = 'Lin';
      clearPrompt();
      clearAll();
      persistState();
      return;
    }
    if (next === 'SD') {
      state.regType = 'Lin';
      clearPrompt();
      clearAll();
      persistState();
      showMessage('SD MODE', 1100);
      return;
    }
    state.regType = 'Lin';
    setPrompt('regtype', 'REG 1/2', '1 Lin  2 Log  3 Exp  ▶');
    persistState();
  }
  function selectRegression(number) {
    const types = { '1': 'Lin', '2': 'Log', '3': 'Exp', '4': 'Pwr', '5': 'Inv', '6': 'Quad' };
    if (!types[number]) return;
    state.regType = types[number];
    state.stats = [];
    state.statsRetained = true;
    state.dataEdit = null;
    state.lastRegression = null;
    state.history = [];
    state.replayIndex = -1;
    for (const key of ['A', 'B', 'C', 'D', 'E', 'F', 'X', 'Y']) state.vars[key] = 0;
    state.regTypePage = number >= 4 ? 1 : 0;
    clearPrompt();
    clearAll();
    persistState();
    showMessage(`${state.regType} REG`, 1100);
  }
  function performClear(number) {
    clearPrompt();
    if (number === '1') {
      if (state.mode !== 'COMP') {
        state.stats = [];
        state.statsRetained = true;
        state.dataEdit = null;
        state.lastRegression = null;
        clearAll();
        persistState();
        showMessage('STAT DATA CLEARED', 1000);
        return;
      }
      state.vars = Object.fromEntries(variableNames.map((key) => [key, 0]));
      state.memory = 0;
      state.memorySet = false;
      state.vars.M = 0;
      clearAll();
      persistState();
      showMessage('MEMORY CLEARED', 1000);
      return;
    }
    if (number === '2') {
      state.mode = 'COMP';
      state.angle = 'DEG';
      state.regType = 'Lin';
      state.hyp = false;
      state.displayFormat = 'Norm';
      state.displayDigits = 10;
      state.normSetting = 1;
      state.fractionFormat = 'mixed';
      state.fractionView = 0;
      state.decimalSymbol = '.';
      state.contrast = 5;
      state.modeSetupPage = 0;
      state.stats = [];
      state.statsRetained = true;
      state.dataEdit = null;
      state.lastRegression = null;
      state.history = [];
      state.replayIndex = -1;
      clearAll();
      persistState();
      showMessage('MODE RESET', 1000);
      return;
    }
    if (number === '3') {
      state.mode = 'COMP';
      state.angle = 'DEG';
      state.regType = 'Lin';
      state.hyp = false;
      state.displayFormat = 'Norm';
      state.displayDigits = 10;
      state.normSetting = 1;
      state.fractionFormat = 'mixed';
      state.fractionView = 0;
      state.decimalSymbol = '.';
      state.contrast = 5;
      state.modeSetupPage = 0;
      state.ans = 0;
      state.vars = Object.fromEntries(variableNames.map((key) => [key, 0]));
      state.memory = 0;
      state.memorySet = false;
      state.stats = [];
      state.statsRetained = true;
      state.dataEdit = null;
      state.lastRegression = null;
      state.history = [];
      state.replayIndex = -1;
      clearAll();
      persistState();
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
    try {
      if (action === 'store') {
        const value = currentValue();
        state.vars[letter] = value;
        if (letter === 'M') {
          state.memory = scalar(value);
          state.memorySet = state.memory !== 0;
          state.vars.M = state.memory;
        }
        state.ans = value;
        state.resultValue = value;
        state.justEvaluated = true;
        state.error = '';
        persistState();
        showMessage(`${letter} STORED`, 1200);
      } else {
        const value = letter === 'M' ? state.memory : (state.vars[letter] ?? 0);
        state.resultValue = value;
        state.error = '';
        state.dmsDisplay = null;
        state.engineeringView = false;
        insertRaw(letter, 'operand');
        showMessage(`${letter} RECALLED`, 900);
      }
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      render();
    }
  }
  function currentValue() {
    if (state.expr.trim()) {
      try {
        const result = evaluateExpression(autoclose(state.expr));
        const number = scalar(result);
        if (!Number.isFinite(number)) throw new CalcError('Math ERROR');
        return result;
      } catch (error) {
        throw error instanceof CalcError ? error : new CalcError('Syntax ERROR');
      }
    }
    return state.resultValue ?? state.ans ?? 0;
  }
  function addMemory(subtract = false) {
    try {
      const value = currentValue();
      const next = cleanZero(state.memory + (subtract ? -scalar(value) : scalar(value)));
      assertCalculatorRange(next);
      state.memory = scalar(next);
      state.memorySet = state.memory !== 0;
      state.vars.M = state.memory;
      state.ans = value;
      state.resultValue = value;
      state.justEvaluated = true;
      state.error = '';
      state.dmsDisplay = null;
      persistState();
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
    const index = state.dataEdit ? state.dataEdit.index : state.stats.length - 1;
    state.stats.splice(index, 1);
    state.lastRegression = null;
    if (state.stats.length) {
      const nextIndex = Math.min(index, state.stats.length - 1);
      state.dataEdit = { index: nextIndex, dirty: false };
      state.expr = serializeStatRecord(state.stats[nextIndex]);
      state.cursor = state.expr.length;
    } else {
      state.dataEdit = null;
      state.expr = '';
      state.cursor = 0;
    }
    state.justEvaluated = false;
    state.resultValue = statCount();
    state.error = '';
    persistState();
    showMessage('DATA CLEARED', 1000);
  }
  function splitStatPair(expression) {
    let depth = 0;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      else if (expression[i] === ',' && depth === 0) {
        return [expression.slice(0, i), expression.slice(i + 1)];
      }
    }
    return null;
  }

  function splitFrequency(expression) {
    let depth = 0;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      else if (expression[i] === ';' && depth === 0) {
        return [expression.slice(0, i), expression.slice(i + 1)];
      }
    }
    return [expression, ''];
  }

  function statCount() {
    return state.stats.reduce((total, row) => total + (row.f || 1), 0);
  }

  function parseStatRecord(source) {
    const [dataExpression, frequencyExpression] = splitFrequency(source);
    const frequencyValue = frequencyExpression.trim()
      ? scalar(evaluateExpression(autoclose(frequencyExpression))) : 1;
    if (!Number.isInteger(frequencyValue) || frequencyValue < 1 || frequencyValue > 999) {
      throw new CalcError('Math ERROR');
    }
    if (state.mode === 'REG') {
      const pair = splitStatPair(dataExpression);
      if (!pair || !pair[0].trim() || !pair[1].trim()) throw new CalcError('Syntax ERROR');
      const x = scalar(evaluateExpression(autoclose(pair[0])));
      const y = scalar(evaluateExpression(autoclose(pair[1])));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new CalcError('Math ERROR');
      return { x, y, f: frequencyValue };
    }
    if (!dataExpression.trim()) throw new CalcError('Syntax ERROR');
    const x = scalar(evaluateExpression(autoclose(dataExpression)));
    if (!Number.isFinite(x)) throw new CalcError('Math ERROR');
    return { x, f: frequencyValue };
  }

  function serializeStatRecord(row) {
    const base = state.mode === 'REG' ? `${formatNumber(row.x)},${formatNumber(row.y)}` : formatNumber(row.x);
    return row.f > 1 ? `${base};${row.f}` : base;
  }

  function browseData(direction) {
    if (!state.statsRetained) { showMessage('DATA NOT STORED', 900); return; }
    if (!state.stats.length) { showMessage('NO DATA', 900); return; }
    let index;
    if (!state.dataEdit) index = direction < 0 ? state.stats.length - 1 : 0;
    else index = Math.max(0, Math.min(state.stats.length - 1, state.dataEdit.index + direction));
    state.dataEdit = { index, dirty: false };
    state.expr = serializeStatRecord(state.stats[index]);
    state.cursor = state.expr.length;
    state.justEvaluated = false;
    state.error = '';
    state.message = '';
    state.resultValue = statCount();
    clearPrompt();
    render();
  }

  function commitEditedStat() {
    if (!state.dataEdit) return false;
    if (!state.dataEdit.dirty) { showMessage('EDIT OFF  1 OFF  2 ESC', 0); return true; }
    try {
      const row = parseStatRecord(state.expr);
      state.stats[state.dataEdit.index] = row;
      state.dataEdit.dirty = false;
      state.lastRegression = null;
      state.resultValue = statCount();
      state.error = '';
      state.expr = serializeStatRecord(row);
      state.cursor = state.expr.length;
      persistState();
      render();
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      render();
    }
    return true;
  }
  function registerStatDatum(datum) {
    if (state.stats.length >= 10000) throw new CalcError('Data Full');
    state.stats.push(datum);
    state.expr = '';
    state.cursor = 0;
    state.dataEdit = null;
    state.justEvaluated = false;
    state.error = '';
    state.lastRegression = null;
    state.resultValue = statCount();
    state.ans = state.mode === 'REG' ? datum.y : datum.x;
    state.dmsDisplay = null;
    if (state.mode === 'REG') {
      try {
        const fit = regressionFit(state.stats, state.regType);
        state.lastRegression = fit;
        state.vars.A = fit.a;
        state.vars.B = fit.b;
        if (fit.c !== undefined) state.vars.C = fit.c;
      } catch (_) { /* Keep partial data until enough distinct points exist. */ }
    }
    persistState();
    showMessage(`n=${statCount()}`, 1100);
  }
  function addStatDatum() {
    try {
      const hasInput = Boolean(state.expr.trim());
      let datum;
      if (hasInput) {
        datum = parseStatRecord(autoclose(state.expr));
      } else if (state.stats.length) {
        const last = state.stats[state.stats.length - 1];
        datum = { ...last, f: 1 };
      } else {
        throw new CalcError('Syntax ERROR');
      }
      if (state.statsRetained && state.stats.length >= 80) {
        state.pending = { type: 'dataFull', stage: 'warning', datum };
        state.prompt = { expression: 'DATA FULL', result: 'PRESS AC TO CONTINUE' };
        render();
        return;
      }
      registerStatDatum(datum);
    } catch (error) {
      state.error = error.message || 'Math ERROR';
      render();
    }
  }
  function statisticsValues() {
    const n = statCount();
    if (!n) throw new CalcError('NO DATA');
    const sum = state.stats.reduce((total, row) => total + row.x * (row.f || 1), 0);
    const sumSq = state.stats.reduce((total, row) => total + row.x * row.x * (row.f || 1), 0);
    const mean = sum / n;
    const ssX = state.stats.reduce((total, row) => total + (row.x - mean) ** 2 * (row.f || 1), 0);
    const output = {
      n, sum, sumSq, mean,
      sigmaX: Math.sqrt(Math.max(0, ssX / n)),
      sampleX: Math.sqrt(Math.max(0, n > 1 ? ssX / (n - 1) : 0))
    };
    if (state.mode === 'REG') {
      const sumY = state.stats.reduce((total, row) => total + row.y * (row.f || 1), 0);
      const sumY2 = state.stats.reduce((total, row) => total + row.y * row.y * (row.f || 1), 0);
      const sumXY = state.stats.reduce((total, row) => total + row.x * row.y * (row.f || 1), 0);
      const meanY = sumY / n;
      const ssY = state.stats.reduce((total, row) => total + (row.y - meanY) ** 2 * (row.f || 1), 0);
      Object.assign(output, {
        sumY, sumY2, sumXY, meanY,
        sigmaY: Math.sqrt(Math.max(0, ssY / n)),
        sampleY: Math.sqrt(Math.max(0, n > 1 ? ssY / (n - 1) : 0))
      });
      if (state.regType === 'Quad') {
        output.sumX3 = state.stats.reduce((total, row) => total + row.x ** 3 * (row.f || 1), 0);
        output.sumX2Y = state.stats.reduce((total, row) => total + row.x ** 2 * row.y * (row.f || 1), 0);
        output.sumX4 = state.stats.reduce((total, row) => total + row.x ** 4 * (row.f || 1), 0);
      }
    }
    return output;
  }
  function leastSquares(xs, ys, weights = xs.map(() => 1)) {
    const n = weights.reduce((total, weight) => total + weight, 0);
    if (n < 2) throw new CalcError('NO DATA');
    const mx = xs.reduce((total, x, i) => total + x * weights[i], 0) / n;
    const my = ys.reduce((total, y, i) => total + y * weights[i], 0) / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += weights[i] * (xs[i] - mx) ** 2;
      syy += weights[i] * (ys[i] - my) ** 2;
      sxy += weights[i] * (xs[i] - mx) * (ys[i] - my);
    }
    if (sxx === 0) throw new CalcError('Math ERROR');
    const b = sxy / sxx;
    const a = my - b * mx;
    const r = syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
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
    const weights = rows.map((row) => row.f || 1);
    const n = weights.reduce((total, weight) => total + weight, 0);
    if (n < (type === 'Quad' ? 3 : 2)) throw new CalcError('NO DATA');
    const xs = rows.map((row) => row.x);
    const ys = rows.map((row) => row.y);
    if (type === 'Quad') {
      const s1 = rows.reduce((total, row) => total + row.x * (row.f || 1), 0);
      const s2 = rows.reduce((total, row) => total + row.x ** 2 * (row.f || 1), 0);
      const s3 = rows.reduce((total, row) => total + row.x ** 3 * (row.f || 1), 0);
      const s4 = rows.reduce((total, row) => total + row.x ** 4 * (row.f || 1), 0);
      const sy = rows.reduce((total, row) => total + row.y * (row.f || 1), 0);
      const sxy = rows.reduce((total, row) => total + row.x * row.y * (row.f || 1), 0);
      const sx2y = rows.reduce((total, row) => total + row.x ** 2 * row.y * (row.f || 1), 0);
      const [a, b, c] = solve3([[n, s1, s2], [s1, s2, s3], [s2, s3, s4]], [sy, sxy, sx2y]);
      return { a, b, c, r: 0 };
    }
    let tx = [...xs], ty = [...ys], decode = (a, b) => ({ a, b });
    if (type === 'Log') {
      if (xs.some((x) => x <= 0)) throw new CalcError('Math ERROR');
      tx = xs.map(Math.log);
    } else if (type === 'Exp') {
      if (ys.some((y) => y <= 0)) throw new CalcError('Math ERROR');
      ty = ys.map(Math.log);
      decode = (a, b) => ({ a: Math.exp(a), b });
    } else if (type === 'Pwr') {
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) throw new CalcError('Math ERROR');
      tx = xs.map(Math.log); ty = ys.map(Math.log);
      decode = (a, b) => ({ a: Math.exp(a), b });
    } else if (type === 'Inv') {
      if (xs.some((x) => x === 0)) throw new CalcError('Math ERROR');
      tx = xs.map((x) => 1 / x);
    }
    const fit = leastSquares(tx, ty, weights);
    return { ...decode(fit.a, fit.b), r: fit.r };
  }
  function openStatisticsMenu(which) {
    if (state.mode === 'COMP') {
      showMessage('SELECT SD OR REG MODE', 1300);
      return;
    }
    if (state.dataEdit) {
      showMessage('PRESS AC TO EXIT DATA', 1300);
      return;
    }
    if (which === 'sum') {
      const choices = state.mode === 'REG'
        ? state.regType === 'Quad' ? '1 Σx² 2 Σx 3 n 4 Σy² 5 Σy 6 Σxy 0 More' : '1 Σx² 2 Σx 3 n 4 Σy² 5 Σy 6 Σxy'
        : '1 Σx² 2 Σx 3 n';
      setPrompt('statSum', 'S-SUM', choices);
    } else {
      const choices = state.mode === 'REG'
        ? '1 x̄ 2 σx 3 sx 4 ȳ 5 σy 6 sy 7 A 8 B 0 More'
        : '1 x̄ 2 σx 3 sx';
      setPrompt('statVar', 'S-VAR', choices);
    }
  }

  function openStatisticsMore(which) {
    if (which === 'sum') {
      setPrompt('statSumMore', 'S-SUM+', state.regType === 'Quad'
        ? '1 Σx³ 2 Σx²y 3 Σx⁴'
        : 'No additional sums');
      return;
    }
    const choices = state.regType === 'Quad'
      ? '1 C 2 ŷ 3 x̂1 4 x̂2'
      : '1 r 2 x̂ 3 ŷ';
    setPrompt('statVarMore', 'S-VAR+', choices);
  }

  function regressionEstimate(type, fit, input, estimateX) {
    const { a, b, c } = fit;
    if (![a, b].every(Number.isFinite)) throw new CalcError('NO DATA');
    if (type === 'Quad') {
      if (estimateX) return a + b * input + c * input * input;
      if (Math.abs(c) < 1e-14) {
        if (Math.abs(b) < 1e-14) throw new CalcError();
        return [(input - a) / b, NaN];
      }
      const discriminant = b * b - 4 * c * (a - input);
      if (discriminant < 0) throw new CalcError();
      const root = Math.sqrt(discriminant);
      return [(-b + root) / (2 * c), (-b - root) / (2 * c)];
    }
    if (estimateX) {
      if (type === 'Log') {
        if (input <= 0) throw new CalcError();
        return a + b * Math.log(input);
      }
      if (type === 'Exp') return a * Math.exp(b * input);
      if (type === 'Pwr') {
        if (input <= 0) throw new CalcError();
        return a * input ** b;
      }
      if (type === 'Inv') {
        if (input === 0) throw new CalcError();
        return a + b / input;
      }
      return a + b * input;
    }
    if (Math.abs(b) < 1e-14) throw new CalcError();
    if (type === 'Log') return Math.exp((input - a) / b);
    if (type === 'Exp') {
      if (input / a <= 0) throw new CalcError();
      return Math.log(input / a) / b;
    }
    if (type === 'Pwr') {
      if (input / a <= 0) throw new CalcError();
      return (input / a) ** (1 / b);
    }
    if (type === 'Inv') {
      if (input === a) throw new CalcError();
      return b / (input - a);
    }
    return (input - a) / b;
  }

  function selectStatistic(which, choice) {
    if (which === 'sum' && choice === '0') { openStatisticsMore('sum'); return; }
    if (which === 'var' && choice === '0') { openStatisticsMore('var'); return; }
    try {
      const values = statisticsValues();
      let fit = state.lastRegression;
      if (state.mode === 'REG' && (which === 'varMore' || (which === 'var' && ['7', '8'].includes(choice)))) {
        fit = regressionFit(state.stats, state.regType);
        state.lastRegression = fit;
        state.vars.A = fit.a;
        state.vars.B = fit.b;
        if (fit.c !== undefined) state.vars.C = fit.c;
      }
      let value;
      if (which === 'sum') {
        value = state.mode === 'REG'
          ? ({ '1': values.sumSq, '2': values.sum, '3': values.n, '4': values.sumY2, '5': values.sumY, '6': values.sumXY })[choice]
          : ({ '1': values.sumSq, '2': values.sum, '3': values.n })[choice];
      } else if (which === 'sumMore') {
        value = ({ '1': values.sumX3, '2': values.sumX2Y, '3': values.sumX4 })[choice];
      } else if (which === 'var') {
        value = state.mode === 'REG'
          ? ({ '1': values.mean, '2': values.sigmaX, '3': values.sampleX,
            '4': values.meanY, '5': values.sigmaY, '6': values.sampleY, '7': fit?.a, '8': fit?.b })[choice]
          : ({ '1': values.mean, '2': values.sigmaX, '3': values.sampleX })[choice];
      } else if (which === 'varMore') {
        if (!fit) fit = regressionFit(state.stats, state.regType);
        state.lastRegression = fit;
        state.vars.A = fit.a;
        state.vars.B = fit.b;
        if (fit.c !== undefined) state.vars.C = fit.c;
        if (state.regType === 'Quad') {
          if (choice === '1') value = fit.c;
          else if (['2', '3', '4'].includes(choice)) {
            const input = scalar(currentValue());
            if (choice === '2') {
              state.vars.X = input;
              value = regressionEstimate(state.regType, fit, input, true);
            } else {
              state.vars.Y = input;
              value = regressionEstimate(state.regType, fit, input, false)[choice === '3' ? 0 : 1];
            }
          }
        } else if (choice === '1') {
          value = fit.r;
        } else if (choice === '2') {
          const input = scalar(currentValue());
          state.vars.Y = input;
          value = regressionEstimate(state.regType, fit, input, false);
        } else if (choice === '3') {
          const input = scalar(currentValue());
          state.vars.X = input;
          value = regressionEstimate(state.regType, fit, input, true);
        }
      }
      if (value === undefined || !Number.isFinite(scalar(value))) throw new CalcError('NO DATA');
      clearPrompt();
      state.resultValue = roundInternal(scalar(value));
      state.ans = state.resultValue;
      state.expr = '';
      state.cursor = 0;
      state.justEvaluated = true;
      state.error = '';
      state.dmsDisplay = null;
      persistState();
      render();
    } catch (error) {
      clearPrompt();
      state.error = error.message || 'NO DATA';
      render();
    }
  }
  function autoclose(expression) {
    let opens = 0, closes = 0;
    for (const character of expression) {
      if (character === '(') opens++;
      else if (character === ')') closes++;
    }
    if (opens > closes) return expression + ')'.repeat(opens - closes);
    return expression;
  }

  function splitStatements(expression) {
    const parts = [];
    let depth = 0, start = 0;
    for (let i = 0; i < expression.length; i++) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      else if (expression[i] === ':' && depth === 0) {
        parts.push(expression.slice(start, i));
        start = i + 1;
      }
    }
    parts.push(expression.slice(start));
    return parts;
  }

  function hasSexagesimalResultRule(expression) {
    const count = (expression.match(/°/g) || []).length;
    if (count >= 2 && /[+−-]/.test(expression)) return true;
    return count === 1 && /[×*÷/]/.test(expression);
  }
  function preprocessExpression(expression) {
    let source = String(expression).replace(/[−–]/g, '-').replace(/÷/g, '/').replace(/×/g, '*');
    const fractionLiterals = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:┘(?:\d+(?:\.\d*)?|\.\d+)){1,2}/g) || [];
    for (const literal of fractionLiterals) {
      const displayCells = (literal.match(/\d/g) || []).length + (literal.match(/┘/g) || []).length;
      if (displayCells > 10) throw new CalcError('Math ERROR');
    }
    if (state.fractionFormat === 'improper' && /-?\d+(?:\.\d+)?┘\d+(?:\.\d+)?┘\d/.test(source)) {
      throw new CalcError('Math ERROR');
    }
    source = source.replace(/(-?\d+(?:\.\d+)?)┘(\d+(?:\.\d+)?)┘(\d+(?:\.\d+)?)/g,
      (match, whole, numerator, denominator) => {
        const negative = whole.startsWith('-');
        const absoluteWhole = negative ? whole.slice(1) : whole;
        const mixed = `(${absoluteWhole}+${numerator}/${denominator})`;
        return negative ? `-${mixed}` : mixed;
      });
    source = source.replace(/┘/g, '/');
    const dmsNumber = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const dmsLimit = 9.999999999e99;
    const dmsValue = (degrees, minutes, seconds) => {
      const degreeValue = Number(degrees);
      const minuteValue = Number(minutes);
      const secondValue = seconds === undefined ? 0 : Number(seconds);
      if (![degreeValue, minuteValue, secondValue].every(Number.isFinite)
          || Math.abs(degreeValue) > dmsLimit || minuteValue < 0 || minuteValue > dmsLimit
          || secondValue < 0 || secondValue > dmsLimit) throw new CalcError('Math ERROR');
      const negative = degreeValue < 0;
      const whole = String(Math.abs(degreeValue));
      const dms = seconds === undefined
        ? `(${whole}+${minutes}/60)`
        : `(${whole}+${minutes}/60+${seconds}/3600)`;
      return negative ? `-${dms}` : dms;
    };
    source = source.replace(new RegExp(`(-?${dmsNumber})°(${dmsNumber})′(${dmsNumber})″?`, 'g'),
      (match, degrees, minutes, seconds) => dmsValue(degrees, minutes, seconds));
    source = source.replace(new RegExp(`(-?${dmsNumber})°(${dmsNumber})′`, 'g'),
      (match, degrees, minutes) => dmsValue(degrees, minutes));
    source = source.replace(/(-?\d+(?:\.\d+)?|\.\d+)°/g, '$1');
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
        tokens.push({ type: 'number', value: rationalFromDecimal(raw) });
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
      } else if (raw === 'e') {
        tokens.push({ type: 'constant', value: Math.E });
      } else if (lower === 'ans') {
        tokens.push({ type: 'constant', value: state.ans });
      } else if (variableNames.includes(raw) && raw.length === 1) {
        tokens.push({ type: 'constant', value: raw === 'M' ? state.memory : (state.vars[raw] ?? 0) });
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

  function trigInputLimit(value) {
    const magnitude = Math.abs(value);
    if (state.angle === 'DEG' && magnitude >= 9e9) throw new CalcError('Math ERROR');
    if (state.angle === 'RAD' && magnitude >= 157079632.7) throw new CalcError('Math ERROR');
    if (state.angle === 'GRA' && magnitude >= 1e10) throw new CalcError('Math ERROR');
  }

  function assertTangentArgument(value) {
    trigInputLimit(value);
    const period = state.angle === 'DEG' ? 90 : state.angle === 'GRA' ? 100 : Math.PI / 2;
    const quotient = value / period;
    const nearest = Math.round(quotient);
    const tolerance = 1e-12 * Math.max(1, Math.abs(quotient));
    if (Math.abs(nearest % 2) === 1 && Math.abs(quotient - nearest) <= tolerance) {
      throw new CalcError('Math ERROR');
    }
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
    const radius = roundInternal(Math.hypot(scalar(x), scalar(y)));
    let theta = radiansToAngle(Math.atan2(scalar(y), scalar(x)));
    if (state.angle === 'DEG' && Math.abs(theta + 180) < 1e-12) theta = 180;
    if (state.angle === 'GRA' && Math.abs(theta + 200) < 1e-12) theta = 200;
    if (state.angle === 'RAD' && Math.abs(theta + Math.PI) < 1e-12) theta = Math.PI;
    theta = roundInternal(theta);
    state.vars.E = radius;
    state.vars.F = theta;
    persistState();
    return [radius, theta];
  }
  function rectangular(radius, theta) {
    const r = scalar(radius);
    const radians = angleToRadians(scalar(theta));
    const x = roundInternal(r * Math.cos(radians));
    const y = roundInternal(r * Math.sin(radians));
    state.vars.E = cleanZero(x);
    state.vars.F = cleanZero(y);
    persistState();
    return [state.vars.E, state.vars.F];
  }
  function applyFunction(name, args) {
    const arity = name === 'rand' ? 0 : (name === 'pol' || name === 'rec' ? 2 : 1);
    if (args.length !== arity) throw new CalcError('Arg ERROR');
    for (const argument of args) assertCalculatorRange(argument);
    const first = args[0] ?? 0;
    const a = scalar(first);
    const magnitude = Math.abs(a);
    if (['sin', 'cos', 'tan'].includes(name)) {
      if (name === 'tan') assertTangentArgument(a);
      else trigInputLimit(a);
    }
    if (['sinh', 'cosh'].includes(name) && magnitude > 230.2585092 + 1e-12) throw new CalcError('Math ERROR');
    if (name === 'asinh' && magnitude > 4.999999999e99 * (1 + 1e-14)) throw new CalcError('Math ERROR');
    if (name === 'acosh' && (a < 1 || magnitude > 4.999999999e99 * (1 + 1e-14))) throw new CalcError('Math ERROR');
    if (name === 'tanh' && magnitude > 9.999999999e99 * (1 + 1e-14)) throw new CalcError('Math ERROR');
    if (name === 'atanh' && magnitude > 0.9999999999 + 1e-15) throw new CalcError('Math ERROR');
    if (['log', 'ln'].includes(name) && a <= 0) throw new CalcError('Math ERROR');
    if (name === 'rec') {
      if (scalar(args[0]) < 0) throw new CalcError('Math ERROR');
      trigInputLimit(scalar(args[1]));
    }
    let result;
    switch (name) {
      case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan':
      case 'sinh': case 'cosh': case 'tanh': case 'asinh': case 'acosh': case 'atanh':
        result = trig(name, a); break;
      case 'log': result = Math.log10(a); break;
      case 'ln': result = Math.log(a); break;
      case 'sqrt': result = Math.sqrt(a); break;
      case 'cbrt': result = Math.cbrt(a); break;
      case 'exp': result = Math.exp(a); break;
      case 'abs': result = Math.abs(a); break;
      case 'floor': result = Math.floor(a); break;
      case 'ceil': result = Math.ceil(a); break;
      case 'rnd': result = roundToDisplayPrecision(a); break;
      case 'rand': result = Math.floor(Math.random() * 1000) / 1000; break;
      case 'pol': return polar(args[0], args[1]);
      case 'rec': return rectangular(args[0], args[1]);
      default: throw new CalcError('Syntax ERROR');
    }
    if (!Number.isFinite(result)) throw new CalcError('Math ERROR');
    return roundInternal(result);
  }
  function factorial(value) {
    const n = scalar(value);
    if (!Number.isInteger(n) || n < 0 || n > 69) throw new CalcError('Math ERROR');
    let out = 1;
    for (let i = 2; i <= n; i++) out *= i;
    return assertCalculatorRange(roundInternal(out));
  }
  function permutation(nValue, rValue, combination) {
    const n = scalar(nValue), r = scalar(rValue);
    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(r) || n < 0 || r < 0 || r > n || n >= 1e10) {
      throw new CalcError('Math ERROR');
    }
    let terms = combination ? Math.min(r, n - r) : r;
    let result = 1;
    for (let i = 0; i < terms; i++) {
      result *= n - i;
      if (combination) result /= i + 1;
      if (!Number.isFinite(result) || result > 9.999999999e99) throw new CalcError('Math ERROR');
    }
    return assertCalculatorRange(roundInternal(result));
  }
  function operatorPrecedence(operator) {
    if (operator === '+' || operator === '-') return 1;
    if (operator === '*' || operator === '/') return 2;
    if (operator === 'ncr' || operator === 'npr' || operator === 'root') return 3;
    if (operator === '^') return 4;
    return -1;
  }

  function applyOperator(operator, left, right) {
    assertCalculatorRange(isPercent(left) ? left.raw : left);
    assertCalculatorRange(isPercent(right) ? right.raw : right);
    const a = scalar(left);
    const b = scalar(right);
    const percentRatio = (percent) => isRational(percent.raw)
      ? rationalBinary('/', percent.raw, makeRational(100n))
      : roundInternal(scalar(percent.raw) / 100);
    let result;
    if (['+', '-', '*', '/'].includes(operator)) {
      let r = right;
      if (isPercent(right)) r = percentRatio(right);
      if ((operator === '+' || operator === '-') && isPercent(right)) {
        const delta = rationalBinary('*', left, r);
        if (delta !== null && isRational(left)) {
          result = rationalBinary(operator, left, delta);
        } else {
          result = operator === '+' ? a + a * scalar(r) : a - a * scalar(r);
        }
      } else {
        result = rationalBinary(operator, left, r);
        if (result === null) {
          const rightValue = isPercent(right) ? scalar(right) : b;
          if (operator === '+') result = a + rightValue;
          else if (operator === '-') result = a - rightValue;
          else if (operator === '*') result = a * rightValue;
          else {
            if (rightValue === 0) throw new CalcError('Math ERROR');
            result = a / rightValue;
          }
        }
      }
    } else if (operator === '^') {
      if (a === 0 && b <= 0) throw new CalcError('Math ERROR');
      if (a < 0 && !Number.isInteger(b)) throw new CalcError('Math ERROR');
      if (a === 10 && (b < -9.999999999e99 || b > 99.99999999)) throw new CalcError('Math ERROR');
      if (a === Math.E && (b < -9.999999999e99 || b > 230.2585092)) throw new CalcError('Math ERROR');
      result = a ** b;
    } else if (operator === 'root') {
      if (a === 0) throw new CalcError('Math ERROR');
      if (b < 0) {
        if (Number.isInteger(a) && Math.abs(a % 2) === 1) result = -((-b) ** (1 / a));
        else throw new CalcError('Math ERROR');
      } else result = b ** (1 / a);
    } else if (operator === 'ncr') {
      result = permutation(left, right, true);
    } else if (operator === 'npr') {
      result = permutation(left, right, false);
    } else {
      throw new CalcError('Syntax ERROR');
    }
    if (!Number.isFinite(scalar(result))) throw new CalcError('Math ERROR');
    if (!isRational(result)) result = roundInternal(result);
    return assertCalculatorRange(result);
  }
  function parseTokens(tokens) {
    let index = 0;
    let parseDepth = 0;
    let numericStackDepth = 0;
    let powerDepth = 0;
    const peek = () => tokens[index];
    const take = () => tokens[index++];
    const negate = (value) => {
      if (isRational(value)) return makeRational(-value.n, value.d);
      if (isPercent(value)) return { __percent: true, raw: negate(value.raw) };
      return -scalar(value);
    };

    function parsePrimary() {
      const token = take();
      if (!token) throw new CalcError('Syntax ERROR');
      if (token.type === 'number' || token.type === 'constant') {
        assertCalculatorRange(token.value);
        return token.value;
      }
      if (token.type === 'operator' && (token.value === '+' || token.value === '-')) {
        const value = parseExpression(4);
        return token.value === '-' ? negate(value) : value;
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
              numericStackDepth += 1;
              if (numericStackDepth > 10) {
                numericStackDepth -= 1;
                throw new CalcError('Stack ERROR');
              }
              try { args.push(parseExpression(0)); }
              finally { numericStackDepth -= 1; }
            }
          }
          if (!peek() || peek().type !== 'rparen') throw new CalcError('Syntax ERROR');
          take();
        } else if (peek()) {
          args.push(parseExpression(5));
        }
        if (token.value === 'rand' && args.length === 0) return Math.floor(Math.random() * 1000) / 1000;
        if (!args.length && token.value !== 'pol' && token.value !== 'rec') throw new CalcError('Syntax ERROR');
        return applyFunction(token.value, args);
      }
      throw new CalcError('Syntax ERROR');
    }

    function parseExpression(minimum) {
      parseDepth += 1;
      if (parseDepth > 25) {
        parseDepth -= 1;
        throw new CalcError('Stack ERROR');
      }
      try {
        let left = parsePrimary();
        while (peek()) {
          const token = peek();
          if (token.type === 'postfix') {
            take();
            if (token.value === '!') left = factorial(left);
            else if (token.value === '%') {
              assertCalculatorRange(left);
              left = { __percent: true, raw: left };
            }
            continue;
          }
          if (token.type !== 'operator') break;
          const precedence = operatorPrecedence(token.value);
          if (precedence < minimum) break;
          take();
          const rightAssociative = token.value === '^';
          if (rightAssociative) {
            powerDepth += 1;
            if (powerDepth > 10) {
              powerDepth -= 1;
              throw new CalcError('Stack ERROR');
            }
          }
          numericStackDepth += 1;
          if (numericStackDepth > 10) {
            numericStackDepth -= 1;
            if (rightAssociative) powerDepth -= 1;
            throw new CalcError('Stack ERROR');
          }
          let right;
          try {
            right = parseExpression(precedence + (rightAssociative ? 0 : 1));
          } finally {
            numericStackDepth -= 1;
            if (rightAssociative) powerDepth -= 1;
          }
          left = applyOperator(token.value, left, right);
        }
        return left;
      } finally {
        parseDepth -= 1;
      }
    }

    if (!tokens.length) return state.ans;
    const result = parseExpression(0);
    if (index !== tokens.length) throw new CalcError('Syntax ERROR');
    return result;
  }
  function evaluateExpression(expression) {
    const tokens = tokenize(expression);
    let result = parseTokens(tokens);
    if (Array.isArray(result)) {
      const values = result.map((value) => scalar(value));
      if (values.some((value) => !Number.isFinite(value))) throw new CalcError('Math ERROR');
      for (const value of values) assertCalculatorRange(value);
      return values.map((value) => roundInternal(cleanZero(value)));
    }
    if (isPercent(result)) {
      result = isRational(result.raw)
        ? rationalBinary('/', result.raw, makeRational(100n))
        : roundInternal(scalar(result.raw) / 100);
    }
    const number = scalar(result);
    if (!Number.isFinite(number)) throw new CalcError('Math ERROR');
    assertCalculatorRange(result);
    return isRational(result) ? result : cleanZero(roundInternal(number));
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
    const parts = splitStatements(source);
    if (parts.length > 1 && state.mode !== 'COMP') {
      state.error = 'Syntax ERROR';
      state.resultValue = 0;
      state.justEvaluated = true;
      render();
      speak(state.error);
      return;
    }
    try {
      let value;
      const completedParts = [];
      for (const part of parts) {
        if (!part.trim()) throw new CalcError('Syntax ERROR');
        const completed = autoclose(part.trim());
        value = evaluateExpression(completed);
        completedParts.push(completed);
        state.ans = answerValue(value);
      }
      state.expr = completedParts.join(':');
      state.cursor = state.expr.length;
      state.resultValue = value;
      state.error = '';
      state.justEvaluated = true;
      state.dmsDisplay = hasSexagesimalResultRule(source) ? formatDMS(scalar(value)) : null;
      if (state.dmsDisplay === 'Math ERROR') throw new CalcError('Math ERROR');
      state.fractionView = 0;
      state.engineeringView = false;
      state.engineeringShift = 0;
      if (addHistory && state.mode === 'COMP') pushHistory(state.expr, value);
      persistState();
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
    if (state.dataEdit) state.dataEdit.touched = true;
    const spans = calculatorStepSpans(state.expr);
    if (!spans.length) { state.cursor = 0; render(); return; }
    const boundaries = [0, ...spans.map((span) => span.end)];
    let index = boundaries.findIndex((position) => position === state.cursor);
    if (index < 0) {
      index = boundaries.findIndex((position) => position > state.cursor);
      if (index < 0) index = boundaries.length - 1;
    }
    index = Math.max(0, Math.min(boundaries.length - 1, index + delta));
    state.cursor = boundaries[index];
    render();
  }
  function openAngleConversion() {
    setPrompt('angleConvert', 'DRG▶', '1 DEG  2 RAD  3 GRA');
  }

  function convertDisplayedAngle(number) {
    const target = { '1': 'DEG', '2': 'RAD', '3': 'GRA' }[number];
    if (!target) return;
    const value = scalar(currentValue());
    const radians = angleToRadians(value);
    const converted = target === 'DEG' ? radians * 180 / Math.PI
      : target === 'GRA' ? radians * 200 / Math.PI : radians;
    clearPrompt();
    state.resultValue = cleanZero(converted);
    state.ans = state.resultValue;
    state.expr = '';
    state.cursor = 0;
    state.justEvaluated = true;
    state.error = '';
    state.dmsDisplay = null;
    state.fractionView = 0;
    persistState();
    showMessage(`CONVERTED TO ${target}`, 1000);
  }

  function applyEngineering() {
    if (state.expr.trim() && !state.justEvaluated) {
      calculate({ addHistory: false });
      if (!state.error) {
        state.engineeringView = true;
        state.engineeringShift = 0;
      }
    } else if (state.engineeringView) {
      state.engineeringShift = Math.min(33, state.engineeringShift + 1);
    } else {
      state.engineeringView = true;
      state.engineeringShift = 0;
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
    state.resultValue = roundToDisplayPrecision(scalar(state.resultValue ?? state.ans));
    state.ans = scalar(state.resultValue);
    state.justEvaluated = true;
    state.error = '';
    persistState();
    render();
  }

  function toggleFractionDisplay(shifted = false) {
    if (!shifted && state.expr.trim() && !state.justEvaluated) {
      insertRaw('┘', 'operand');
      return;
    }
    state.dmsDisplay = null;
    state.engineeringView = false;
    if (shifted) {
      const currentlyMixed = state.fractionView === 3 ? true
        : state.fractionView === 2 ? false : state.fractionFormat === 'mixed';
      state.fractionFormat = currentlyMixed ? 'improper' : 'mixed';
      state.fractionView = currentlyMixed ? 2 : 3;
      persistState();
      showMessage(currentlyMixed ? 'IMPROPER FRACTION' : 'MIXED FRACTION', 1000);
      return;
    }
    if (state.fractionView === 1) {
      state.fractionView = 0;
    } else if (state.fractionView === 2 || state.fractionView === 3) {
      state.fractionView = 1;
    } else {
      const value = scalar(state.resultValue ?? state.ans ?? 0);
      const ratio = rationalApproximation(value);
      const defaultFraction = /[÷/┘]/.test(state.expr) && ratio && ratio.d !== 1;
      state.fractionView = defaultFraction ? 1 : (state.fractionFormat === 'mixed' ? 3 : 2);
    }
    render();
  }

  function convertToDms() {
    if (state.expr.trim() && !state.justEvaluated) calculate({ addHistory: false });
    if (!state.error) {
      const formatted = formatDMS(scalar(state.resultValue ?? state.ans));
      if (formatted === 'Math ERROR') {
        state.error = formatted;
        state.dmsDisplay = null;
        speak(state.error);
      } else state.dmsDisplay = formatted;
    }
    render();
  }

  function insertDmsMark() {
    if (state.justEvaluated) {
      if (state.dmsDisplay) state.dmsDisplay = null;
      render();
      return;
    }
    const before = state.expr.slice(0, state.cursor);
    const currentTerm = before.split(/[+−×÷^(),]/).pop();
    const previousMark = (currentTerm.match(/[°′″]/g) || []).slice(-1)[0];
    if (previousMark === '″') return;
    const mark = previousMark === '°' ? '′' : previousMark === '′' ? '″' : '°';
    insertRaw(mark, 'operand');
  }

  function handlePending(key) {
    const pending = state.pending;
    if (!pending) return false;
    if (typeof pending === 'object' && pending.type === 'setup') {
      if (key === 'mode') { showModeSetupPage((pending.page + 1) % 6); return true; }
      if (/^[0-9]$/.test(key)) { selectModeSetup(pending.page, key); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      state.modeSetupPage = 0;
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'precision') {
      if (key === 'equals') { commitPrecision(); return true; }
      if (/^[0-9]$/.test(key)) {
        pending.buffer += key;
        state.prompt.result = pending.format === 'Fix' ? `${pending.buffer} DECIMALS` : `${pending.buffer} DIGITS; = TO SET`;
        render();
        if (pending.format === 'Fix' || pending.buffer.length >= 2) commitPrecision();
        return true;
      }
      if (key === 'shift' || key === 'alpha') return false;
      if (pending.buffer) commitPrecision();
      else cancelPrompt();
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'norm') {
      if (key === '1' || key === '2') {
        state.normSetting = Number(key);
        commitSetupMessage(`NORM ${key}`);
        return true;
      }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'contrast') {
      if (key === 'equals') { clearPrompt(); persistState(); render(); return true; }
      if (/^[0-9]$/.test(key)) {
        state.contrast = Number(key);
        render();
        return true;
      }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'dataFull') {
      if (pending.stage === 'warning' && key === 'ac') {
        pending.stage = 'choice';
        state.prompt = { expression: 'DATA FULL', result: '1 CANCEL  2 REGISTER' };
        render();
        return true;
      }
      if (pending.stage === 'choice' && key === '1') {
        clearPrompt();
        state.expr = '';
        state.cursor = 0;
        state.dataEdit = null;
        state.error = '';
        showMessage('NOT REGISTERED', 1000);
        return true;
      }
      if (pending.stage === 'choice' && key === '2') {
        const datum = pending.datum;
        clearPrompt();
        state.statsRetained = false;
        try { registerStatDatum(datum); }
        catch (error) { state.error = error.message || 'Math ERROR'; render(); }
        return true;
      }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      state.expr = '';
      state.cursor = 0;
      state.dataEdit = null;
      render();
      return false;
    }
    if (typeof pending === 'object' && pending.type === 'editOff') {
      if (key === '1') {
        state.dataEdit = null;
        clearPrompt();
        state.expr = '';
        state.cursor = 0;
        state.justEvaluated = false;
        render();
        return true;
      }
      if (key === '2') { cancelPrompt(); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'angleConvert') {
      if (['1', '2', '3'].includes(key)) { convertDisplayedAngle(key); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'mode') {
      if (['1', '2', '3'].includes(key)) { selectMode(key); return true; }
      if (key === 'mode') { cancelPrompt(); return true; }
      if (key === 'shift' || key === 'alpha') return false;
      cancelPrompt();
      return false;
    }
    if (pending === 'regtype') {
      if (key === 'mode') {
        state.regTypePage = state.regTypePage ? 0 : 1;
        state.prompt = state.regTypePage
          ? { expression: 'REG 2/2', result: '4 Pwr  5 Inv  6 Quad' }
          : { expression: 'REG 1/2', result: '1 Lin  2 Log  3 Exp' };
        render();
        return true;
      }
      if (state.shift && ['1', '2', '3'].includes(key)) {
        selectRegression({ '1': '4', '2': '5', '3': '6' }[key]);
        return true;
      }
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
    if (pending === 'statSum' || pending === 'statVar' || pending === 'statSumMore' || pending === 'statVarMore') {
      if (/^[0-9]$/.test(key)) {
        const which = pending === 'statSum' ? 'sum'
          : pending === 'statVar' ? 'var'
            : pending === 'statSumMore' ? 'sumMore' : 'varMore';
        selectStatistic(which, key);
        return true;
      }
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
    insertRaw(letter, 'operand');
  }

  function scheduleAutoPowerOff() {
    window.clearTimeout(scheduleAutoPowerOff.timer);
    if (!state.on) return;
    scheduleAutoPowerOff.timer = window.setTimeout(() => {
      state.on = false;
      state.shift = false;
      state.alpha = false;
      state.hyp = false;
      persistState();
      render();
    }, 10 * 60 * 1000);
  }

  function beginStatisticEdit(key) {
    if (!state.dataEdit || state.dataEdit.dirty || state.dataEdit.touched) return;
    const editable = /^[0-9]$/.test(key) || [
      'decimal', 'negative', 'comma', 'open', 'close', 'multiply', 'divide', 'plus', 'minus', 'exp',
      'inverse', 'ncr', 'polar', 'cube', 'fraction', 'sqrt', 'square', 'power', 'log', 'ln', 'dms',
      'hyp', 'sin', 'cos', 'tan', 'ans'
    ].includes(key);
    if (!editable) return;
    state.expr = '';
    state.cursor = 0;
    state.justEvaluated = false;
    state.dataEdit.dirty = true;
  }
  function executeShift(key) {
    switch (key) {
      case 'inverse': startPostfix('!'); break;
      case 'ncr': appendOperator(' nPr '); break;
      case 'polar': insertFunction('Rec'); break;
      case 'cube': insertFunction('cbrt'); break;
      case 'dms': convertToDms(); break;
      case 'fraction': toggleFractionDisplay(true); break;
      case 'power': appendOperator(' root '); break;
      case 'log': insertRaw('10^(', 'operand'); break;
      case 'ln': insertRaw('e^(', 'operand'); break;
      case 'sin': insertFunction(state.hyp ? 'asinh' : 'asin'); state.hyp = false; break;
      case 'cos': insertFunction(state.hyp ? 'acosh' : 'acos'); state.hyp = false; break;
      case 'tan': insertFunction(state.hyp ? 'atanh' : 'atan'); state.hyp = false; break;
      case 'rcl': openMemory('store'); break;
      case 'eng':
        if (state.justEvaluated || !state.expr.trim()) {
          state.engineeringView = true;
          state.engineeringShift = Math.max(-33, state.engineeringShift - 1);
          render();
        } else moveCursor(-1);
        break;
      case 'mplus':
        if (state.mode === 'COMP') addMemory(true);
        else deleteLastStat();
        break;
      case 'comma': insertRaw(';', 'operand'); break;
      case 'del': state.insertMode = !state.insertMode; showMessage(state.insertMode ? 'INSERT ON' : 'INSERT OFF', 900); break;
      case 'ac':
        state.on = false;
        state.shift = false;
        state.alpha = false;
        render();
        break;
      case 'mode': openClearMenu(); break;
      case '1': openStatisticsMenu('sum'); break;
      case '2': openStatisticsMenu('var'); break;
      case '3': insertRaw('π', 'operand'); break;
      case '0': applyRnd(); break;
      case 'decimal': insertRaw(String(Math.floor(Math.random() * 1000) / 1000), 'operand'); break;
      case 'ans': openAngleConversion(); break;
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
      case 'fraction': toggleFractionDisplay(false); break;
      case 'sqrt': insertFunction('sqrt'); break;
      case 'square': startPostfix('^2'); break;
      case 'power': appendOperator('^'); break;
      case 'log': insertFunction('log'); break;
      case 'ln': insertFunction('ln'); break;
      case 'negative': toggleSign(); break;
      case 'dms': insertDmsMark(); break;
      case 'hyp': state.hyp = !state.hyp; showMessage(state.hyp ? 'HYP' : 'HYP OFF', 900); break;
      case 'sin': insertFunction(state.hyp ? 'sinh' : 'sin'); state.hyp = false; break;
      case 'cos': insertFunction(state.hyp ? 'cosh' : 'cos'); state.hyp = false; break;
      case 'tan': insertFunction(state.hyp ? 'tanh' : 'tan'); state.hyp = false; break;
      case 'rcl': openMemory('recall'); break;
      case 'eng': applyEngineering(); break;
      case 'open': insertRaw('(', 'operand'); break;
      case 'close': insertRaw(')', 'operand'); break;
      case 'comma': insertRaw(',', 'operand'); break;
      case 'mplus': state.mode === 'COMP' ? addMemory(false) : addStatDatum(); break;
      case 'del': deleteBeforeCursor(); break;
      case 'ac': clearAll(); break;
      case 'multiply': appendOperator('×'); break;
      case 'divide': appendOperator('÷'); break;
      case 'plus': appendOperator('+'); break;
      case 'minus': appendOperator('−'); break;
      case 'decimal': insertDecimal(); break;
      case 'exp': insertRaw('×10^', 'operator'); break;
      case 'ans': insertRaw('Ans', 'operand'); break;
      case 'equals':
        if (state.mode === 'COMP') calculate();
        else if (state.dataEdit) commitEditedStat();
        else if (state.expr.trim()) calculate({ addHistory: false });
        else render();
        break;
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
      state.hyp = false;
      if (state.prompt) clearPrompt();
      render();
      scheduleAutoPowerOff();
      return;
    }
    if (!state.on) return;
    scheduleAutoPowerOff();

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
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'contrast' && (key === 'left' || key === 'right')) {
      state.contrast = Math.max(0, Math.min(10, state.contrast + (key === 'left' ? -1 : 1)));
      render();
      persistState();
      return;
    }
    if (state.pending && (key === 'up' || key === 'down' || key === 'left' || key === 'right')) return;
    if (key === 'up' || key === 'down') {
      if (state.mode === 'COMP') recallHistory(key === 'up' ? -1 : 1);
      else browseData(key === 'up' ? -1 : 1);
      return;
    }
    if (key === 'left') { moveCursor(-1); return; }
    if (key === 'right') { moveCursor(1); return; }

    if (state.pending && handlePending(key)) {
      state.shift = false;
      state.alpha = false;
      return;
    }

    if (state.alpha && key === 'polar') {
      state.alpha = false;
      state.shift = false;
      if (state.mode === 'COMP') insertRaw(':', 'operator');
      else showMessage('SYNTAX ERROR', 1000);
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

    if (!state.shift && !state.alpha) beginStatisticEdit(key);
    const shifted = state.shift;
    state.shift = false;
    state.alpha = false;
    if (state.pending && typeof state.pending === 'object' && state.pending.type === 'memory' && !alphaKey[key]) cancelPrompt();
    if (shifted) executeShift(key);
    else executeMain(key);
    render();
    scheduleAutoPowerOff();
  }
  function vibrateOnTap() {
    try {
      if (window.AndroidHaptics && typeof window.AndroidHaptics.tap === 'function') {
        window.AndroidHaptics.tap();
      } else if (navigator.vibrate) {
        navigator.vibrate(8);
      }
    } catch (_) { /* Haptics are optional on devices without a vibrator. */ }
  }

  document.querySelectorAll('[data-key]').forEach((button) => {
    button.addEventListener('click', () => {
      vibrateOnTap();
      handleKey(button.dataset.key);
    });
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
      vibrateOnTap();
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

  restoreState();
  render();
  scheduleAutoPowerOff();
})();
