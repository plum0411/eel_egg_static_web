# Japanese Eel Egg Diameter Analyzer — Static Web

這一版是依照實際提供的兩種影像更新：

- 校正圖：網格／血球計數盤，不再假設有藍色校正圓。
- 卵圖：淡黃背景、深色圓形卵、含大量小碎屑。

## 核心改動

### 1. 校正改為「兩點網格尺校正」

上傳校正圖後：

1. 點第一條已知刻度線。
2. 點第二條已知刻度線。
3. 輸入這兩點之間的真實距離。
4. 程式計算：

```text
pixels_per_unit = pixel_distance / real_distance
```

這比針對特定顏色做 HSV calibration 更適合目前的網格圖。

建議跨多個小格測量，例如若每小格為 50 µm：
- 跨 1 格：輸入 50
- 跨 4 格：輸入 200
- 跨 10 格：輸入 500

跨更多格通常可以降低滑鼠點選誤差。

**請依你的血球計數盤／stage micrometer 真實規格填入距離，不能只從照片猜實際 µm。**

### 2. 針對目前卵圖調整預設 segmentation

預設改為：

```text
Minimum area = 150 px²
Minimum circularity = 0.45
Peak distance = 8 px
Gaussian kernel = 5
Morphology kernel = 5
Opening = 1 iteration
Closing = 1 iteration
Exclude border objects = ON
```

理由：
- 原本 60 px² 對目前影像容易留下大量小碎屑。
- Opening/Closing 原本各 2 次，對底部密集卵群較容易改變形狀或合併，因此先降為 1。
- 碰到邊界的物件預設排除，避免半顆卵造成 ECD 低估。

## 如何執行

本機：

```bash
cd eel_egg_static_web
python3 -m http.server 8000
```

瀏覽器開：

```text
http://localhost:8000
```

## 操作順序

1. 上傳校正圖。
2. 在校正圖點兩個刻度位置。
3. 輸入兩點間真實距離與單位。
4. 上傳一張或多張卵巢圖片。
5. 按「開始分析」。
6. 檢查 Segmentation QC 預覽。
7. 下載個別 CSV / PNG，或「下載全部結果 ZIP」。

## 輸出

- `calibration_measurement.csv`
- `calibration_selected_points.png`
- `all_diameters.csv`
- `summary_per_image.csv`
- `segmentation_qc.csv`
- `individual_probability_distributions*.png`
- `total_probability_distribution.png`
- `total_probability_distribution_stats.csv`
- 每張圖的 `*_analysis.png`
- `analysis_metadata.json`

## GitHub Pages

把以下檔案放在 repository 根目錄：

```text
index.html
styles.css
app.js
.nojekyll
```

然後：

```text
Repository → Settings → Pages
Source: Deploy from a branch
Branch: main
Folder: / (root)
```

即可成為公開靜態網站。

## 重要研究限制

本工具的主直徑是：

```text
Equivalent Circular Diameter (ECD)
ECD = 2 × sqrt(area / pi)
```

正式分析前仍應人工抽查：
- 是否把一顆卵切成兩顆；
- 是否把兩顆重疊卵合併；
- 是否把深色碎屑誤認為卵；
- 校正兩點是否落在正確刻度；
- 校正圖與樣本圖是否為相同倍率與攝影設定。
# eel_egg_static_web
# eel_egg_static_web
# eel_egg_static_web
