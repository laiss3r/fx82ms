package com.arena.fx82ms

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CalculatorEngineTest {
    private fun run(vararg keys: String): CalculatorEngine {
        val engine = CalculatorEngine()
        keys.forEach(engine::press)
        return engine
    }

    private fun enter(engine: CalculatorEngine, value: String) {
        value.forEach { c -> engine.press(if (c == '.') "decimal" else if (c == '-') "negative" else c.toString()) }
    }

    private fun number(engine: CalculatorEngine): Double = engine.display().result.replace(",", "").replace("−", "-").toDouble()

    @Test fun precedenceUnaryMinusAndImplicitMultiplication() {
        var e = run("2", "plus", "3", "multiply", "4", "equals")
        assertEquals("14", e.display().result)
        e = run("negative", "2", "power", "4", "equals")
        assertEquals("−16", e.display().result)
        e = run("2", "open", "3", "plus", "4", "close", "equals")
        assertEquals("14", e.display().result)
    }

    @Test fun scientificFunctionsAndAngleMode() {
        var e = run("sin", "3", "0", "equals")
        assertEquals(0.5, number(e), 1e-10)
        e = run("sqrt", "9", "equals")
        assertEquals("3", e.display().result)
        e = run("mode", "mode", "2", "sin", "1", "equals")
        assertEquals("RAD", e.display().angle)
        assertEquals(kotlin.math.sin(1.0), number(e), 1e-10)
    }

    @Test fun exactFractionPercentAndDms() {
        var e = run("1", "fraction", "2", "equals")
        assertEquals("1/2", e.display().result)
        e.press("fraction"); assertEquals("0.5", e.display().result)
        e = run("1", "5", "0", "0", "multiply", "1", "2", "shift", "equals", "equals")
        assertEquals("180", e.display().result)
        e = run("1", "2", "dms", "3", "4", "dms", "5", "6", "dms", "equals")
        assertEquals(12 + 34.0 / 60 + 56.0 / 3600, number(e), 1e-7)
    }

    @Test fun memoryVariablesAndStatePersistence() {
        var e = run("7", "shift", "rcl", "negative")
        e.press("ac"); e.press("rcl"); e.press("negative"); e.press("equals")
        assertEquals("7", e.display().result)
        e = run("5", "mplus")
        assertEquals("M", e.display().memory)
        val restored = CalculatorEngine().also { it.importState(e.exportState()) }
        assertEquals("M", restored.display().memory)
        restored.press("ac"); restored.press("rcl"); restored.press("mplus"); restored.press("equals")
        assertEquals("5", restored.display().result)
    }

    @Test fun standardDeviationAndRegression() {
        val sd = run("mode", "2", "2", "mplus", "4", "mplus", "mplus", "shift", "2", "1")
        assertEquals(10.0 / 3.0, number(sd), 1e-8)
        val reg = run("mode", "3", "1", "1", "comma", "3", "mplus", "2", "comma", "5", "mplus", "shift", "2", "7")
        assertEquals("1", reg.display().result)
        reg.press("ac"); reg.press("3"); reg.press("shift"); reg.press("2"); reg.press("0"); reg.press("3");
        assertEquals("7", reg.display().result)
    }

    @Test fun alternateScientificFunctionsAndCoordinateConversion() {
        var e = run("5", "shift", "inverse", "equals")
        assertEquals("120", e.display().result)
        e = run("5", "ncr", "2", "equals")
        assertEquals("10", e.display().result)
        e = run("5", "shift", "ncr", "2", "equals")
        assertEquals("20", e.display().result)
        e = run("1", "5", "0", "0", "plus", "1", "5", "shift", "equals", "equals")
        assertEquals("1,725", e.display().result)
        e = run("polar", "3", "comma", "4", "close", "equals")
        assertTrue(e.display().result.startsWith("5;"))
        e.press("ac"); e.press("alpha"); e.press("cos"); e.press("equals")
        assertEquals("5", e.display().result)
        e = run("shift", "polar", "2", "comma", "6", "0", "close", "equals")
        assertEquals(1.0, e.display().result.substringBefore(';').toDouble(), 1e-8)
    }

    @Test fun eachRegressionFamilyCanFitAndEstimate() {
        fun newRegression(type: Int): CalculatorEngine {
            val e = CalculatorEngine()
            e.press("mode"); e.press("3")
            if (type <= 3) e.press(type.toString()) else { e.press("shift"); e.press((type - 3).toString()) }
            return e
        }
        fun pair(e: CalculatorEngine, x: String, y: String) {
            enter(e, x); e.press("comma"); enter(e, y); e.press("mplus")
        }
        var e = newRegression(1); pair(e, "1", "3"); pair(e, "2", "5")
        enter(e, "3"); e.press("shift"); e.press("2"); e.press("0"); e.press("3")
        assertEquals("7", e.display().result)

        e = newRegression(2); pair(e, "1", "1"); pair(e, "10", "3")
        e.press("shift"); e.press("2"); e.press("7")
        assertEquals("1", e.display().result)

        e = newRegression(3); pair(e, "0", "1"); pair(e, "1", "2")
        enter(e, "2"); e.press("shift"); e.press("2"); e.press("0"); e.press("3")
        assertEquals("4", e.display().result)

        e = newRegression(4); pair(e, "1", "3"); pair(e, "2", "12")
        enter(e, "27"); e.press("shift"); e.press("2"); e.press("0"); e.press("2")
        assertEquals("3", e.display().result)

        e = newRegression(5); pair(e, "1", "3"); pair(e, "2", "2")
        enter(e, "1.5"); e.press("shift"); e.press("2"); e.press("0"); e.press("2")
        assertEquals("4", e.display().result)

        e = newRegression(6); pair(e, "0", "1"); pair(e, "1", "4"); pair(e, "2", "9")
        enter(e, "3"); e.press("shift"); e.press("2"); e.press("0"); e.press("2")
        assertEquals("16", e.display().result)
    }

    @Test fun displaySetupAndDmsResultFormatting() {
        val e = run("mode", "mode", "mode", "1", "2", "equals")
        e.press("1"); e.press("divide"); e.press("3"); e.press("shift"); e.press("0")
        assertEquals("0.33", e.display().result)
        assertTrue(e.display().flags.contains("FIX 2"))
        e.press("ac"); e.press("2"); e.press("decimal"); e.press("2"); e.press("5"); e.press("8"); e.press("equals")
        e.press("shift"); e.press("dms")
        assertEquals("2° 15′ 28.8″", e.display().result)
        e.press("dms"); assertEquals("2.26", e.display().result)
    }

    @Test fun errorsRecoverAndAppIsPoweredOn() {
        var e = run("1", "divide", "0", "equals")
        assertEquals("Math ERROR", e.display().result)
        e.press("ac"); e.press("4"); e.press("equals")
        assertEquals("4", e.display().result)
        e.press("shift"); e.press("ac")
        assertEquals(false, e.display().poweredOn)
        e.press("on"); assertTrue(e.display().poweredOn)
    }
}
