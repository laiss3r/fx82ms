package com.arena.fx82ms

import java.io.StringReader
import java.io.StringWriter
import java.math.BigDecimal
import java.math.BigInteger
import java.math.MathContext
import java.math.RoundingMode
import java.util.Locale
import java.util.Properties
import kotlin.math.abs
import kotlin.math.acos
import kotlin.math.asin
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.ceil
import kotlin.math.cos
import kotlin.math.cosh
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sinh
import kotlin.math.sqrt
import kotlin.math.tan
import kotlin.math.tanh

/** Pure Kotlin state machine and calculation engine for the native Android calculator. */
data class CalculatorDisplay(
    val mode: String,
    val angle: String,
    val flags: String,
    val history: String,
    val steps: String,
    val memory: String,
    val expression: String,
    val result: String,
    val poweredOn: Boolean,
    val shift: Boolean,
    val alpha: Boolean
)

private class CalcError(val display: String) : RuntimeException(display)

private class Rational private constructor(val numerator: BigInteger, val denominator: BigInteger) {
    fun plus(other: Rational) = of(numerator * other.denominator + other.numerator * denominator, denominator * other.denominator)
    fun minus(other: Rational) = of(numerator * other.denominator - other.numerator * denominator, denominator * other.denominator)
    fun times(other: Rational) = of(numerator * other.numerator, denominator * other.denominator)
    fun over(other: Rational): Rational {
        if (other.numerator == BigInteger.ZERO) throw CalcError("Math ERROR")
        return of(numerator * other.denominator, denominator * other.numerator)
    }
    fun negated() = of(numerator.negate(), denominator)
    fun absolute() = of(numerator.abs(), denominator)
    fun asDouble(): Double = numerator.toDouble() / denominator.toDouble()
    fun pow(exponent: Int): Rational {
        if (abs(exponent) > 100) throw CalcError("Math ERROR")
        if (exponent == 0) return ONE
        return if (exponent > 0) of(numerator.pow(exponent), denominator.pow(exponent))
        else of(denominator.pow(-exponent), numerator.pow(-exponent))
    }

    companion object {
        val ZERO = of(BigInteger.ZERO, BigInteger.ONE)
        val ONE = of(BigInteger.ONE, BigInteger.ONE)
        fun of(n: BigInteger, d: BigInteger): Rational {
            if (d == BigInteger.ZERO) throw CalcError("Math ERROR")
            if (n == BigInteger.ZERO) return Rational(BigInteger.ZERO, BigInteger.ONE)
            val sign = if (d.signum() < 0) BigInteger.valueOf(-1) else BigInteger.ONE
            val nn = n * sign
            val dd = d.abs()
            val gcd = nn.abs().gcd(dd)
            val result = Rational(nn / gcd, dd / gcd)
            if (result.numerator.abs().toString().length > 400 || result.denominator.toString().length > 400) {
                return fromDouble(result.asDouble())
            }
            return result
        }
        fun fromDecimal(text: String): Rational {
            val match = Regex("^([+-]?)(?:(\\d+)(?:\\.(\\d*))?|\\.(\\d+))(?:[eE]([+-]?\\d+))?$").matchEntire(text)
                ?: throw CalcError("Syntax ERROR")
            val sign = if (match.groupValues[1] == "-") BigInteger.valueOf(-1) else BigInteger.ONE
            val whole = match.groupValues[2].ifEmpty { "0" }
            val fraction = match.groupValues[3].ifEmpty { match.groupValues[4] }
            val exponent = match.groupValues[5].ifEmpty { "0" }.toIntOrNull() ?: throw CalcError("Math ERROR")
            if (abs(exponent) > 400) throw CalcError("Math ERROR")
            var n = BigInteger((whole + fraction).ifEmpty { "0" }) * sign
            val scale = fraction.length - exponent
            if (scale >= 0) return of(n, BigInteger.TEN.pow(scale))
            n *= BigInteger.TEN.pow(-scale)
            return of(n, BigInteger.ONE)
        }
        fun fromDouble(value: Double): Rational {
            if (!value.isFinite()) throw CalcError("Math ERROR")
            val text = BigDecimal.valueOf(value).round(MathContext(14, RoundingMode.HALF_UP)).stripTrailingZeros().toPlainString()
            return fromDecimal(text)
        }
    }
}

private data class CalcNum(val value: Double, val exact: Rational? = null) {
    companion object {
        fun of(value: Double): CalcNum {
            if (!value.isFinite()) throw CalcError("Math ERROR")
            return CalcNum(roundInternal(value), null)
        }
        fun exact(value: Rational) = CalcNum(value.asDouble(), value)
        fun decimal(text: String) = exact(Rational.fromDecimal(text))
    }
}

private data class CalcValue(
    val first: CalcNum,
    val second: CalcNum? = null,
    /** Percent literals retain their context for addition/subtraction (e.g. 2500 + 15%). */
    val isPercent: Boolean = false
)

private data class StatPoint(val x: Double, val y: Double = 0.0, val frequency: Int = 1)
private data class RegressionFit(val a: Double, val b: Double, val c: Double = 0.0, val r: Double = 0.0)
private data class Prompt(val kind: String, val expression: String, val result: String)
private enum class ParserTokenType { NUMBER, IDENT, OP, LPAREN, RPAREN, COMMA, POSTFIX }
private data class ParserToken(val type: ParserTokenType, val text: String, val number: CalcNum? = null)

private fun roundInternal(value: Double): Double {
    if (!value.isFinite() || value == 0.0) return if (value == 0.0) 0.0 else value
    return try { BigDecimal.valueOf(value).round(MathContext(15, RoundingMode.HALF_UP)).toDouble() } catch (_: Exception) { value }
}

/** Pure Kotlin keyboard/display state machine and calculation behavior. */
class CalculatorEngine {
    private var expression = ""
    private var cursor = 0
    private var mode = "COMP"
    private var angle = "DEG"
    private var regType = "Lin"
    private var modePage = 0
    private var displayFormat = "Norm"
    private var displayDigits = 10
    private var normSetting = 1
    private var fractionFormat = "mixed"
    private var decimalSymbol = "."
    private var fractionView = 0
    private var engineering = false
    private var engineeringShift = 0
    private var dmsDisplay: String? = null
    private var answer = CalcNum.exact(Rational.ZERO)
    private var memoryValue = CalcNum.exact(Rational.ZERO)
    private val variables = linkedMapOf<String, CalcNum>().apply {
        listOf("A", "B", "C", "D", "E", "F", "X", "Y", "M").forEach { put(it, CalcNum.exact(Rational.ZERO)) }
    }
    private var lastValue = CalcValue(CalcNum.exact(Rational.ZERO))
    private var error = ""
    private var message = ""
    private var prompt: Prompt? = null
    private var pending: String? = null
    private var pendingBuffer = ""
    private var pendingDatum: StatPoint? = null
    private var shiftArmed = false
    private var alphaArmed = false
    private var hyp = false
    private var insertMode = false
    private var poweredOn = true
    private var justEvaluated = false
    private val history = mutableListOf<Pair<String, CalcValue>>()
    private var replayIndex = -1
    private val stats = mutableListOf<StatPoint>()
    private var statsRetained = true
    private var editingIndex: Int? = null
    private var editDirty = false
    private var lastStat: StatPoint? = null
    private var lastFit: RegressionFit? = null

    private val alphaKeys = mapOf(
        "negative" to "A", "dms" to "B", "hyp" to "C", "sin" to "D", "cos" to "E",
        "tan" to "F", "open" to "X", "close" to "Y", "mplus" to "M"
    )

    fun display(): CalculatorDisplay {
        val displayedExpression = prompt?.expression ?: expressionWithCursor()
        val displayedResult = when {
            !poweredOn -> ""
            prompt != null -> prompt!!.result
            error.isNotEmpty() -> error
            message.isNotEmpty() -> message
            dmsDisplay != null -> dmsDisplay!!
            else -> formatValue(lastValue)
        }
        val flags = buildList {
            if (shiftArmed) add("SHIFT")
            if (alphaArmed) add("ALPHA")
            if (hyp) add("HYP")
            if (displayFormat != "Norm") add("${displayFormat.uppercase(Locale.US)} $displayDigits")
            if (mode == "REG") add(regType.uppercase(Locale.US))
            if (!statsRetained && mode != "COMP") add("DATA NOT STORED")
            if (message.isNotEmpty() && prompt == null && error.isEmpty()) add(message)
        }.joinToString(" ")
        val historyFlag = if (history.isEmpty() || replayIndex < 0) "" else buildString {
            if (replayIndex > 0) append("↑")
            if (replayIndex < history.lastIndex) append("↓")
        }
        return CalculatorDisplay(
            mode = mode, angle = angle, flags = flags, history = historyFlag,
            steps = if (expression.isEmpty() || prompt != null) "" else "${stepCount(expression)}/79",
            memory = if (memoryValue.value != 0.0) "M" else "",
            expression = displayedExpression, result = displayedResult, poweredOn = poweredOn,
            shift = shiftArmed, alpha = alphaArmed
        )
    }

