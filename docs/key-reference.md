# fx-82MS key behavior reference

This reference follows the key markings and operation groups in the [Casio fx-82MS 2nd-edition User's Guide](https://support.casio.com/global/en/calc/manual/fx-82MS_85MS_220PLUS_300MS_350MS_en/). It describes the controls present in this app; menu option numbers are shown on the LCD.

## Modifiers, mode and navigation

| Key | Normal action | With SHIFT / ALPHA |
| --- | --- | --- |
| `SHIFT` | Arm the yellow function printed above a key; one-shot | A second tap cancels it |
| `ALPHA` | Arm the green variable printed above a key; one-shot | A second tap cancels it |
| `MODE` | Opens `COMP / SD / REG`; repeated MODE taps advance through angle, `Fix/Sci/Norm`, fraction and `Disp` setup | `CLR`: `Mcl / Mode / All` |
| `ON` | Wake the calculator | — |
| Replay `▲` / `▼` | COMP: previous / next history entry; SD/REG: browse retained data | — |
| Replay `◀` / `▶` | Move the insertion cursor | — |

Setup screens accept the displayed number. `Fix` asks for 0–9 decimal places; `Sci` accepts 1–10 significant digits (press `=` after a single-digit value, or enter both digits for 10); `Norm` asks for 1 or 2. The `Disp` screen selects decimal dot or comma. `SHIFT` + `AC` powers off; the calculator also auto-powers off after about 10 minutes of inactivity.

## Scientific-function keys

| Key | Normal action | SHIFT action | ALPHA action |
| --- | --- | --- | --- |
| `x⁻¹` | Reciprocal | Factorial `x!` | — |
| `nCr` | Combination | Permutation `nPr` | — |
| `Pol(` | Rectangular → polar; result components are saved to E and F | `Rec(`, polar → rectangular; result components are saved to E and F | — |
| `x³` | Cube | Cube root | — |
| `a b/c` | Enter a fraction separator; on a displayed result, toggle fraction/decimal | Toggle mixed/improper display | — |
| `√` | Square root | — | — |
| `x²` | Square | — | — |
| `^` | Power | x-th root | — |
| `log` | Common logarithm | 10ˣ | — |
| `ln` | Natural logarithm | eˣ | — |
| `(−)` | Sign change / unary negative | — | A |
| `° ′ ″` | Enter DMS degree/minute/second marks in sequence; on a result, show DMS | — | B |
| `hyp` | Toggle hyperbolic mode for the next trig key | — | C |
| `sin` | Sine, or sinh while HYP is active | asin, or asinh with HYP | D |
| `cos` | Cosine, or cosh while HYP is active | acos, or acosh with HYP | E |
| `tan` | Tangent, or tanh while HYP is active | atan, or atanh with HYP | F |
| `RCL` | Recall a memory variable | Store to a memory variable | — |
| `ENG` | Engineering notation; repeated taps shift the exponent in groups of three | Move cursor left | — |
| `(` | Open parenthesis | — | X |
| `)` | Close parenthesis | — | Y |
| `,` | Separate coordinate or regression inputs | — | — |
| `M+` | COMP: add to independent M; SD/REG: register data (DT) | COMP: subtract from M; SD/REG: delete the current/last data item | M variable |

`Pol(x,y)` and `Rec(r,θ)` use the selected angle unit. Their two displayed outputs are saved in E and F, as on the fx-82MS family.

## Number, editing and arithmetic keys

| Key | Normal action | SHIFT action |
| --- | --- | --- |
| `0`–`9` | Enter the digit | `1`: S-SUM; `2`: S-VAR; `3`: π; `0`: Rnd |
| `.` | Decimal point | — |
| `×10ˣ` | Enter an exponent of ten | Ran# (0.000–0.999) |
| `Ans` | Insert answer memory | DRG▶: convert the displayed angle to Deg/Rad/Gra |
| `=` | Evaluate in COMP; register data (DT) in SD/REG | Percent postfix |
| `+`, `−`, `×`, `÷` | Arithmetic operators | — |
| `DEL` | Delete before the cursor | Toggle insert/overwrite mode |
| `AC` | Clear the current entry | OFF |

## Statistical modes

- `MODE → 2` selects SD; `MODE → 3` selects REG. REG offers linear, logarithmic, exponential, power, inverse and quadratic regression. Pwr/Inv/Quad can be selected with `SHIFT` + `1/2/3` (the LCD also lists them as 4/5/6).
- In SD/REG, enter a value and press `M+` to register it (DT); in REG, separate `x` and `y` with the comma key. A semicolon and frequency can be appended, such as `12;4`. Pressing `M+` with a blank entry repeats the last datum. `=` evaluates an entered expression without recording it; when editing a browsed item, `=` commits the replacement.
- `SHIFT` + `M+` deletes the browsed item (or the last item when none is browsed). `▲` / `▼` browse data while individual records are available. Use AC to leave data browsing before calculations or statistics menus.
- `SHIFT` + `1` (S-SUM) recalls sums and count. SD offers Σx², Σx and n; REG also offers Σy², Σy and Σxy. Quadratic REG exposes the additional Σx³, Σx²y and Σx⁴ items on its More screen.
- `SHIFT` + `2` (S-VAR) recalls means and population/sample standard deviations. REG also exposes regression coefficients, correlation/prediction values, and quadratic C, ŷ, x̂₁ and x̂₂ on its More screen.
- App data-capacity handling: after 80 retained input records, `DATA FULL` appears. Press `AC`, then choose `1` to cancel or `2` to continue registering while disabling individual-record browsing/editing; statistical calculations remain available. The app caps the live data table at 10,000 input records (including the first 80). Changing mode or regression type clears the data set.

## Haptics

Every on-screen key tap triggers a subtle 8 ms vibration when the device supports it. The native Kotlin Android app uses Android's `Vibrator` API; the separate browser/PWA uses `navigator.vibrate`.

## Automated coverage

Run the browser/PWA regression checks and the native Kotlin engine unit tests from the repository root:

```sh
node tests/calculator.test.js
gradle :app:testDebugUnitTest
```

The Node suite covers the separate PWA. The Kotlin tests exercise the Android engine's arithmetic, scientific keys, angle modes, fractions, DMS, memory, SD statistics, regression families, persistence, errors and power state.
