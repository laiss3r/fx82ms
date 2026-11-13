package com.arena.fx82ms

import android.app.Activity
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.GridLayout
import android.widget.LinearLayout
import android.widget.TextView

/** Native Android front end. All calculator rendering and behavior are implemented in Kotlin. */
class MainActivity : Activity() {
    private val engine = CalculatorEngine()
    private val handler = Handler(Looper.getMainLooper())
    private var statusView: TextView? = null
    private var expressionView: TextView? = null
    private var resultView: TextView? = null
    private var shiftView: View? = null
    private var alphaView: View? = null
    private val vibrator by lazy { getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator }
    private val clearMessage = Runnable { engine.clearTransientMessage(); render() }
    private val autoPowerOff = Runnable { engine.powerOff(); saveState(); render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.statusBarColor = Color.rgb(35, 36, 36)
        window.navigationBarColor = Color.rgb(35, 36, 36)
        window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_HIDDEN)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            val lp = window.attributes
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            window.attributes = lp
        }
        engine.importState(getSharedPreferences(PREFS, MODE_PRIVATE).getString(STATE, null))
        enterImmersiveFullscreen()
        setContentView(createCalculatorView())
        render()
        scheduleAutoPowerOff()
    }

    private fun createCalculatorView(): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.rgb(35, 36, 36))
            setPadding(dp(5), dp(4), dp(5), dp(5))
        }

        root.addView(createBrand(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(30)))
        root.addView(createDisplay(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1.38f))
        root.addView(createTopControls(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 0.78f))
        root.addView(createFunctionGrid(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 4.05f))
        root.addView(createNumberGrid(), LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 4.10f))
        return root
    }

    private fun createBrand(): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        fun label(text: String, size: Float, gravity: Int, weight: Float, bold: Boolean = true) {
            val view = TextView(this).apply {
                this.text = text; setTextColor(Color.rgb(235, 235, 228)); setTextSize(TypedValue.COMPLEX_UNIT_SP, size)
                setTypeface(Typeface.DEFAULT, if (bold) Typeface.BOLD else Typeface.NORMAL); this.gravity = gravity; maxLines = 1
            }
            row.addView(view, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, weight))
        }
        label("CASIO", 13f, Gravity.CENTER_VERTICAL or Gravity.START, 0.9f)
        label("fx-82MS", 15f, Gravity.CENTER, 1.0f)
        label("S-V.P.A.M.  ·  2nd edition", 9f, Gravity.CENTER_VERTICAL or Gravity.END, 1.8f, false)
        return row
    }

    private fun createDisplay(): View {
        val lcd = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            val bg = GradientDrawable().apply { setColor(Color.rgb(170, 181, 153)); cornerRadius = dp(8).toFloat() }
            background = bg
            setPadding(dp(8), dp(5), dp(8), dp(5))
        }
        statusView = TextView(this).apply {
            setTextColor(Color.rgb(32, 38, 27)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD); maxLines = 1; gravity = Gravity.CENTER_VERTICAL
        }
        expressionView = TextView(this).apply {
            setTextColor(Color.rgb(31, 37, 27)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            setTypeface(Typeface.MONOSPACE); maxLines = 1; gravity = Gravity.CENTER_VERTICAL
            isSingleLine = true; setPadding(0, dp(2), 0, 0)
        }
        resultView = TextView(this).apply {
            setTextColor(Color.rgb(25, 31, 23)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 30f)
            setTypeface(Typeface.MONOSPACE, Typeface.NORMAL); maxLines = 1; gravity = Gravity.END or Gravity.CENTER_VERTICAL
            isSingleLine = true; includeFontPadding = false
        }
        lcd.addView(statusView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(20)))
        lcd.addView(expressionView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(28)))
        lcd.addView(resultView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        val outer = LinearLayout(this).apply { setPadding(0, dp(2), 0, dp(4)) }
        outer.addView(lcd, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.MATCH_PARENT))
        return outer
    }

    private fun createTopControls(): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(2), 0, dp(3))
        }
        val modeKey = makeRoundKey("MODE", "CLR", "mode", Color.rgb(57, 59, 60), 0.90f)
        row.addView(modeKey, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { setMargins(dp(1), 0, dp(2), 0) })
        row.addView(createDpad(), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1.35f).apply { setMargins(dp(1), 0, dp(1), 0) })
        val onKey = makeRoundKey("ON", "", "on", Color.rgb(57, 59, 60), 0.82f)
        row.addView(onKey, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 0.9f).apply { setMargins(dp(1), 0, dp(2), 0) })
        alphaView = makeRoundKey("ALPHA", "", "alpha", Color.rgb(16, 18, 133), 0.82f)
        row.addView(alphaView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { setMargins(dp(1), 0, dp(1), 0) })
        shiftView = makeRoundKey("SHIFT", "", "shift", Color.rgb(202, 61, 30), 0.82f)
        row.addView(shiftView, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f).apply { setMargins(dp(1), 0, dp(1), 0) })
        return row
    }

    private fun createDpad(): View {
        val grid = GridLayout(this).apply {
            rowCount = 3; columnCount = 3; useDefaultMargins = false
        }
        val items = mapOf(1 to "up", 3 to "left", 5 to "right", 7 to "down")
        for (i in 0 until 9) {
            val key = items[i]
            val view = if (key == null) View(this) else makeKey(
                key, when (key) { "up" -> "▲"; "down" -> "▼"; "left" -> "◀"; else -> "▶" },
                "", "", KeyStyle.NAV, 12f
            )
            val row = i / 3; val col = i % 3
            val lp = GridLayout.LayoutParams(GridLayout.spec(row, 1, 1f), GridLayout.spec(col, 1, 1f)).apply {
                width = 0; height = 0; setMargins(dp(1), dp(1), dp(1), dp(1))
            }
            grid.addView(view, lp)
        }
        return grid
    }

    private data class KeySpec(val key: String, val main: String, val shift: String = "", val alpha: String = "", val style: KeyStyle = KeyStyle.FUNCTION)
    private enum class KeyStyle { FUNCTION, NUMBER, OPERATOR, ACTION, NAV }

    private fun createFunctionGrid(): View {
        val keys = listOf(
            KeySpec("inverse", "x⁻¹", "x!"), KeySpec("ncr", "nCr", "nPr"), KeySpec("polar", "Pol(", "Rec(", ":"), KeySpec("cube", "x³", "∛"), null, null,
            KeySpec("fraction", "a b/c", "d/c"), KeySpec("sqrt", "√"), KeySpec("square", "x²"), KeySpec("power", "^", "x√"), KeySpec("log", "log", "10ˣ"), KeySpec("ln", "ln", "eˣ"),
            KeySpec("negative", "(−)", "", "A"), KeySpec("dms", "° ′ ″", "←", "B"), KeySpec("hyp", "hyp", "", "C"), KeySpec("sin", "sin", "sin⁻¹", "D"), KeySpec("cos", "cos", "cos⁻¹", "E"), KeySpec("tan", "tan", "tan⁻¹", "F"),
            KeySpec("rcl", "RCL", "STO"), KeySpec("eng", "ENG", "←"), KeySpec("open", "(", "", "X"), KeySpec("close", ")", "", "Y"), KeySpec("comma", ",", ";"), KeySpec("mplus", "M+", "M−", "M")
        )
        return createGrid(keys, 6, KeyStyle.FUNCTION)
    }

    private fun createNumberGrid(): View {
        val keys = listOf(
            KeySpec("7", "7", style = KeyStyle.NUMBER), KeySpec("8", "8", style = KeyStyle.NUMBER), KeySpec("9", "9", style = KeyStyle.NUMBER), KeySpec("del", "DEL", "INS", style = KeyStyle.ACTION), KeySpec("ac", "AC", "OFF", style = KeyStyle.ACTION),
            KeySpec("4", "4", style = KeyStyle.NUMBER), KeySpec("5", "5", style = KeyStyle.NUMBER), KeySpec("6", "6", style = KeyStyle.NUMBER), KeySpec("multiply", "×", style = KeyStyle.OPERATOR), KeySpec("divide", "÷", style = KeyStyle.OPERATOR),
            KeySpec("1", "1", "S-SUM", style = KeyStyle.NUMBER), KeySpec("2", "2", "S-VAR", style = KeyStyle.NUMBER), KeySpec("3", "3", "π", style = KeyStyle.NUMBER), KeySpec("plus", "+", style = KeyStyle.OPERATOR), KeySpec("minus", "−", style = KeyStyle.OPERATOR),
            KeySpec("0", "0", "Rnd", style = KeyStyle.NUMBER), KeySpec("decimal", ".", "Ran#", style = KeyStyle.NUMBER), KeySpec("exp", "×10ˣ", style = KeyStyle.NUMBER), KeySpec("ans", "Ans", "DRG▶", style = KeyStyle.NUMBER), KeySpec("equals", "=", style = KeyStyle.ACTION)
        )
        return createGrid(keys, 5, KeyStyle.NUMBER)
    }

    private fun createGrid(keys: List<KeySpec?>, columns: Int, @Suppress("UNUSED_PARAMETER") defaultStyle: KeyStyle): View {
        val grid = GridLayout(this).apply { rowCount = keys.size / columns; columnCount = columns; useDefaultMargins = false }
        keys.forEachIndexed { index, spec ->
            val view = if (spec == null) View(this) else makeKey(spec.key, spec.main, spec.shift, spec.alpha, spec.style,
                if (spec.style == KeyStyle.NUMBER) 22f else 13f)
            val row = index / columns; val col = index % columns
            val lp = GridLayout.LayoutParams(GridLayout.spec(row, 1, 1f), GridLayout.spec(col, 1, 1f)).apply {
                width = 0; height = 0; setMargins(dp(2), dp(3), dp(2), dp(3))
            }
            grid.addView(view, lp)
        }
        return grid
    }

    private fun makeKey(key: String, main: String, shifted: String, alpha: String, style: KeyStyle, mainSize: Float): View {
        val frame = FrameLayout(this)
        val colors = when (style) {
            KeyStyle.NUMBER -> intArrayOf(Color.rgb(61, 64, 65), Color.rgb(124, 128, 129))
            KeyStyle.OPERATOR -> intArrayOf(Color.rgb(76, 79, 80), Color.rgb(142, 145, 146))
            KeyStyle.ACTION -> intArrayOf(Color.rgb(65, 128, 74), Color.rgb(124, 177, 128))
            KeyStyle.NAV -> intArrayOf(Color.rgb(81, 84, 85), Color.rgb(132, 135, 136))
            else -> intArrayOf(Color.rgb(52, 55, 56), Color.rgb(112, 116, 117))
        }
        frame.background = roundedBackground(colors[0], colors[1], dp(8).toFloat())
        frame.isClickable = true; frame.isFocusable = true
        frame.contentDescription = buildString {
            append(main)
            if (shifted.isNotEmpty()) append("; Shift $shifted")
            if (alpha.isNotEmpty()) append("; Alpha $alpha")
        }
        val mainView = TextView(this).apply {
            text = main; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, mainSize)
            gravity = Gravity.CENTER; maxLines = 1; includeFontPadding = false
            setTypeface(Typeface.DEFAULT, if (style == KeyStyle.NUMBER) Typeface.NORMAL else Typeface.NORMAL)
            setPadding(dp(1), dp(3), dp(1), 0)
        }
        frame.addView(mainView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        if (shifted.isNotEmpty()) {
            val label = TextView(this).apply {
                text = shifted; setTextColor(Color.rgb(238, 231, 103)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f)
                setTypeface(Typeface.DEFAULT, Typeface.BOLD); gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL; maxLines = 1
            }
            frame.addView(label, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(14), Gravity.TOP))
        }
        if (alpha.isNotEmpty()) {
            val label = TextView(this).apply {
                text = alpha; setTextColor(Color.rgb(125, 215, 124)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f)
                setTypeface(Typeface.DEFAULT, Typeface.BOLD); gravity = Gravity.TOP or Gravity.END; maxLines = 1
                setPadding(0, dp(1), dp(4), 0)
            }
            frame.addView(label, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(14), Gravity.TOP))
        }
        frame.setOnClickListener { activate(key) }
        return frame
    }

    private fun makeRoundKey(main: String, upper: String, key: String, color: Int, mainSize: Float): View {
        val frame = FrameLayout(this)
        frame.background = roundedBackground(color, Color.rgb(145, 148, 149), dp(10).toFloat())
        frame.isClickable = true; frame.isFocusable = true; frame.contentDescription = main
        val text = TextView(this).apply {
            this.text = main; setTextColor(Color.WHITE); setTextSize(TypedValue.COMPLEX_UNIT_SP, mainSize)
            setTypeface(Typeface.DEFAULT, Typeface.BOLD); gravity = Gravity.CENTER; maxLines = 1
        }
        frame.addView(text, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        if (upper.isNotEmpty()) {
            val label = TextView(this).apply {
                this.text = upper; setTextColor(Color.rgb(238, 231, 103)); setTextSize(TypedValue.COMPLEX_UNIT_SP, 8f)
                setTypeface(Typeface.DEFAULT, Typeface.BOLD); gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
            }
            frame.addView(label, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, dp(14), Gravity.TOP))
        }
        frame.setOnClickListener { activate(key) }
        return frame
    }

    private fun roundedBackground(color: Int, stroke: Int, radius: Float): GradientDrawable = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE; cornerRadius = radius; setColor(color); setStroke(dp(1), stroke)
    }

    private fun activate(key: String) {
        try {
            @Suppress("DEPRECATION")
            if (vibrator?.hasVibrator() == true) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator?.vibrate(VibrationEffect.createOneShot(8L, 40))
                else vibrator?.vibrate(8L)
            }
        } catch (_: Exception) { }
        handler.removeCallbacks(clearMessage)
        handler.removeCallbacks(autoPowerOff)
        engine.press(key)
        render()
        if (engine.display().flags.isNotEmpty()) handler.postDelayed(clearMessage, 1200)
        saveState()
        scheduleAutoPowerOff()
    }

    private fun render() {
        val state = engine.display()
        statusView?.text = buildString {
            append(state.mode)
            if (state.angle.isNotEmpty()) append("   ").append(state.angle)
            if (state.history.isNotEmpty()) append("   ").append(state.history)
            if (state.steps.isNotEmpty()) append("   ").append(state.steps)
            if (state.memory.isNotEmpty()) append("   ").append(state.memory)
            if (state.flags.isNotEmpty()) append("   ").append(state.flags)
        }
        expressionView?.text = state.expression
        resultView?.text = state.result
        val lcdColor = if (state.poweredOn) Color.rgb(170, 181, 153) else Color.rgb(85, 93, 84)
        (expressionView?.parent as? LinearLayout)?.background?.let { drawable ->
            if (drawable is GradientDrawable) drawable.setColor(lcdColor)
        }
        shiftView?.alpha = if (state.shift) 1f else 0.92f
        alphaView?.alpha = if (state.alpha) 1f else 0.92f
        val fg = if (state.poweredOn) Color.rgb(31, 37, 27) else Color.TRANSPARENT
        statusView?.setTextColor(fg); expressionView?.setTextColor(fg); resultView?.setTextColor(fg)
    }

    private fun saveState() {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(STATE, engine.exportState()).apply()
    }

    private fun enterImmersiveFullscreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let { controller ->
                controller.hide(WindowInsets.Type.statusBars() or WindowInsets.Type.navigationBars())
                controller.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION)
        }
    }

    private fun scheduleAutoPowerOff() {
        handler.removeCallbacks(autoPowerOff)
        if (engine.display().poweredOn) handler.postDelayed(autoPowerOff, 10 * 60 * 1000L)
    }

    override fun onResume() { super.onResume(); enterImmersiveFullscreen(); scheduleAutoPowerOff() }
    override fun onWindowFocusChanged(hasFocus: Boolean) { super.onWindowFocusChanged(hasFocus); if (hasFocus) enterImmersiveFullscreen() }
    override fun onPause() { handler.removeCallbacks(autoPowerOff); saveState(); super.onPause() }
    override fun onDestroy() { handler.removeCallbacksAndMessages(null); saveState(); super.onDestroy() }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
            val key = when (event.keyCode) {
                KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER -> "equals"
                KeyEvent.KEYCODE_ESCAPE -> "ac"
                KeyEvent.KEYCODE_DEL, KeyEvent.KEYCODE_FORWARD_DEL -> "del"
                KeyEvent.KEYCODE_DPAD_UP -> "up"; KeyEvent.KEYCODE_DPAD_DOWN -> "down"
                KeyEvent.KEYCODE_DPAD_LEFT -> "left"; KeyEvent.KEYCODE_DPAD_RIGHT -> "right"
                KeyEvent.KEYCODE_SHIFT_LEFT, KeyEvent.KEYCODE_SHIFT_RIGHT -> "shift"
                KeyEvent.KEYCODE_ALT_LEFT, KeyEvent.KEYCODE_ALT_RIGHT -> "alpha"
                KeyEvent.KEYCODE_PLUS -> "plus"; KeyEvent.KEYCODE_MINUS -> "minus"
                KeyEvent.KEYCODE_STAR -> "multiply"; KeyEvent.KEYCODE_SLASH -> "divide"
                KeyEvent.KEYCODE_PERIOD -> "decimal"
                in KeyEvent.KEYCODE_0..KeyEvent.KEYCODE_9 -> (event.keyCode - KeyEvent.KEYCODE_0).toString()
                else -> null
            }
            if (key != null) { activate(key); return true }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private companion object {
        const val PREFS = "fx82ms-native"
        const val STATE = "calculator-state-v1"
    }
}