    fun press(key: String) {
        if (key == "on") {
            poweredOn = true
            shiftArmed = false; alphaArmed = false; hyp = false
            prompt = null; pending = null; error = ""; message = ""
            return
        }
        if (!poweredOn) return
        message = ""
        if (key == "shift") { shiftArmed = !shiftArmed; alphaArmed = false; return }
        if (key == "alpha") { alphaArmed = !alphaArmed; shiftArmed = false; return }

        if (pending != null && handlePending(key)) return
        if (key == "up" || key == "down") {
            if (pending != null) return
            if (mode == "COMP") browseHistory(if (key == "up") -1 else 1) else browseStats(if (key == "up") -1 else 1)
            return
        }
        if (key == "left" || key == "right") {
            if (pending == "contrast") return
            moveCursor(if (key == "left") -1 else 1)
            return
        }

        if (alphaArmed && key == "polar") {
            alphaArmed = false; shiftArmed = false
            if (mode == "COMP") insertRaw(":", false) else showMessage("SYNTAX ERROR")
            return
        }
        if (alphaArmed && alphaKeys.containsKey(key)) {
            val letter = alphaKeys.getValue(key)
            alphaArmed = false; shiftArmed = false
            setVariable(letter)
            return
        }

        val shifted = shiftArmed
        shiftArmed = false; alphaArmed = false
        if (shifted) executeShift(key) else executeMain(key)
    }

    fun clearTransientMessage() { message = "" }
    fun powerOff() { poweredOn = false; shiftArmed = false; alphaArmed = false; hyp = false }

    private fun executeMain(key: String) {
        if (key.length == 1 && key[0].isDigit()) { insertRaw(key, true); return }
        when (key) {
            "inverse" -> postfix("^(−1)")
            "ncr" -> operator(" nCr ")
            "polar" -> function("Pol")
            "cube" -> postfix("^3")
            "fraction" -> if (justEvaluated) toggleFraction(false) else insertRaw("/", true)
            "sqrt" -> function("sqrt")
            "square" -> postfix("^2")
            "power" -> operator("^")
            "log" -> function("log")
            "ln" -> function("ln")
            "negative" -> toggleSign()
            "dms" -> insertDmsMark()
            "hyp" -> { hyp = !hyp; showMessage(if (hyp) "HYP" else "HYP OFF") }
            "sin" -> { function(if (hyp) "sinh" else "sin"); hyp = false }
            "cos" -> { function(if (hyp) "cosh" else "cos"); hyp = false }
            "tan" -> { function(if (hyp) "tanh" else "tan"); hyp = false }
            "rcl" -> openMemory(false)
            "eng" -> applyEngineering()
            "open" -> insertRaw("(", true)
            "close" -> insertRaw(")", true)
            "comma" -> insertRaw(",", true)
            "mplus" -> if (mode == "COMP") addMemory(false) else addStatDatum()
            "del" -> deleteBeforeCursor()
            "ac" -> clearEntry()
            "multiply" -> operator("×")
            "divide" -> operator("÷")
            "plus" -> operator("+")
            "minus" -> operator("−")
            "decimal" -> insertDecimal()
            "exp" -> insertRaw("×10^", true)
            "ans" -> insertRaw("Ans", true)
            "equals" -> when {
                editingIndex != null -> commitEditedStat()
                expression.isNotBlank() -> calculate()
            }
            "mode" -> openMode()
        }
    }

    private fun executeShift(key: String) {
        when (key) {
            "inverse" -> postfix("!")
            "ncr" -> operator(" nPr ")
            "polar" -> function("Rec")
            "cube" -> function("cbrt")
            "dms" -> toggleDms()
            "fraction" -> toggleFraction(true)
            "power" -> operator(" root ")
            "log" -> insertRaw("10^(", true)
            "ln" -> insertRaw("e^(", true)
            "sin" -> { function(if (hyp) "asinh" else "asin"); hyp = false }
            "cos" -> { function(if (hyp) "acosh" else "acos"); hyp = false }
            "tan" -> { function(if (hyp) "atanh" else "atan"); hyp = false }
            "rcl" -> openMemory(true)
            "eng" -> if (justEvaluated || expression.isBlank()) { engineering = true; engineeringShift = (engineeringShift - 1).coerceAtLeast(-33) } else moveCursor(-1)
            "mplus" -> if (mode == "COMP") addMemory(true) else deleteStat()
            "comma" -> insertRaw(";", true)
            "del" -> { insertMode = !insertMode; showMessage(if (insertMode) "INSERT ON" else "INSERT OFF") }
            "ac" -> { poweredOn = false; shiftArmed = false; alphaArmed = false }
            "mode" -> openClearMenu()
            "1" -> openStatistics(false)
            "2" -> openStatistics(true)
            "3" -> insertRaw("π", true)
            "0" -> applyRnd()
            "decimal" -> insertRaw((kotlin.random.Random.nextInt(1000) / 1000.0).toString(), true)
            "ans" -> openAngleConversion()
            "equals" -> postfix("%")
        }
    }

    private fun handlePending(key: String): Boolean {
        when (pending) {
            "setup" -> {
                if (key == "mode") { showSetup((modePage + 1) % 5); return true }
                if (key.length == 1 && key[0].isDigit()) { selectSetup(modePage, key); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "precision" -> {
                if (key.length == 1 && key[0].isDigit()) {
                    pendingBuffer += key
                    prompt = Prompt("precision", (if (displayFormat == "Fix") "FIX " else "SCI ") + pendingBuffer, "PRESS = TO SET")
                    return true
                }
                if (key == "equals" && pendingBuffer.isNotEmpty()) { commitPrecision(); return true }
                if (pendingBuffer.isNotEmpty()) {
                    commitPrecision()
                    return false
                }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "norm" -> {
                if (key == "1" || key == "2") { normSetting = key.toInt(); displayFormat = "Norm"; displayDigits = 10; commitSetup("NORM $key"); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "regtype" -> {
                if (key == "mode") {
                    modePage = if (modePage == 5) 6 else 5
                    prompt = if (modePage == 6) Prompt("regtype", "REG 2/2", "4 Pwr  5 Inv  6 Quad") else Prompt("regtype", "REG 1/2", "1 Lin  2 Log  3 Exp")
                    return true
                }
                if (key in listOf("1", "2", "3", "4", "5", "6")) {
                    val n = if (shiftArmed && key in listOf("1", "2", "3")) key.toInt() + 3 else key.toInt()
                    selectRegression(n); return true
                }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "clear" -> {
                if (key in listOf("1", "2", "3")) { performClear(key.toInt()); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "statsSum", "statsVar", "statsSumMore", "statsVarMore" -> {
                if (key.length == 1 && (key[0].isDigit())) { selectStatistic(pending!!, key); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "memoryStore", "memoryRecall" -> {
                val letter = alphaKeys[key]
                if (letter != null) { completeMemory(letter, pending == "memoryStore"); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "angleConvert" -> {
                if (key in listOf("1", "2", "3")) { convertAngle(key.toInt()); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "dataFullWarning" -> {
                if (key == "ac") { pending = "dataFullChoice"; prompt = Prompt("dataFull", "DATA FULL", "1 CANCEL  2 REGISTER"); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            "dataFullChoice" -> {
                if (key == "1") { cancelPrompt(); expression = ""; cursor = 0; showMessage("NOT REGISTERED"); return true }
                if (key == "2") { statsRetained = false; val row = pendingDatum; cancelPrompt(); if (row != null) registerStat(row); return true }
                if (key != "shift" && key != "alpha") cancelPrompt()
                return false
            }
            else -> return false
        }
    }

    private fun openMode() {
        if (pending == "setup") showSetup((modePage + 1) % 5) else showSetup(0)
    }

    private fun showSetup(page: Int) {
        modePage = page
        pending = "setup"
        prompt = when (page) {
            0 -> Prompt("setup", "MODE", "1 COMP  2 SD  3 REG")
            1 -> Prompt("setup", "ANGLE", "1 DEG  2 RAD  3 GRA")
            2 -> Prompt("setup", "FORMAT", "1 FIX  2 SCI  3 NORM")
            3 -> Prompt("setup", "FRACTION", "1 MIXED  2 IMPROPER")
            else -> Prompt("setup", "DISP", "1 DOT  2 COMMA")
        }
        error = ""
    }

    private fun selectSetup(page: Int, key: String) {
        when (page) {
            0 -> selectMode(key.toInt())
            1 -> {
                angle = when (key) { "1" -> "DEG"; "2" -> "RAD"; "3" -> "GRA"; else -> return }
                dmsDisplay = null; commitSetup(angle)
            }
            2 -> when (key) {
                "1" -> startPrecision("Fix")
                "2" -> startPrecision("Sci")
                "3" -> { displayFormat = "Norm"; pending = "norm"; prompt = Prompt("norm", "NORM", "1 NORM 1  2 NORM 2") }
            }
            3 -> {
                if (key !in listOf("1", "2")) return
                fractionFormat = if (key == "1") "mixed" else "improper"
                fractionView = 0; commitSetup(if (key == "1") "MIXED FRACTION" else "IMPROPER FRACTION")
            }
            4 -> {
                if (key !in listOf("1", "2")) return
                decimalSymbol = if (key == "1") "." else ","
                commitSetup(if (key == "1") "DOT" else "COMMA")
            }
        }
    }

    private fun startPrecision(format: String) {
        displayFormat = format
        pending = "precision"; pendingBuffer = ""
        prompt = Prompt("precision", format.uppercase(Locale.US), if (format == "Fix") "0-9 DECIMALS" else "1-10 SIG DIGITS")
    }

    private fun commitPrecision() {
        val digits = pendingBuffer.toIntOrNull()
        val maxDigits = if (displayFormat == "Fix") 9 else 10
        if (digits == null || digits !in 0..maxDigits || (displayFormat == "Sci" && digits == 0 && pendingBuffer.length > 1)) {
            cancelPrompt(); error = "Math ERROR"; return
        }
        displayDigits = if (displayFormat == "Sci" && digits == 0) 10 else digits
        commitSetup("${displayFormat.uppercase(Locale.US)} $displayDigits")
    }

    private fun commitSetup(text: String) { pending = null; prompt = null; message = text; modePage = 0 }
    private fun cancelPrompt() { pending = null; prompt = null; pendingBuffer = "" }

    private fun selectMode(which: Int) {
        if (which !in 1..3) return
        mode = when (which) { 1 -> "COMP"; 2 -> "SD"; else -> "REG" }
        regType = "Lin"; stats.clear(); statsRetained = true; editingIndex = null; lastStat = null; lastFit = null
        history.clear(); replayIndex = -1
        cancelPrompt(); clearEntry()
        if (mode == "REG") {
            pending = "regtype"; modePage = 5
            prompt = Prompt("regtype", "REG 1/2", "1 Lin  2 Log  3 Exp")
        } else if (mode == "SD") showMessage("SD MODE")
    }

    private fun selectRegression(which: Int) {
        regType = when (which) { 1 -> "Lin"; 2 -> "Log"; 3 -> "Exp"; 4 -> "Pwr"; 5 -> "Inv"; 6 -> "Quad"; else -> return }
        stats.clear(); statsRetained = true; editingIndex = null; lastFit = null; lastStat = null
        variables.keys.filter { it != "M" }.forEach { variables[it] = CalcNum.exact(Rational.ZERO) }
        cancelPrompt(); clearEntry(); showMessage("$regType REG")
    }

    private fun openClearMenu() {
        pending = "clear"; prompt = Prompt("clear", "CLR", "1 Mcl  2 Mode  3 All")
    }

    private fun performClear(choice: Int) {
        cancelPrompt()
        when (choice) {
            1 -> if (mode == "COMP") { memoryValue = CalcNum.exact(Rational.ZERO); variables["M"] = memoryValue } else { stats.clear(); statsRetained = true; editingIndex = null; lastFit = null }
            2 -> selectMode(1)
            3 -> { memoryValue = CalcNum.exact(Rational.ZERO); variables.keys.forEach { variables[it] = CalcNum.exact(Rational.ZERO) }; answer = CalcNum.exact(Rational.ZERO); stats.clear(); statsRetained = true; clearEntry() }
        }
    }

    private fun openMemory(store: Boolean) {
        pending = if (store) "memoryStore" else "memoryRecall"
        prompt = Prompt("memory", if (store) "STO" else "RCL", "A  B  C  D  E  F  X  Y  M")
    }

    private fun completeMemory(letter: String, store: Boolean) {
        val value = currentValue().first
        if (store) {
            variables[letter] = value
            if (letter == "M") memoryValue = value
            message = "$letter STORED"
        } else {
            val recalled = if (letter == "M") memoryValue else variables[letter] ?: CalcNum.exact(Rational.ZERO)
            answer = recalled; lastValue = CalcValue(recalled); error = ""; message = "$letter RECALLED"
            if (expression.isBlank()) expression = letter else insertRaw(letter, true)
        }
        cancelPrompt()
    }

    private fun setVariable(letter: String) {
        if (pending == "memoryStore" || pending == "memoryRecall") { completeMemory(letter, pending == "memoryStore"); return }
        if (letter == "M") insertRaw("M", true) else insertRaw(letter, true)
    }

    private fun currentValue(): CalcValue {
        if (expression.isBlank()) return lastValue
        return evaluate(expression)
    }

    private fun addMemory(subtract: Boolean) {
        try {
            val value = currentValue().first.value
            val next = memoryValue.value + if (subtract) -value else value
            validateRange(next)
            memoryValue = CalcNum.of(next); variables["M"] = memoryValue
            answer = currentValue().first; lastValue = CalcValue(answer); justEvaluated = true
            showMessage(if (subtract) "M−" else "M+")
        } catch (e: CalcError) { error = e.display }
    }

    private fun insertRaw(text: String, operand: Boolean) {
        if (editingIndex != null && !editDirty && operand) { expression = ""; cursor = 0; editDirty = true }
        if (justEvaluated && operand && text !in listOf("Ans", "π")) { expression = ""; cursor = 0; justEvaluated = false }
        if (justEvaluated && operand && text == "Ans") { expression = ""; cursor = 0; justEvaluated = false }
        if (justEvaluated && !operand) justEvaluated = false
        if (expression.isEmpty() && text in listOf("+", "×", "÷", "^")) {
            expression = "Ans"; cursor = expression.length
        }
        val next = expression.substring(0, cursor) + text + expression.substring(cursor)
        if (stepCount(next) > 79) { message = "79 STEP LIMIT"; return }
        expression = next
        cursor += text.length
        error = ""; message = ""; dmsDisplay = null; engineering = false; engineeringShift = 0; replayIndex = -1
        if (editingIndex != null) editDirty = true
    }

    private fun operator(text: String) {
        if (justEvaluated) { expression = "Ans"; cursor = expression.length; justEvaluated = false }
        if (expression.isEmpty() && text != "−") { expression = "Ans"; cursor = expression.length }
        val before = expression.substring(0, cursor)
        val trailing = Regex("(?:nCr|nPr|root|[+−×÷^])\\s*$", RegexOption.IGNORE_CASE).find(before)
        if (trailing != null) {
            val start = trailing.range.first
            expression = expression.substring(0, start) + text + expression.substring(cursor)
            cursor = start + text.length
        } else insertRaw(text, false)
        error = ""; message = ""
    }

    private fun function(name: String) {
        if (justEvaluated) { expression = "$name(Ans)"; cursor = expression.length; justEvaluated = false; error = ""; return }
        insertRaw("$name(", true)
    }

    private fun postfix(suffix: String) {
        if (justEvaluated) { expression = "Ans"; cursor = expression.length; justEvaluated = false; error = "" }
        if (expression.isEmpty() || expression.substring(0, cursor).lastOrNull() in listOf('+', '−', '×', '÷', '^', ',', '(')) {
            insertRaw("Ans$suffix", true)
        } else insertRaw(suffix, true)
    }

    private fun toggleSign() {
        if (justEvaluated) {
            expression = "−Ans"; cursor = expression.length; justEvaluated = false; error = ""; dmsDisplay = null
            return
        }
        val before = expression.substring(0, cursor)
        val numberMatch = Regex("(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+\\-]?\\d+)?$").find(before)
        if (numberMatch != null) {
            val start = numberMatch.range.first
            val prefix = before.substring(0, start)
            if (prefix.endsWith("−") && (prefix.length == 1 || prefix.lastOrNull() in listOf('+', '−', '×', '÷', '^', '(', ','))) {
                expression = expression.removeRange(start - 1, start)
                cursor--
            } else {
                expression = expression.substring(0, start) + "−" + expression.substring(start)
                cursor++
            }
        } else insertRaw("−", false)
        dmsDisplay = null
    }

    private fun insertDecimal() {
        if (justEvaluated) { expression = ""; cursor = 0; justEvaluated = false; insertRaw("0.", true); return }
        val before = expression.substring(0, cursor)
        val segment = Regex("(?:\\d+(?:\\.\\d*)?|\\.\\d+)$").find(before)?.value
        if (segment?.contains('.') == true) return
        if (before.isEmpty() || before.lastOrNull() in listOf('+', '−', '×', '÷', '^', '(', ',')) insertRaw("0.", true)
        else insertRaw(".", true)
    }

    private fun insertDmsMark() {
        if (justEvaluated && dmsDisplay != null) { dmsDisplay = null; return }
        if (justEvaluated) { justEvaluated = false; expression = "Ans"; cursor = expression.length }
        val before = expression.substring(0, cursor)
        val suffix = when {
            before.endsWith("″") -> return
            before.contains("′") && !before.contains("″") -> "″"
            before.contains("°") && !before.contains("′") -> "′"
            else -> "°"
        }
        insertRaw(suffix, true)
    }

    private fun deleteBeforeCursor() {
        if (cursor <= 0 || expression.isEmpty()) return
        val start = cursor - 1
        expression = expression.removeRange(start, cursor); cursor = start
        justEvaluated = false; error = ""; dmsDisplay = null
        if (editingIndex != null) editDirty = true
    }

    private fun clearEntry() {
        expression = ""; cursor = 0; justEvaluated = false; error = ""; message = ""
        prompt = null; pending = null; pendingBuffer = ""; shiftArmed = false; alphaArmed = false; hyp = false
        fractionView = 0; dmsDisplay = null; engineering = false; engineeringShift = 0
        editingIndex = null; editDirty = false; replayIndex = -1
        lastValue = CalcValue(CalcNum.exact(Rational.ZERO))
    }

    private fun toggleFraction(shifted: Boolean) {
        if (!justEvaluated) return
        fractionView = when {
            shifted -> if (fractionView == 3) 2 else 3
            fractionView == 1 -> 0
            else -> 1
        }
    }

    private fun toggleDms() {
        if (!justEvaluated) return
        dmsDisplay = if (dmsDisplay == null) formatDms(lastValue.first.value) else null
    }

    private fun convertAngle(choice: Int) {
        val value = lastValue.first.value
        val radians = when (angle) { "DEG" -> value * Math.PI / 180.0; "GRA" -> value * Math.PI / 200.0; else -> value }
        val converted = when (choice) { 1 -> radians * 180.0 / Math.PI; 2 -> radians; 3 -> radians * 200.0 / Math.PI; else -> value }
        answer = CalcNum.of(converted); lastValue = CalcValue(answer); expression = ""; cursor = 0; justEvaluated = true
        cancelPrompt(); message = when (choice) { 1 -> "DEG"; 2 -> "RAD"; else -> "GRA" }
    }

    private fun applyEngineering() {
        if (justEvaluated || expression.isBlank()) { engineering = true; engineeringShift = (engineeringShift + 1).coerceIn(-33, 33) }
        else moveCursor(-1)
    }

    private fun applyRnd() {
        try {
            val number = currentValue().first.value
            val precision = if (displayFormat == "Fix") displayDigits else if (displayFormat == "Sci") displayDigits else 10
            val factor = 10.0.pow(precision.coerceIn(0, 10))
            val rounded = roundInternal(kotlin.math.round(number * factor) / factor)
            answer = CalcNum.of(rounded); lastValue = CalcValue(answer); expression = ""; cursor = 0; justEvaluated = true
        } catch (e: CalcError) { error = e.display }
    }

    private fun openAngleConversion() {
        pending = "angleConvert"; prompt = Prompt("angleConvert", "DRG▶", "1 DEG  2 RAD  3 GRA")
    }

    private fun openStatistics(variable: Boolean) {
        if (mode == "COMP") { showMessage("SELECT SD OR REG MODE"); return }
        if (editingIndex != null) { showMessage("PRESS AC TO EXIT DATA"); return }
        if (variable) {
            pending = "statsVar"; prompt = Prompt("statsVar", "S-VAR", if (mode == "REG") "1 x̄ 2 σx 3 sx 4 ȳ 5 σy 6 sy 7 A 8 B 0 More" else "1 x̄ 2 σx 3 sx")
        } else {
            pending = "statsSum"; prompt = Prompt("statsSum", "S-SUM", if (mode == "REG") "1 Σx² 2 Σx 3 n 4 Σy² 5 Σy 6 Σxy 0 More" else "1 Σx² 2 Σx 3 n")
        }
    }

    private fun selectStatistic(which: String, option: String) {
        if ((which == "statsSum" || which == "statsVar") && option == "0") {
            pending = if (which == "statsSum") "statsSumMore" else "statsVarMore"
            prompt = if (which == "statsSum") Prompt("statsSumMore", "S-SUM+", if (regType == "Quad") "1 Σx³ 2 Σx²y 3 Σx⁴" else "No additional sums")
            else Prompt("statsVarMore", "S-VAR+", if (regType == "Quad") "1 C 2 ŷ 3 x̂1 4 x̂2" else "1 r 2 x̂ 3 ŷ")
            return
        }
        try {
            if (stats.isEmpty()) throw CalcError("NO DATA")
            val s = statValues()
            var value: Double? = when (which) {
                "statsSum" -> when (option) { "1" -> s.getValue("sumX2"); "2" -> s.getValue("sumX"); "3" -> s.getValue("n"); "4" -> s["sumY2"]; "5" -> s["sumY"]; "6" -> s["sumXY"]; else -> null }
                "statsSumMore" -> when (option) { "1" -> s["sumX3"]; "2" -> s["sumX2Y"]; "3" -> s["sumX4"]; else -> null }
                "statsVar" -> when (option) { "1" -> s["meanX"]; "2" -> s["sigmaX"]; "3" -> s["sampleX"]; "4" -> s["meanY"]; "5" -> s["sigmaY"]; "6" -> s["sampleY"]; else -> null }
                else -> null
            }
            if (mode == "REG" && (which == "statsVar" && option in listOf("7", "8") || which == "statsVarMore")) {
                val fit = regressionFit()
                lastFit = fit; variables["A"] = CalcNum.of(fit.a); variables["B"] = CalcNum.of(fit.b); if (regType == "Quad") variables["C"] = CalcNum.of(fit.c)
                value = when {
                    which == "statsVar" && option == "7" -> fit.a
                    which == "statsVar" && option == "8" -> fit.b
                    which == "statsVarMore" && regType == "Quad" && option == "1" -> fit.c
                    which == "statsVarMore" && regType == "Quad" && option == "2" -> regressionEstimate(fit, currentValue().first.value, true)
                    which == "statsVarMore" && regType == "Quad" && option == "3" -> regressionEstimate(fit, currentValue().first.value, false, 1)
                    which == "statsVarMore" && regType == "Quad" && option == "4" -> regressionEstimate(fit, currentValue().first.value, false, 2)
                    which == "statsVarMore" && option == "1" -> fit.r
                    which == "statsVarMore" && option == "2" -> regressionEstimate(fit, currentValue().first.value, false)
                    which == "statsVarMore" && option == "3" -> regressionEstimate(fit, currentValue().first.value, true)
                    else -> value
                }
            }
            if (value == null || !value.isFinite()) throw CalcError("NO DATA")
            cancelPrompt(); setResult(CalcValue(CalcNum.of(value)), clearExpression = true)
        } catch (e: CalcError) { cancelPrompt(); error = e.display }
    }

    private fun statValues(): Map<String, Double> {
        val n = stats.sumOf { it.frequency }.toDouble()
        if (n == 0.0) throw CalcError("NO DATA")
        val sx = stats.sumOf { it.x * it.frequency }
        val sx2 = stats.sumOf { it.x * it.x * it.frequency }
        val mx = sx / n
        val ssx = stats.sumOf { (it.x - mx).pow(2) * it.frequency }
        val out = mutableMapOf(
            "n" to n, "sumX" to sx, "sumX2" to sx2, "meanX" to mx,
            "sigmaX" to sqrt(max(0.0, ssx / n)), "sampleX" to sqrt(max(0.0, if (n > 1) ssx / (n - 1) else 0.0))
        )
        if (mode == "REG") {
            val sy = stats.sumOf { it.y * it.frequency }; val sy2 = stats.sumOf { it.y * it.y * it.frequency }
            val sxy = stats.sumOf { it.x * it.y * it.frequency }; val my = sy / n
            val ssy = stats.sumOf { (it.y - my).pow(2) * it.frequency }
            out.putAll(mapOf("sumY" to sy, "sumY2" to sy2, "sumXY" to sxy, "meanY" to my,
                "sigmaY" to sqrt(max(0.0, ssy / n)), "sampleY" to sqrt(max(0.0, if (n > 1) ssy / (n - 1) else 0.0))))
            if (regType == "Quad") {
                out["sumX3"] = stats.sumOf { it.x.pow(3) * it.frequency }
                out["sumX2Y"] = stats.sumOf { it.x.pow(2) * it.y * it.frequency }
                out["sumX4"] = stats.sumOf { it.x.pow(4) * it.frequency }
            }
        }
        return out
    }

    private fun regressionFit(): RegressionFit {
        val n = stats.sumOf { it.frequency }.toDouble()
        if (n < if (regType == "Quad") 3 else 2) throw CalcError("NO DATA")
        if (regType == "Quad") {
            fun sum(f: (StatPoint) -> Double) = stats.sumOf { f(it) * it.frequency }
            val s1 = sum { it.x }; val s2 = sum { it.x.pow(2) }; val s3 = sum { it.x.pow(3) }; val s4 = sum { it.x.pow(4) }
            val sy = sum { it.y }; val sxy = sum { it.x * it.y }; val sx2y = sum { it.x.pow(2) * it.y }
            val coeff = solve3(arrayOf(doubleArrayOf(n, s1, s2), doubleArrayOf(s1, s2, s3), doubleArrayOf(s2, s3, s4)), doubleArrayOf(sy, sxy, sx2y))
            return RegressionFit(coeff[0], coeff[1], coeff[2], 0.0)
        }
        val xs = stats.map { it.x }; val ys = stats.map { it.y }; val weights = stats.map { it.frequency.toDouble() }
        var tx = xs; var ty = ys
        var expA = false
        when (regType) {
            "Log" -> { if (xs.any { it <= 0 }) throw CalcError("Math ERROR"); tx = xs.map(::ln) }
            "Exp" -> { if (ys.any { it <= 0 }) throw CalcError("Math ERROR"); ty = ys.map(::ln); expA = true }
            "Pwr" -> { if (xs.any { it <= 0 } || ys.any { it <= 0 }) throw CalcError("Math ERROR"); tx = xs.map(::ln); ty = ys.map(::ln); expA = true }
            "Inv" -> { if (xs.any { it == 0.0 }) throw CalcError("Math ERROR"); tx = xs.map { 1.0 / it } }
        }
        val fit = leastSquares(tx, ty, weights)
        return RegressionFit(if (expA) exp(fit.first) else fit.first, fit.second, 0.0, fit.third)
    }

    private fun leastSquares(xs: List<Double>, ys: List<Double>, weights: List<Double>): Triple<Double, Double, Double> {
        val n = weights.sum(); if (n < 2) throw CalcError("NO DATA")
        val mx = xs.indices.sumOf { xs[it] * weights[it] } / n
        val my = ys.indices.sumOf { ys[it] * weights[it] } / n
        var sxx = 0.0; var syy = 0.0; var sxy = 0.0
        for (i in xs.indices) { val dx = xs[i] - mx; val dy = ys[i] - my; sxx += weights[i] * dx * dx; syy += weights[i] * dy * dy; sxy += weights[i] * dx * dy }
        if (sxx == 0.0) throw CalcError("Math ERROR")
        val b = sxy / sxx
        return Triple(my - b * mx, b, if (syy == 0.0) 0.0 else sxy / sqrt(sxx * syy))
    }

    private fun solve3(matrix: Array<DoubleArray>, vector: DoubleArray): DoubleArray {
        val m = Array(3) { r -> DoubleArray(4) { c -> if (c < 3) matrix[r][c] else vector[r] } }
        for (col in 0..2) {
            var pivot = col
            for (r in col + 1..2) if (abs(m[r][col]) > abs(m[pivot][col])) pivot = r
            val row = m[col]; m[col] = m[pivot]; m[pivot] = row
            if (abs(m[col][col]) < 1e-12) throw CalcError("Math ERROR")
            val div = m[col][col]; for (j in col..3) m[col][j] /= div
            for (r in 0..2) if (r != col) { val factor = m[r][col]; for (j in col..3) m[r][j] -= factor * m[col][j] }
        }
        return doubleArrayOf(m[0][3], m[1][3], m[2][3])
    }

    private fun regressionEstimate(fit: RegressionFit, input: Double, estimateY: Boolean, rootIndex: Int = 1): Double {
        val (a, b, c) = fit
        if (regType == "Quad") {
            if (estimateY) return a + b * input + c * input * input
            val d = b * b - 4 * c * (a - input)
            if (d < 0 || c == 0.0) throw CalcError("Math ERROR")
            val root = sqrt(d)
            return if (rootIndex == 1) (-b + root) / (2 * c) else (-b - root) / (2 * c)
        }
        if (estimateY) return when (regType) {
            "Log" -> { if (input <= 0) throw CalcError("Math ERROR"); a + b * ln(input) }
            "Exp" -> a * exp(b * input)
            "Pwr" -> { if (input <= 0) throw CalcError("Math ERROR"); a * input.pow(b) }
            "Inv" -> { if (input == 0.0) throw CalcError("Math ERROR"); a + b / input }
            else -> a + b * input
        }
        if (abs(b) < 1e-14) throw CalcError("Math ERROR")
        return when (regType) {
            "Log" -> exp((input - a) / b)
            "Exp" -> ln(input / a) / b
            "Pwr" -> (input / a).pow(1 / b)
            "Inv" -> b / (input - a)
            else -> (input - a) / b
        }
    }

    private fun addStatDatum() {
        try {
            val datum = if (expression.isNotBlank()) parseStatRecord(expression) else lastStat?.copy(frequency = 1) ?: throw CalcError("Syntax ERROR")
            if (stats.size >= 10000) throw CalcError("Data Full")
            if (statsRetained && stats.size >= 80) {
                pendingDatum = datum; pending = "dataFullWarning"; prompt = Prompt("dataFull", "DATA FULL", "PRESS AC TO CONTINUE"); return
            }
            registerStat(datum)
        } catch (e: CalcError) { error = e.display }
    }

    private fun parseStatRecord(source: String): StatPoint {
        val semi = source.indexOf(';')
        val expressionPart = if (semi >= 0) source.substring(0, semi) else source
        val frequencyValue = if (semi >= 0) evaluate(source.substring(semi + 1)).first.value else 1.0
        if (frequencyValue % 1.0 != 0.0 || frequencyValue !in 1.0..999.0) throw CalcError("Math ERROR")
        val freq = frequencyValue.toInt()
        return if (mode == "REG") {
            val comma = expressionPart.indexOf(',')
            if (comma < 0) throw CalcError("Syntax ERROR")
            val x = evaluate(expressionPart.substring(0, comma)).first.value
            val y = evaluate(expressionPart.substring(comma + 1)).first.value
            StatPoint(x, y, freq)
        } else StatPoint(evaluate(expressionPart).first.value, 0.0, freq)
    }

    private fun registerStat(point: StatPoint) {
        if (stats.size >= 10000) throw CalcError("Data Full")
        stats.add(point); lastStat = point; editingIndex = null; editDirty = false; lastFit = null
        answer = CalcNum.of(if (mode == "REG") point.y else point.x)
        lastValue = CalcValue(CalcNum.of(stats.sumOf { it.frequency }.toDouble()))
        expression = ""; cursor = 0; justEvaluated = true; cancelPrompt()
        if (mode == "REG") try { lastFit = regressionFit(); variables["A"] = CalcNum.of(lastFit!!.a); variables["B"] = CalcNum.of(lastFit!!.b); variables["C"] = CalcNum.of(lastFit!!.c) } catch (_: CalcError) { }
        showMessage("n=${stats.sumOf { it.frequency }}")
    }

    private fun browseStats(direction: Int) {
        if (!statsRetained) { showMessage("DATA NOT STORED"); return }
        if (stats.isEmpty()) { showMessage("NO DATA"); return }
        val index = if (editingIndex == null) stats.lastIndex else (editingIndex!! + direction).coerceIn(0, stats.lastIndex)
        editingIndex = index; editDirty = false
        val row = stats[index]
        expression = if (mode == "REG") "${formatPlain(row.x)},${formatPlain(row.y)}" else formatPlain(row.x)
        if (row.frequency > 1) expression += ";${row.frequency}"
        cursor = expression.length; justEvaluated = false; error = ""; prompt = null; pending = null
        lastValue = CalcValue(CalcNum.of(stats.sumOf { it.frequency }.toDouble()))
    }

    private fun commitEditedStat() {
        val index = editingIndex ?: return
        if (!editDirty) { showMessage("EDIT OFF"); return }
        try {
            val row = parseStatRecord(expression)
            stats[index] = row; lastStat = row; lastFit = null; editDirty = false
            lastValue = CalcValue(CalcNum.of(stats.sumOf { it.frequency }.toDouble())); error = ""; expression = ""; cursor = 0; editingIndex = null
        } catch (e: CalcError) { error = e.display }
    }

    private fun deleteStat() {
        if (stats.isEmpty()) { showMessage("NO DATA"); return }
        val index = editingIndex ?: stats.lastIndex
        stats.removeAt(index.coerceIn(0, stats.lastIndex)); editingIndex = null; editDirty = false; lastFit = null
        lastValue = CalcValue(CalcNum.of(stats.sumOf { it.frequency }.toDouble())); expression = ""; cursor = 0
        showMessage("DATA CLEARED")
    }

    private fun showMessage(text: String) { message = text; error = "" }

    private fun calculate() {
        if (expression.isBlank()) return
        try {
            val value = evaluate(expression)
            validateRange(value.first.value)
            if (value.second != null) validateRange(value.second!!.value)
            val original = expression
            setResult(value, clearExpression = false)
            answer = value.first
            justEvaluated = true; error = ""; dmsDisplay = null; engineering = false; engineeringShift = 0
            if (original.contains('°') && Regex("[+−×÷*]").containsMatchIn(original)) dmsDisplay = formatDms(value.first.value)
            pushHistory(original, value)
            if (editingIndex != null) editDirty = true
        } catch (e: CalcError) { error = e.display }
    }

    private fun setResult(value: CalcValue, clearExpression: Boolean) {
        lastValue = value; answer = value.first; error = ""; message = ""; justEvaluated = true
        if (clearExpression) { expression = ""; cursor = 0 }
    }

    private fun evaluate(source: String): CalcValue {
        val statements = splitStatements(autoClose(source))
        var value = CalcValue(answer)
        for (part in statements) {
            if (part.isBlank()) throw CalcError("Syntax ERROR")
            value = Parser(part).parse()
            answer = value.first
        }
        return value
    }

    private fun splitStatements(source: String): List<String> {
        val parts = mutableListOf<String>(); var depth = 0; var start = 0
        source.forEachIndexed { i, c -> when (c) { '(' -> depth++; ')' -> depth--; ':' -> if (depth == 0) { parts.add(source.substring(start, i)); start = i + 1 } } }
        parts.add(source.substring(start)); return parts
    }

    private fun applyBinary(operator: String, left: CalcValue, right: CalcValue): CalcValue {
        val a = left.first; val b = right.first
        val av = a.value; val bv = b.value
        if (right.isPercent && operator in listOf("+", "−", "-", "×", "*", "÷", "/")) {
            val ratio = b
            val result = when (operator) {
                "+" -> add(a, multiply(a, ratio))
                "−", "-" -> subtract(a, multiply(a, ratio))
                "×", "*" -> multiply(a, ratio)
                else -> divide(a, ratio)
            }
            return CalcValue(result)
        }
        val result = when (operator) {
            "+" -> add(a, b)
            "−", "-" -> subtract(a, b)
            "×", "*" -> multiply(a, b)
            "÷", "/" -> divide(a, b)
            "^" -> {
                if (av == 0.0 && bv <= 0.0 || av < 0 && bv % 1.0 != 0.0) throw CalcError("Math ERROR")
                if (av == 10.0 && bv > 99.99999999 || av == Math.E && bv > 230.2585092) throw CalcError("Math ERROR")
                CalcNum.of(av.pow(bv))
            }
            "root" -> {
                if (av == 0.0 || (bv < 0 && av % 2.0 == 0.0)) throw CalcError("Math ERROR")
                CalcNum.of(if (bv < 0) -((-bv).pow(1.0 / av)) else bv.pow(1.0 / av))
            }
            "nCr", "ncr" -> CalcNum.of(permutation(av, bv, true))
            "nPr", "npr" -> CalcNum.of(permutation(av, bv, false))
            else -> throw CalcError("Syntax ERROR")
        }
        validateRange(result.value)
        return CalcValue(result)
    }

    private fun add(a: CalcNum, b: CalcNum) = if (a.exact != null && b.exact != null) CalcNum.exact(a.exact.plus(b.exact)) else CalcNum.of(a.value + b.value)
    private fun subtract(a: CalcNum, b: CalcNum) = if (a.exact != null && b.exact != null) CalcNum.exact(a.exact.minus(b.exact)) else CalcNum.of(a.value - b.value)
    private fun multiply(a: CalcNum, b: CalcNum) = if (a.exact != null && b.exact != null) CalcNum.exact(a.exact.times(b.exact)) else CalcNum.of(a.value * b.value)
    private fun divide(a: CalcNum, b: CalcNum) = if (a.exact != null && b.exact != null) CalcNum.exact(a.exact.over(b.exact)) else {
        if (b.value == 0.0) throw CalcError("Math ERROR"); CalcNum.of(a.value / b.value)
    }

    private fun permutation(nValue: Double, rValue: Double, combination: Boolean): Double {
        if (nValue % 1.0 != 0.0 || rValue % 1.0 != 0.0 || nValue < 0 || rValue < 0 || rValue > nValue || nValue > 69) throw CalcError("Math ERROR")
        val n = nValue.toInt(); val r = rValue.toInt(); val terms = if (combination) min(r, n - r) else r
        var out = 1.0
        for (i in 0 until terms) { out *= n - i; if (combination) out /= (i + 1); if (!out.isFinite() || out > 9.999999999e99) throw CalcError("Math ERROR") }
        return roundInternal(out)
    }

    private fun validateRange(value: Double) {
        if (!value.isFinite() || abs(value) > 9.999999999e99 || (value != 0.0 && abs(value) < 1e-99)) throw CalcError("Math ERROR")
    }

    private fun angleToRadians(value: Double) = when (angle) { "DEG" -> value * Math.PI / 180.0; "GRA" -> value * Math.PI / 200.0; else -> value }
    private fun radiansToAngle(value: Double) = when (angle) { "DEG" -> value * 180.0 / Math.PI; "GRA" -> value * 200.0 / Math.PI; else -> value }

    private fun applyFunction(name: String, args: List<CalcValue>): CalcValue {
        val arity = if (name == "rand") 0 else if (name == "pol" || name == "rec") 2 else 1
        if (args.size != arity) throw CalcError("Arg ERROR")
        val a = args.firstOrNull()?.first?.value ?: 0.0
        val b = args.getOrNull(1)?.first?.value ?: 0.0
        if (listOf("sin", "cos", "tan").contains(name)) {
            val limit = when (angle) { "DEG" -> 9e9; "RAD" -> 157079632.7; else -> 1e10 }
            if (abs(a) >= limit) throw CalcError("Math ERROR")
            if (name == "tan") {
                val period = when (angle) { "DEG" -> 90.0; "GRA" -> 100.0; else -> Math.PI / 2.0 }
                val q = a / period; val near = kotlin.math.round(q)
                if (abs(near % 2.0) == 1.0 && abs(q - near) <= 1e-12 * max(1.0, abs(q))) throw CalcError("Math ERROR")
            }
        }
        if ((name == "sinh" || name == "cosh") && abs(a) > 230.2585092) throw CalcError("Math ERROR")
        if (name == "atanh" && abs(a) >= 0.9999999999 || name == "acosh" && a < 1.0) throw CalcError("Math ERROR")
        if ((name == "log" || name == "ln") && a <= 0.0 || name == "sqrt" && a < 0.0) throw CalcError("Math ERROR")
        val result = when (name) {
            "sin" -> sin(angleToRadians(a)); "cos" -> cos(angleToRadians(a)); "tan" -> tan(angleToRadians(a))
            "asin" -> radiansToAngle(asin(a)); "acos" -> radiansToAngle(acos(a)); "atan" -> radiansToAngle(atan(a))
            "sinh" -> sinh(a); "cosh" -> cosh(a); "tanh" -> tanh(a)
            "asinh" -> ln(a + sqrt(a * a + 1.0))
            "acosh" -> ln(a + sqrt(a * a - 1.0))
            "atanh" -> 0.5 * ln((1.0 + a) / (1.0 - a))
            "log" -> log10(a); "ln" -> ln(a); "sqrt" -> sqrt(a); "cbrt" -> Math.cbrt(a)
            "abs" -> abs(a); "floor" -> floor(a); "ceil" -> ceil(a); "exp" -> exp(a)
            "rnd" -> {
                val digits = if (displayFormat == "Fix") displayDigits else 10
                val factor = 10.0.pow(digits); kotlin.math.round(a * factor) / factor
            }
            "rand" -> kotlin.random.Random.nextDouble(0.0, 1.0)
            "pol" -> {
                val r = sqrt(a * a + b * b); var theta = radiansToAngle(atan2(b, a))
                if (angle == "DEG" && abs(theta + 180.0) < 1e-12) theta = 180.0
                if (angle == "GRA" && abs(theta + 200.0) < 1e-12) theta = 200.0
                variables["E"] = CalcNum.of(r); variables["F"] = CalcNum.of(theta)
                return CalcValue(CalcNum.of(r), CalcNum.of(theta))
            }
            "rec" -> {
                if (a < 0.0) throw CalcError("Math ERROR")
                val radians = angleToRadians(b); val x = roundInternal(a * cos(radians)); val y = roundInternal(a * sin(radians))
                variables["E"] = CalcNum.of(x); variables["F"] = CalcNum.of(y)
                return CalcValue(CalcNum.of(x), CalcNum.of(y))
            }
            else -> throw CalcError("Syntax ERROR")
        }
        if (!result.isFinite()) throw CalcError("Math ERROR")
        validateRange(result)
        return CalcValue(CalcNum.of(result))
    }

    private fun formatValue(value: CalcValue): String {
        if (engineering) return formatEngineering(value.first.value)
        val first = if (fractionView == 2) formatFraction(value.first, false) else if (fractionView == 3) formatFraction(value.first, true) else formatNumber(value.first.value)
        if (value.second != null) return "$first; ${formatNumber(value.second!!.value)}"
        if (fractionView == 1) return formatNumber(value.first.value)
        val expressionLooksFractional = expression.contains('/') && !Regex("\\d+\\.\\d+").containsMatchIn(expression)
        if (justEvaluated && expressionLooksFractional && value.first.exact != null && value.first.exact.denominator != BigInteger.ONE) {
            return formatFraction(value.first, fractionFormat == "mixed")
        }
        return first
    }

    private fun formatPlain(value: Double): String = BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()

    private fun formatNumber(value: Double): String {
        if (!value.isFinite()) return "Math ERROR"
        if (value == 0.0) return if (displayFormat == "Fix" && displayDigits > 0) "0${decimalSymbol}${"0".repeat(displayDigits)}" else "0"
        val absValue = abs(value)
        val raw = when {
            displayFormat == "Fix" && absValue < 1e21 -> String.format(Locale.US, "% .${displayDigits}f", value).trim()
            displayFormat == "Sci" -> scientific(value, (displayDigits - 1).coerceAtLeast(0))
            absValue >= 1e10 || absValue < if (normSetting == 1) 1e-2 else 1e-9 -> scientific(value, 9)
            else -> BigDecimal.valueOf(value).round(MathContext(10, RoundingMode.HALF_UP)).stripTrailingZeros().toPlainString()
        }
        return localize(raw.replace("E+", "e").replace("E", "e"))
    }

    private fun scientific(value: Double, fractionalDigits: Int): String {
        var text = String.format(Locale.US, "% .${fractionalDigits.coerceIn(0, 12)}e", value).trim()
        text = text.replace(Regex("(\\.\\d*?)0+e"), "$1e").replace(Regex("\\.e"), "e")
        text = text.replace(Regex("e([+-]?)0+(\\d+)")) { "e${it.groupValues[1]}${it.groupValues[2]}" }.replace("e+", "e")
        return text
    }

    private fun localize(text: String): String {
        val expAt = text.indexOfAny(charArrayOf('e', 'E'))
        val mantissa = if (expAt >= 0) text.substring(0, expAt) else text
        val exponent = if (expAt >= 0) text.substring(expAt) else ""
        val sign = if (mantissa.startsWith('-')) "−" else ""
        val unsigned = mantissa.removePrefix("-").removePrefix("+")
        val dot = unsigned.indexOf('.')
        val integer = if (dot >= 0) unsigned.substring(0, dot) else unsigned
        val decimals = if (dot >= 0) unsigned.substring(dot + 1) else ""
        val grouping = if (decimalSymbol == ".") "," else "."
        val grouped = integer.reversed().chunked(3).joinToString(grouping).reversed()
        return sign + grouped + if (decimals.isNotEmpty()) decimalSymbol + decimals + exponent else exponent
    }

    private fun formatFraction(number: CalcNum, mixed: Boolean): String {
        val ratio = number.exact ?: approximateFraction(number.value) ?: return formatNumber(number.value)
        val neg = ratio.numerator.signum() < 0
        val n = ratio.numerator.abs(); val d = ratio.denominator
        val sign = if (neg) "−" else ""
        val text = if (d == BigInteger.ONE) "$sign$n" else if (mixed && n >= d) {
            val whole = n / d; val rem = n % d
            if (rem == BigInteger.ZERO) "$sign$whole" else "$sign$whole ${rem}/$d"
        } else "$sign$n/$d"
        return if (text.length > 10) formatNumber(number.value) else text
    }

    private fun approximateFraction(value: Double): Rational? {
        if (!value.isFinite() || abs(value) > 1e7) return null
        val sign = if (value < 0) -1L else 1L
        val target = abs(value)
        var x = target; var h0 = 0L; var h1 = 1L; var k0 = 1L; var k1 = 0L
        var bestN = 0L; var bestD = 1L; var bestError = Double.MAX_VALUE
        for (iteration in 0 until 32) {
            val a = floor(x).toLong(); val h2 = a * h1 + h0; val k2 = a * k1 + k0
            if (k2 > 1_000_000) break
            val error = abs(target - h2.toDouble() / k2)
            bestN = h2; bestD = k2; bestError = error
            if (error < 1e-13 || x - a < 1e-15) break
            val rem = x - a; if (rem == 0.0) break
            x = 1.0 / rem; h0 = h1; h1 = h2; k0 = k1; k1 = k2
        }
        return if (bestError <= 1e-11) Rational.of(BigInteger.valueOf(bestN * sign), BigInteger.valueOf(bestD)) else null
    }

    private fun formatEngineering(value: Double): String {
        if (value == 0.0 || !value.isFinite()) return formatNumber(value)
        val exponent = (floor(log10(abs(value)) / 3.0).toInt() * 3 - engineeringShift * 3).coerceIn(-99, 99)
        val mantissa = value / 10.0.pow(exponent)
        return "${formatNumber(mantissa)}×10^$exponent"
    }

    private fun formatDms(value: Double): String {
        if (!value.isFinite() || abs(value) > 9999999 + 59 / 60.0) return "Math ERROR"
        val sign = if (value < 0) "−" else ""
        var hundredths = kotlin.math.round(abs(value) * 360000).toLong()
        var degrees = hundredths / 360000; hundredths -= degrees * 360000
        var minutes = hundredths / 6000; hundredths -= minutes * 6000
        var seconds = hundredths / 100.0
        if (seconds >= 60) { seconds = 0.0; minutes++ }
        if (minutes >= 60) { minutes = 0; degrees++ }
        val secWhole = floor(seconds).toInt(); val frac = kotlin.math.round((seconds - secWhole) * 100).toInt()
        val sec = "%02d".format(Locale.US, secWhole) + if (frac != 0) ".${"%02d".format(Locale.US, frac).trimEnd('0')}" else ""
        return "$sign$degrees° ${"%02d".format(Locale.US, minutes)}′ $sec″"
    }

    private fun moveCursor(delta: Int) { cursor = (cursor + delta).coerceIn(0, expression.length) }
    private fun expressionWithCursor(): String = if (expression.isEmpty()) "" else expression.substring(0, cursor) + "▏" + expression.substring(cursor)
    private fun stepCount(text: String): Int = text.count { !it.isWhitespace() }.coerceAtMost(79)

    private fun browseHistory(direction: Int) {
        if (history.isEmpty()) return
        if (replayIndex < 0) replayIndex = history.lastIndex else replayIndex = (replayIndex + direction).coerceIn(0, history.lastIndex)
        val row = history[replayIndex]; expression = row.first; cursor = expression.length; lastValue = row.second; answer = row.second.first
        justEvaluated = false; error = ""; dmsDisplay = null
    }

    private fun pushHistory(source: String, value: CalcValue) {
        history.add(source to value)
        fun bytes(text: String) = text.toByteArray(Charsets.UTF_8).size
        while (history.isNotEmpty() && history.sumOf { bytes(it.first) + bytes(formatValue(it.second)) + 1 } > 150) history.removeAt(0)
        replayIndex = -1
    }

    private fun autoCloseForDms(source: String): String {
        var out = source.replace('−', '-').replace('×', '*').replace('÷', '/')
        val dms3 = Regex("(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))°(\\d+(?:\\.\\d*)?)′(\\d+(?:\\.\\d*)?)″?")
        out = dms3.replace(out) { m ->
            val deg = m.groupValues[1].toDouble(); val min = m.groupValues[2].toDouble(); val sec = m.groupValues[3].toDouble()
            if (min >= 60 || sec >= 60) throw CalcError("Math ERROR")
            val sign = if (deg < 0) "-" else ""
            "${sign}(${abs(deg)}+${min}/60+${sec}/3600)"
        }
        val dms2 = Regex("(-?(?:\\d+(?:\\.\\d*)?|\\.\\d+))°(\\d+(?:\\.\\d*)?)′")
        out = dms2.replace(out) { m ->
            val deg = m.groupValues[1].toDouble(); val min = m.groupValues[2].toDouble()
            if (min >= 60) throw CalcError("Math ERROR")
            val sign = if (deg < 0) "-" else ""
            "${sign}(${abs(deg)}+${min}/60)"
        }
        return out.replace("°", "").replace("′", "").replace("″", "")
    }

    private fun autoClose(source: String, unused: Boolean = false): String {
        val prepared = autoCloseForDms(source)
        var depth = 0
        prepared.forEach { if (it == '(') depth++ else if (it == ')') depth-- }
        return prepared + ")".repeat(depth.coerceAtLeast(0))
    }

    /** Minimal persistence snapshot for SharedPreferences. */
    fun exportState(): String {
        val p = Properties()
        p.setProperty("mode", mode); p.setProperty("angle", angle); p.setProperty("regType", regType)
        p.setProperty("displayFormat", displayFormat); p.setProperty("displayDigits", displayDigits.toString())
        p.setProperty("normSetting", normSetting.toString()); p.setProperty("fractionFormat", fractionFormat)
        p.setProperty("decimalSymbol", decimalSymbol); p.setProperty("answer", encodeNum(answer)); p.setProperty("memory", encodeNum(memoryValue))
        p.setProperty("statsRetained", statsRetained.toString())
        variables.forEach { (key, value) -> p.setProperty("var.$key", encodeNum(value)) }
        p.setProperty("stats", stats.joinToString("|") { "${it.x},${it.y},${it.frequency}" })
        val writer = StringWriter(); p.store(writer, "fx82ms native state"); return writer.toString()
    }

    fun importState(serialized: String?) {
        if (serialized.isNullOrBlank()) return
        try {
            val p = Properties(); p.load(StringReader(serialized))
            mode = p.getProperty("mode", "COMP").takeIf { it in listOf("COMP", "SD", "REG") } ?: "COMP"
            angle = p.getProperty("angle", "DEG").takeIf { it in listOf("DEG", "RAD", "GRA") } ?: "DEG"
            regType = p.getProperty("regType", "Lin").takeIf { it in listOf("Lin", "Log", "Exp", "Pwr", "Inv", "Quad") } ?: "Lin"
            displayFormat = p.getProperty("displayFormat", "Norm").takeIf { it in listOf("Norm", "Fix", "Sci") } ?: "Norm"
            displayDigits = p.getProperty("displayDigits", "10").toIntOrNull()?.coerceIn(0, 10) ?: 10
            normSetting = p.getProperty("normSetting", "1").toIntOrNull()?.coerceIn(1, 2) ?: 1
            fractionFormat = p.getProperty("fractionFormat", "mixed").takeIf { it in listOf("mixed", "improper") } ?: "mixed"
            decimalSymbol = p.getProperty("decimalSymbol", ".").takeIf { it in listOf(".", ",") } ?: "."
            answer = decodeNum(p.getProperty("answer", "D:0")); memoryValue = decodeNum(p.getProperty("memory", "D:0")); variables["M"] = memoryValue
            variables.keys.toList().forEach { key -> if (key != "M") variables[key] = decodeNum(p.getProperty("var.$key", "D:0")) }
            stats.clear()
            p.getProperty("stats", "").split('|').filter { it.isNotBlank() }.take(10000).forEach { row ->
                val parts = row.split(','); if (parts.size == 3) stats.add(StatPoint(parts[0].toDouble(), parts[1].toDouble(), parts[2].toInt().coerceIn(1, 999)))
            }
            statsRetained = p.getProperty("statsRetained", "true").toBoolean()
            lastStat = stats.lastOrNull()
            lastValue = CalcValue(answer); expression = ""; cursor = 0; poweredOn = true; pending = null; prompt = null
        } catch (_: Exception) { /* Ignore corrupt app state. */ }
    }

    private fun encodeNum(number: CalcNum): String = number.exact?.let { "Q:${it.numerator}/${it.denominator}" } ?: "D:${number.value}"
    private fun decodeNum(encoded: String): CalcNum = try {
        if (encoded.startsWith("Q:")) { val p = encoded.substring(2).split('/'); CalcNum.exact(Rational.of(BigInteger(p[0]), BigInteger(p[1]))) }
        else CalcNum.of(encoded.removePrefix("D:").toDouble())
    } catch (_: Exception) { CalcNum.exact(Rational.ZERO) }

    private inner class Parser(source: String) {
        private val functions = setOf("sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "asinh", "acosh", "atanh", "log", "ln", "sqrt", "cbrt", "exp", "abs", "floor", "ceil", "rnd", "rand", "pol", "rec")
        private val tokens = tokenize(source)
        private var index = 0
        private var depth = 0

        fun parse(): CalcValue {
            if (tokens.isEmpty()) throw CalcError("Syntax ERROR")
            val value = parseExpression(0)
            if (index != tokens.size) throw CalcError("Syntax ERROR")
            return value
        }

        private fun tokenize(input: String): List<ParserToken> {
            val src = input.replace("−", "-").replace("×", "*").replace("÷", "/")
            val raw = mutableListOf<ParserToken>(); var i = 0
            while (i < src.length) {
                val c = src[i]
                if (c.isWhitespace()) { i++; continue }
                if (c.isDigit() || c == '.') {
                    val start = i
                    if (c == '.') i++ else while (i < src.length && src[i].isDigit()) i++
                    if (i < src.length && src[i] == '.') { i++; while (i < src.length && src[i].isDigit()) i++ }
                    if (i < src.length && (src[i] == 'e' || src[i] == 'E')) {
                        val save = i; i++; if (i < src.length && (src[i] == '+' || src[i] == '-')) i++
                        val digitsStart = i; while (i < src.length && src[i].isDigit()) i++
                        if (i == digitsStart) i = save
                    }
                    val text = src.substring(start, i); raw.add(ParserToken(ParserTokenType.NUMBER, text, CalcNum.exact(Rational.fromDecimal(text)))); continue
                }
                if (c == 'π') { raw.add(ParserToken(ParserTokenType.IDENT, "pi")); i++; continue }
                if (c.isLetter()) {
                    val start = i++; while (i < src.length && (src[i].isLetterOrDigit())) i++
                    val word = src.substring(start, i)
                    val lower = word.lowercase(Locale.US)
                    if (lower in listOf("ncr", "npr", "root")) raw.add(ParserToken(ParserTokenType.OP, lower)) else raw.add(ParserToken(ParserTokenType.IDENT, word))
                    continue
                }
                when (c) {
                    '(' -> raw.add(ParserToken(ParserTokenType.LPAREN, "("))
                    ')' -> raw.add(ParserToken(ParserTokenType.RPAREN, ")"))
                    ',' -> raw.add(ParserToken(ParserTokenType.COMMA, ","))
                    '!', '%' -> raw.add(ParserToken(ParserTokenType.POSTFIX, c.toString()))
                    '+', '-', '*', '/', '^' -> raw.add(ParserToken(ParserTokenType.OP, c.toString()))
                    else -> throw CalcError("Syntax ERROR")
                }
                i++
            }
            val result = mutableListOf<ParserToken>()
            fun canEnd(t: ParserToken) = t.type in setOf(ParserTokenType.NUMBER, ParserTokenType.RPAREN, ParserTokenType.POSTFIX) || (t.type == ParserTokenType.IDENT && t.text.lowercase(Locale.US) !in functions)
            fun canStart(t: ParserToken) = t.type in setOf(ParserTokenType.NUMBER, ParserTokenType.LPAREN) || (t.type == ParserTokenType.IDENT)
            raw.forEach { token ->
                val previous = result.lastOrNull()
                if (previous != null && canEnd(previous) && canStart(token) && !(previous.type == ParserTokenType.IDENT && previous.text.lowercase(Locale.US) in functions)) result.add(ParserToken(ParserTokenType.OP, "*"))
                result.add(token)
            }
            return result
        }

        private fun peek() = tokens.getOrNull(index)
        private fun take() = tokens.getOrNull(index++)

        private fun parseExpression(minimum: Int): CalcValue {
            depth++
            if (depth > 25) throw CalcError("Stack ERROR")
            var left = parsePrefix()
            while (true) {
                val token = peek() ?: break
                if (token.type == ParserTokenType.POSTFIX) {
                    take()
                    left = when (token.text) {
                        "!" -> CalcValue(CalcNum.of(factorial(left.first.value)))
                        else -> {
                            validateRange(left.first.value)
                            val ratio = left.first.exact?.over(Rational.of(BigInteger.valueOf(100), BigInteger.ONE))?.let(CalcNum::exact) ?: CalcNum.of(left.first.value / 100.0)
                            CalcValue(ratio, isPercent = true)
                        }
                    }
                    continue
                }
                if (token.type != ParserTokenType.OP) break
                val precedence = precedence(token.text)
                if (precedence < minimum) break
                take()
                val right = parseExpression(if (token.text == "^") precedence else precedence + 1)
                left = applyBinary(token.text, left, right)
            }
            depth--
            return left
        }

        private fun parsePrefix(): CalcValue {
            val token = take() ?: throw CalcError("Syntax ERROR")
            return when (token.type) {
                ParserTokenType.NUMBER -> CalcValue(token.number!!)
                ParserTokenType.OP -> when (token.text) {
                    "+" -> parseExpression(4)
                    "-" -> { val v = parseExpression(4); CalcValue(v.first.exact?.let { CalcNum.exact(it.negated()) } ?: CalcNum.of(-v.first.value)) }
                    else -> throw CalcError("Syntax ERROR")
                }
                ParserTokenType.LPAREN -> {
                    val value = parseExpression(0)
                    if (peek()?.type == ParserTokenType.RPAREN) take()
                    value
                }
                ParserTokenType.IDENT -> parseIdentifier(token.text)
                else -> throw CalcError("Syntax ERROR")
            }
        }

        private fun parseIdentifier(name: String): CalcValue {
            val lower = name.lowercase(Locale.US)
            if (lower in functions) {
                val args = mutableListOf<CalcValue>()
                if (peek()?.type == ParserTokenType.LPAREN) {
                    take()
                    if (peek()?.type != ParserTokenType.RPAREN) {
                        args.add(parseExpression(0))
                        while (peek()?.type == ParserTokenType.COMMA) { take(); args.add(parseExpression(0)) }
                    }
                    if (peek()?.type == ParserTokenType.RPAREN) take() else throw CalcError("Syntax ERROR")
                } else if (lower != "rand") args.add(parseExpression(5))
                return applyFunction(lower, args)
            }
            return when {
                lower == "pi" -> CalcValue(CalcNum.of(Math.PI))
                name == "e" -> CalcValue(CalcNum.of(Math.E))
                lower == "ans" -> CalcValue(answer)
                name.length == 1 && name.uppercase(Locale.US) in variables -> {
                    val key = name.uppercase(Locale.US)
                    CalcValue(if (key == "M") memoryValue else variables[key] ?: CalcNum.exact(Rational.ZERO))
                }
                else -> throw CalcError("Syntax ERROR")
            }
        }

        private fun precedence(op: String) = when (op.lowercase(Locale.US)) {
            "+", "-" -> 1
            "*", "/" -> 2
            "ncr", "npr", "root" -> 3
            "^" -> 4
            else -> -1
        }

        private fun factorial(value: Double): Double {
            if (value % 1.0 != 0.0 || value < 0 || value > 69) throw CalcError("Math ERROR")
            var out = BigInteger.ONE
            for (i in 2..value.toInt()) out *= BigInteger.valueOf(i.toLong())
            val d = out.toDouble(); validateRange(d); return d
        }
    }
}
