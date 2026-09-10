/* Japanese Eel Egg Diameter Analyzer
 * Static browser app, calibrated with a grid/ruler image by two clicks.
 */
"use strict";

const state = {
  cvReady: false,
  outputFiles: new Map(),
  objectUrls: [],
  results: [],
  calibrationSourceCanvas: null,
  calibrationPoints: [],
  calibration: null,
};

const $ = id => document.getElementById(id);
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

function setStatus(text, cls="loading") {
  const el = $("cvStatus");
  el.textContent = text;
  el.className = `status ${cls}`;
}
function setProgress(value, text) {
  $("progress").value = Math.max(0, Math.min(100, value));
  $("progressText").textContent = text;
}

async function waitForOpenCv() {
  for (let i=0; i<300; i++) {
    try {
      if (typeof window.cv !== "undefined") {
        if (window.cv instanceof Promise) window.cv = await window.cv;
        if (window.cv && typeof window.cv.Mat === "function") {
          state.cvReady = true;
          setStatus("OpenCV.js 已就緒", "ready");
          updateAnalyzeButton();
          return;
        }
      }
    } catch (err) { console.error(err); }
    await new Promise(r => setTimeout(r,100));
  }
  setStatus("OpenCV.js 載入失敗", "error");
}

window.addEventListener("DOMContentLoaded", () => {
  waitForOpenCv();
  $("calibrationFile").addEventListener("change", loadCalibrationPicker);
  $("calibrationPicker").addEventListener("click", onCalibrationCanvasClick);
  $("clearPointsBtn").addEventListener("click", clearCalibrationPoints);
  $("knownDistance").addEventListener("input", updateCalibrationInfo);
  $("unitLabel").addEventListener("input", updateCalibrationInfo);
  $("sampleFiles").addEventListener("change", updateAnalyzeButton);
  $("analyzeBtn").addEventListener("click", runAnalysis);
  $("resetBtn").addEventListener("click", resetResults);
  $("downloadZipBtn").addEventListener("click", downloadAllZip);
});

function updateAnalyzeButton() {
  const ready = state.cvReady &&
    $("sampleFiles").files.length > 0 &&
    state.calibrationSourceCanvas &&
    state.calibrationPoints.length === 2 &&
    Number($("knownDistance").value) > 0;
  $("analyzeBtn").disabled = !ready;
}

async function fileToCanvas(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d", {willReadFrequently:true}).drawImage(bitmap,0,0);
  bitmap.close();
  return canvas;
}

async function loadCalibrationPicker() {
  clearCalibrationPoints();
  const file = $("calibrationFile").files[0];
  if (!file) {
    state.calibrationSourceCanvas = null;
    $("calibrationPickerWrap").classList.add("hidden");
    updateAnalyzeButton();
    return;
  }
  try {
    state.calibrationSourceCanvas = await fileToCanvas(file);
    $("calibrationPickerWrap").classList.remove("hidden");
    drawCalibrationPicker();
    updateCalibrationInfo();
  } catch (err) {
    alert(`校正圖讀取失敗：${err.message || err}`);
  }
  updateAnalyzeButton();
}

function onCalibrationCanvasClick(ev) {
  if (!state.calibrationSourceCanvas) return;
  const canvas = $("calibrationPicker");
  const rect = canvas.getBoundingClientRect();
  const x = (ev.clientX - rect.left) * canvas.width / rect.width;
  const y = (ev.clientY - rect.top) * canvas.height / rect.height;

  if (state.calibrationPoints.length >= 2) state.calibrationPoints = [];
  state.calibrationPoints.push({x,y});
  drawCalibrationPicker();
  updateCalibrationInfo();
  updateAnalyzeButton();
}

function clearCalibrationPoints() {
  state.calibrationPoints = [];
  if (state.calibrationSourceCanvas) drawCalibrationPicker();
  updateCalibrationInfo();
  updateAnalyzeButton();
}

function drawCalibrationPicker() {
  if (!state.calibrationSourceCanvas) return;
  const canvas = $("calibrationPicker");
  canvas.width = state.calibrationSourceCanvas.width;
  canvas.height = state.calibrationSourceCanvas.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(state.calibrationSourceCanvas,0,0);

  const pts = state.calibrationPoints;
  ctx.save();
  ctx.lineWidth = Math.max(3, canvas.width/500);
  ctx.strokeStyle = "#ff2d2d";
  ctx.fillStyle = "#ff2d2d";

  if (pts.length === 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x,pts[0].y);
    ctx.lineTo(pts[1].x,pts[1].y);
    ctx.stroke();
  }
  pts.forEach((p,i) => {
    ctx.beginPath();
    ctx.arc(p.x,p.y,Math.max(7,canvas.width/180),0,Math.PI*2);
    ctx.fill();
    ctx.font = `700 ${Math.max(16,canvas.width/80)}px sans-serif`;
    ctx.fillText(String(i+1),p.x+12,p.y-12);
  });
  ctx.restore();
}

function calibrationPixelDistance() {
  if (state.calibrationPoints.length !== 2) return null;
  const [a,b] = state.calibrationPoints;
  return Math.hypot(b.x-a.x,b.y-a.y);
}

function updateCalibrationInfo() {
  const px = calibrationPixelDistance();
  const real = Number($("knownDistance").value);
  const unit = $("unitLabel").value.trim() || "um";
  let text = `${state.calibrationPoints.length}/2 點`;
  if (px) {
    text += ` · pixel distance = ${px.toFixed(2)} px`;
    if (real > 0) text += ` · ${ (px/real).toFixed(5) } px/${unit}`;
  }
  $("calibrationClickInfo").textContent = text;
}

function resetResults() {
  for (const url of state.objectUrls) URL.revokeObjectURL(url);
  state.objectUrls = [];
  state.outputFiles.clear();
  state.results = [];
  state.calibration = null;
  $("calibrationSection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
  $("previewSection").classList.add("hidden");
  $("downloads").innerHTML = "";
  $("previews").innerHTML = "";
  $("summaryTable").querySelector("tbody").innerHTML = "";
  $("downloadZipBtn").disabled = true;
  setProgress(0,"等待資料");
}

function readConfig() {
  const unit = $("unitLabel").value.trim() || "um";
  const realDistance = Number($("knownDistance").value);
  if (!(realDistance > 0)) throw new Error("校正實際距離必須 > 0。");
  const pxDistance = calibrationPixelDistance();
  if (!(pxDistance > 0)) throw new Error("請在校正圖上點選兩個刻度位置。");

  const kdeInput = $("kdeBandwidth").value.trim();
  const peakRealInput = $("minPeakDistanceReal").value.trim();
  const g = Number($("gaussianKernel").value);
  if (!Number.isInteger(g) || g < 1 || g % 2 === 0) {
    throw new Error("Gaussian kernel 必須是正奇數，例如 3、5、7。");
  }

  return {
    unit,
    realDistance,
    pixelDistance: pxDistance,
    pixelsPerUnit: pxDistance / realDistance,
    minArea: Number($("minArea").value),
    minCircularity: Number($("minCircularity").value),
    excludeBorder: $("excludeBorder").checked,
    minPeakDistancePx: Number($("minPeakDistancePx").value),
    minPeakDistanceReal: peakRealInput === "" ? null : Number(peakRealInput),
    gaussianKernel: g,
    morphKernel: Number($("morphKernel").value),
    openIterations: Number($("openIterations").value),
    closeIterations: Number($("closeIterations").value),
    kdeBandwidth: kdeInput === "" ? null : Number(kdeInput),
  };
}

function buildCalibration(cfg) {
  const [a,b] = state.calibrationPoints;
  const points = [{
    x1_px: a.x, y1_px: a.y,
    x2_px: b.x, y2_px: b.y,
    pixel_distance_px: cfg.pixelDistance,
    [`known_distance_${cfg.unit}`]: cfg.realDistance,
    [`pixels_per_${cfg.unit}`]: cfg.pixelsPerUnit,
  }];

  const resultCanvas = document.createElement("canvas");
  resultCanvas.width = state.calibrationSourceCanvas.width;
  resultCanvas.height = state.calibrationSourceCanvas.height;
  const ctx = resultCanvas.getContext("2d");
  ctx.drawImage(state.calibrationSourceCanvas,0,0);
  ctx.save();
  ctx.strokeStyle = "#ff0000";
  ctx.fillStyle = "#ff0000";
  ctx.lineWidth = Math.max(4,resultCanvas.width/450);
  ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke();
  [a,b].forEach(p => {
    ctx.beginPath(); ctx.arc(p.x,p.y,Math.max(8,resultCanvas.width/170),0,Math.PI*2); ctx.fill();
  });
  ctx.restore();

  return {
    method: "two-point grid/ruler calibration",
    pixelsPerUnit: cfg.pixelsPerUnit,
    pixelDistance: cfg.pixelDistance,
    realDistance: cfg.realDistance,
    points,
    resultCanvas,
  };
}

function mean(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : NaN; }
function std(a){
  if(!a.length) return NaN;
  const m=mean(a);
  return Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/a.length);
}
function quantile(a,q){
  if(!a.length) return NaN;
  const s=[...a].sort((x,y)=>x-y);
  const p=(s.length-1)*q, lo=Math.floor(p), hi=Math.ceil(p);
  return lo===hi ? s[lo] : s[lo]*(hi-p)+s[hi]*(p-lo);
}
function median(a){ return quantile(a,.5); }
function summarize(a){
  if(!a.length) return {count:0,mean:NaN,median:NaN,std:NaN,q1:NaN,q3:NaN,min:NaN,max:NaN,cv:NaN};
  const m=mean(a), sd=std(a);
  return {
    count:a.length, mean:m, median:median(a), std:sd,
    q1:quantile(a,.25), q3:quantile(a,.75),
    min:Math.min(...a), max:Math.max(...a), cv:m!==0?sd/m:NaN
  };
}
function silvermanBandwidth(samples){
  if(samples.length<2) return null;
  const sd=std(samples), iqr=quantile(samples,.75)-quantile(samples,.25);
  const sigma=iqr>0?Math.min(sd,iqr/1.349):sd;
  if(!Number.isFinite(sigma)||sigma<=1e-12) return null;
  const h=.9*sigma*Math.pow(samples.length,-.2);
  return h>0?h:null;
}
function kde(samples,xs,bw){
  if(!bw||samples.length<2) return null;
  const maxN=30000;
  let used=samples;
  if(samples.length>maxN){
    const step=samples.length/maxN;
    used=Array.from({length:maxN},(_,i)=>samples[Math.floor(i*step)]);
  }
  const norm=1/(Math.sqrt(2*Math.PI)*bw*used.length);
  return xs.map(x=>{
    let s=0;
    for(const v of used){
      const z=(x-v)/bw;
      s+=Math.exp(-.5*z*z);
    }
    return s*norm;
  });
}
function niceNumber(v){
  if(!Number.isFinite(v)) return "—";
  if(Math.abs(v)>=1000) return v.toFixed(1);
  if(Math.abs(v)>=10) return v.toFixed(2);
  return v.toFixed(3);
}

function labelPeakComponents(peakData, rows, cols, markerData){
  let nextLabel=2;
  const queue=[];
  for(let idx=0;idx<peakData.length;idx++){
    if(peakData[idx]===0||markerData[idx]!==0) continue;
    const label=nextLabel++;
    markerData[idx]=label;
    queue.length=0; queue.push(idx);
    for(let q=0;q<queue.length;q++){
      const p=queue[q], y=Math.floor(p/cols), x=p-y*cols;
      for(let dy=-1;dy<=1;dy++){
        const ny=y+dy; if(ny<0||ny>=rows) continue;
        for(let dx=-1;dx<=1;dx++){
          if(dx===0&&dy===0) continue;
          const nx=x+dx; if(nx<0||nx>=cols) continue;
          const ni=ny*cols+nx;
          if(peakData[ni]!==0&&markerData[ni]===0){
            markerData[ni]=label; queue.push(ni);
          }
        }
      }
    }
  }
  return nextLabel-2;
}

async function analyzeImage(file,pixelsPerUnit,cfg){
  const sourceCanvas=await fileToCanvas(file);
  const src=cv.imread(sourceCanvas);
  const rgb=new cv.Mat(), gray=new cv.Mat(), blur=new cv.Mat();
  const binary=new cv.Mat(), opened=new cv.Mat(), closed=new cv.Mat();
  const distance=new cv.Mat(), dilated=new cv.Mat(), peaks=new cv.Mat();
  let morphKernel=null, peakKernel=null, markers=null;

  try{
    cv.cvtColor(src,rgb,cv.COLOR_RGBA2RGB);
    cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray,blur,new cv.Size(cfg.gaussianKernel,cfg.gaussianKernel),0,0,cv.BORDER_DEFAULT);
    cv.threshold(blur,binary,0,255,cv.THRESH_BINARY_INV+cv.THRESH_OTSU);

    const mk=Math.max(1,Math.round(cfg.morphKernel));
    morphKernel=cv.getStructuringElement(cv.MORPH_ELLIPSE,new cv.Size(mk,mk));
    cv.morphologyEx(binary,opened,cv.MORPH_OPEN,morphKernel,new cv.Point(-1,-1),cfg.openIterations);
    cv.morphologyEx(opened,closed,cv.MORPH_CLOSE,morphKernel,new cv.Point(-1,-1),cfg.closeIterations);

    cv.distanceTransform(closed,distance,cv.DIST_L2,5);
    const minDistancePx=cfg.minPeakDistanceReal!==null
      ? Math.max(1,Math.round(cfg.minPeakDistanceReal*pixelsPerUnit))
      : Math.max(1,Math.round(cfg.minPeakDistancePx));

    let peakKernelSize=Math.min(255,2*minDistancePx+1);
    peakKernel=cv.Mat.ones(peakKernelSize,peakKernelSize,cv.CV_8U);
    cv.dilate(distance,dilated,peakKernel);
    cv.compare(distance,dilated,peaks,cv.CMP_GE);
    cv.bitwise_and(peaks,closed,peaks);

    markers=new cv.Mat(closed.rows,closed.cols,cv.CV_32S);
    markers.setTo(new cv.Scalar(0));
    const closedData=closed.data, markerData=markers.data32S;
    for(let i=0;i<closedData.length;i++) if(closedData[i]===0) markerData[i]=1;

    const nSeeds=labelPeakComponents(peaks.data,closed.rows,closed.cols,markerData);
    if(nSeeds===0) return makeEmptyAnalysis(file.name,sourceCanvas,minDistancePx);

    cv.watershed(rgb,markers);

    const rows=closed.rows, cols=closed.cols, labels=markers.data32S;
    const stats=new Map();

    for(let y=0;y<rows;y++){
      const base=y*cols;
      for(let x=0;x<cols;x++){
        const idx=base+x;
        if(closedData[idx]===0) continue;
        const label=labels[idx];
        if(label<2) continue;
        let s=stats.get(label);
        if(!s){
          s={label,area:0,perimeter:0,minX:cols,maxX:-1,minY:rows,maxY:-1,
             sumX:0,sumY:0,sumX2:0,sumY2:0,sumXY:0,touchingBorder:false};
          stats.set(label,s);
        }
        s.area++;
        s.minX=Math.min(s.minX,x); s.maxX=Math.max(s.maxX,x);
        s.minY=Math.min(s.minY,y); s.maxY=Math.max(s.maxY,y);
        s.sumX+=x; s.sumY+=y; s.sumX2+=x*x; s.sumY2+=y*y; s.sumXY+=x*y;
        if(x===0||x===cols-1||y===0||y===rows-1) s.touchingBorder=true;
      }
    }

    for(let y=0;y<rows;y++){
      const base=y*cols;
      for(let x=0;x<cols;x++){
        const idx=base+x;
        if(closedData[idx]===0) continue;
        const label=labels[idx]; if(label<2) continue;
        const s=stats.get(label); if(!s) continue;
        if(y===0||labels[idx-cols]!==label||closedData[idx-cols]===0) s.perimeter++;
        if(y===rows-1||labels[idx+cols]!==label||closedData[idx+cols]===0) s.perimeter++;
        if(x===0||labels[idx-1]!==label||closedData[idx-1]===0) s.perimeter++;
        if(x===cols-1||labels[idx+1]!==label||closedData[idx+1]===0) s.perimeter++;
      }
    }

    const objects=[], keptLabels=new Set();
    for(const s of stats.values()){
      const area=s.area, perimeter=Math.max(s.perimeter,1e-9);
      const circularity=4*Math.PI*area/(perimeter*perimeter);
      const dPx=2*Math.sqrt(area/Math.PI);
      const dReal=dPx/pixelsPerUnit;

      const cx=s.sumX/area, cy=s.sumY/area;
      const varX=Math.max(0,s.sumX2/area-cx*cx);
      const varY=Math.max(0,s.sumY2/area-cy*cy);
      const cov=s.sumXY/area-cx*cy;
      const tr=varX+varY;
      const disc=Math.sqrt(Math.max(0,((varX-varY)**2)/4+cov**2));
      const l1=Math.max(0,tr/2+disc), l2=Math.max(0,tr/2-disc);
      const eccentricity=l1>0?Math.sqrt(Math.max(0,1-l2/l1)):0;

      const reasons=[];
      if(area<cfg.minArea) reasons.push("area");
      if(circularity<cfg.minCircularity) reasons.push("circularity");
      if(cfg.excludeBorder&&s.touchingBorder) reasons.push("border");

      const kept=reasons.length===0;
      if(kept) keptLabels.add(s.label);

      objects.push({
        object_id:s.label, kept, rejection_reason:reasons.join(";"),
        area_px2:area, equivalent_diameter_px:dPx,
        [`area_${cfg.unit}2`]:area/(pixelsPerUnit*pixelsPerUnit),
        [`equivalent_diameter_${cfg.unit}`]:dReal,
        [`major_axis_${cfg.unit}`]:(4*Math.sqrt(l1))/pixelsPerUnit,
        [`minor_axis_${cfg.unit}`]:(4*Math.sqrt(l2))/pixelsPerUnit,
        circularity, eccentricity, touching_border:s.touchingBorder
      });
    }

    const diameters=objects.filter(o=>o.kept).map(o=>o[`equivalent_diameter_${cfg.unit}`]);
    const overlayCanvas=createOverlayCanvas(sourceCanvas,closedData,labels,rows,cols,keptLabels);
    const sourceThumb=cloneScaledCanvas(sourceCanvas);
    const overlayThumb=cloneScaledCanvas(overlayCanvas);

    return {
      filename:file.name, diameters, objects,
      minPeakDistancePxUsed:minDistancePx,
      sourcePreviewUrl:sourceThumb.toDataURL("image/jpeg",.88),
      overlayPreviewUrl:overlayThumb.toDataURL("image/png")
    };
  } finally {
    src.delete();rgb.delete();gray.delete();blur.delete();binary.delete();
    opened.delete();closed.delete();distance.delete();dilated.delete();peaks.delete();
    if(morphKernel)morphKernel.delete();
    if(peakKernel)peakKernel.delete();
    if(markers)markers.delete();
  }
}

function makeEmptyAnalysis(filename,sourceCanvas,minDistancePx){
  const thumb=cloneScaledCanvas(sourceCanvas);
  return {
    filename,diameters:[],objects:[],minPeakDistancePxUsed:minDistancePx,
    sourcePreviewUrl:thumb.toDataURL("image/jpeg",.88),
    overlayPreviewUrl:thumb.toDataURL("image/jpeg",.88)
  };
}

function cloneScaledCanvas(source,maxW=900,maxH=650){
  const scale=Math.min(1,maxW/source.width,maxH/source.height);
  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(source.width*scale));
  c.height=Math.max(1,Math.round(source.height*scale));
  c.getContext("2d").drawImage(source,0,0,c.width,c.height);
  return c;
}

function createOverlayCanvas(sourceCanvas,closedData,labels,rows,cols,keptLabels){
  const out=document.createElement("canvas");
  out.width=sourceCanvas.width; out.height=sourceCanvas.height;
  const ctx=out.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(sourceCanvas,0,0);
  const img=ctx.getImageData(0,0,out.width,out.height), rgba=img.data;

  function isBoundary(idx,x,y,label){
    if(y===0||y===rows-1||x===0||x===cols-1)return true;
    return labels[idx-cols]!==label||labels[idx+cols]!==label||
           labels[idx-1]!==label||labels[idx+1]!==label;
  }

  for(let y=0;y<rows;y++){
    const base=y*cols;
    for(let x=0;x<cols;x++){
      const idx=base+x, label=labels[idx];
      let color=null;
      if(label===-1&&closedData[idx]!==0) color=[255,220,0];
      else if(label>=2&&keptLabels.has(label)&&closedData[idx]!==0&&isBoundary(idx,x,y,label))
        color=[255,0,0];
      if(color){
        const p=idx*4;
        rgba[p]=color[0];rgba[p+1]=color[1];rgba[p+2]=color[2];rgba[p+3]=255;
      }
    }
  }
  ctx.putImageData(img,0,0);
  return out;
}

function canvasToBlob(canvas,type="image/png",quality=.92){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(b=>b?resolve(b):reject(new Error("Canvas 匯出失敗")),type,quality);
  });
}
function escapeCsv(v){
  if(v===null||v===undefined)return "";
  const s=String(v);
  return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s;
}
function rowsToCsv(rows,columns=null){
  if(!rows.length&&!columns)return "";
  const cols=columns||Object.keys(rows[0]);
  const lines=[cols.map(escapeCsv).join(",")];
  for(const r of rows)lines.push(cols.map(c=>escapeCsv(r[c])).join(","));
  return "\uFEFF"+lines.join("\n");
}
function csvBlob(rows,columns=null){ return new Blob([rowsToCsv(rows,columns)],{type:"text/csv;charset=utf-8"}); }
function jsonBlob(obj){ return new Blob([JSON.stringify(obj,null,2)],{type:"application/json;charset=utf-8"}); }
function addOutputFile(name,blob){ state.outputFiles.set(name,blob); }

function drawDistributionCanvas(samples,bw,unit,title,width=1100,height=650){
  const c=document.createElement("canvas");c.width=width;c.height=height;
  const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,width,height);
  if(!samples.length){ctx.fillStyle="#111";ctx.font="700 24px sans-serif";ctx.fillText("No detected objects",50,80);return c;}

  const st=summarize(samples), rawMin=Math.min(...samples), rawMax=Math.max(...samples);
  const range=Math.max(rawMax-rawMin,rawMax*.05,1), xmin=Math.max(0,rawMin-range*.08), xmax=rawMax+range*.08;
  const bins=Math.min(40,Math.max(12,Math.round(Math.sqrt(samples.length))));
  const counts=new Array(bins).fill(0), binW=(xmax-xmin)/bins;
  for(const v of samples){
    let b=Math.floor((v-xmin)/(xmax-xmin)*bins);
    b=Math.max(0,Math.min(bins-1,b)); counts[b]++;
  }
  const densities=counts.map(x=>x/(samples.length*binW));
  const xs=Array.from({length:320},(_,i)=>xmin+(xmax-xmin)*i/319);
  const kd=bw?kde(samples,xs,bw):null;
  let maxD=Math.max(...densities,1e-9);if(kd)maxD=Math.max(maxD,...kd);

  const left=80,top=65,pw=width-160,ph=height-160;
  const sx=x=>left+(x-xmin)/(xmax-xmin)*pw;
  const sy=y=>top+ph-y/(maxD*1.12)*ph;
  ctx.strokeStyle="#d0d5dd";ctx.strokeRect(left,top,pw,ph);
  ctx.fillStyle="rgba(36,87,230,.30)";ctx.strokeStyle="#667085";
  for(let i=0;i<bins;i++){
    const x1=left+i/bins*pw,x2=left+(i+1)/bins*pw,y=sy(densities[i]);
    ctx.fillRect(x1,y,x2-x1,top+ph-y);ctx.strokeRect(x1,y,x2-x1,top+ph-y);
  }
  if(kd){
    ctx.beginPath();ctx.strokeStyle="#b42318";ctx.lineWidth=3;
    kd.forEach((v,i)=>{const x=sx(xs[i]),y=sy(v);i?ctx.lineTo(x,y):ctx.moveTo(x,y);});
    ctx.stroke();
  }
  [[st.mean,[8,5],"#157347"],[st.median,[2,5],"#9a6700"]].forEach(([v,dash,color])=>{
    ctx.save();ctx.setLineDash(dash);ctx.strokeStyle=color;ctx.lineWidth=2;
    ctx.beginPath();ctx.moveTo(sx(v),top);ctx.lineTo(sx(v),top+ph);ctx.stroke();ctx.restore();
  });
  ctx.fillStyle="#111827";ctx.textAlign="center";ctx.font="700 22px sans-serif";ctx.fillText(title,width/2,32);
  ctx.font="14px sans-serif";ctx.fillText(`Equivalent circular diameter (${unit})`,width/2,height-24);
  ctx.save();ctx.translate(24,top+ph/2);ctx.rotate(-Math.PI/2);ctx.fillText("Probability density",0,0);ctx.restore();

  ctx.textAlign="left";ctx.font="13px sans-serif";
  const lines=[
    `n = ${st.count}`,`Mean = ${niceNumber(st.mean)} ${unit}`,`Median = ${niceNumber(st.median)} ${unit}`,
    `Std = ${niceNumber(st.std)} ${unit}`,`Q1/Q3 = ${niceNumber(st.q1)} / ${niceNumber(st.q3)} ${unit}`,
    bw?`KDE h = ${niceNumber(bw)} ${unit}`:"KDE unavailable"
  ];
  const tx=left+pw-250,ty=top+25;
  ctx.fillStyle="rgba(255,255,255,.92)";ctx.strokeStyle="#d0d5dd";
  ctx.fillRect(tx-12,ty-18,250,128);ctx.strokeRect(tx-12,ty-18,250,128);
  ctx.fillStyle="#111";lines.forEach((t,i)=>ctx.fillText(t,tx,ty+i*18));
  return c;
}

async function makeImageReport(result,bw,unit){
  const c=document.createElement("canvas");c.width=1800;c.height=620;
  const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  const [a,b]=await Promise.all([loadImage(result.sourcePreviewUrl),loadImage(result.overlayPreviewUrl)]);
  drawImagePanel(ctx,a,25,65,550,460,"Original Image");
  drawImagePanel(ctx,b,615,65,550,460,`Segmentation | n=${result.diameters.length}`);
  const d=drawDistributionCanvas(result.diameters,bw,unit,"ECD Distribution",600,500);
  ctx.drawImage(d,1190,65,580,480);
  ctx.fillStyle="#111";ctx.font="700 24px sans-serif";ctx.textAlign="left";ctx.fillText(result.filename,25,34);
  return c;
}
function drawImagePanel(ctx,img,x,y,w,h,title){
  ctx.fillStyle="#111";ctx.font="700 16px sans-serif";ctx.textAlign="center";ctx.fillText(title,x+w/2,y-12);
  ctx.fillStyle="#111827";ctx.fillRect(x,y,w,h);
  const s=Math.min(w/img.width,h/img.height),dw=img.width*s,dh=img.height*s;
  ctx.drawImage(img,x+(w-dw)/2,y+(h-dh)/2,dw,dh);
}
function loadImage(url){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=url;});}

function drawIndividualGrid(results,bw,unit,pageIndex,perPage=12){
  const slice=results.slice(pageIndex*perPage,(pageIndex+1)*perPage),cols=3,rows=Math.ceil(slice.length/cols);
  const cw=600,ch=430,c=document.createElement("canvas");c.width=cols*cw;c.height=Math.max(1,rows*ch);
  const ctx=c.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,c.width,c.height);
  slice.forEach((r,i)=>{
    const p=drawDistributionCanvas(r.diameters,bw,unit,r.filename,cw,ch);
    ctx.drawImage(p,(i%cols)*cw,Math.floor(i/cols)*ch);
  });
  return c;
}

function renderMetrics(container,items){
  container.innerHTML=items.map(([l,v])=>`<div class="metric"><div class="label">${l}</div><div class="value">${v}</div></div>`).join("");
}
function escapeHtml(s){return String(s).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");}
function renderSummaryTable(results,unit){
  const tb=$("summaryTable").querySelector("tbody");tb.innerHTML="";
  for(const r of results){
    const s=summarize(r.diameters),rejected=r.objects.filter(o=>!o.kept).length;
    const tr=document.createElement("tr");
    tr.innerHTML=`<td>${escapeHtml(r.filename)}</td><td>${s.count}</td><td>${niceNumber(s.mean)} ${escapeHtml(unit)}</td>
      <td>${niceNumber(s.median)} ${escapeHtml(unit)}</td><td>${niceNumber(s.std)}</td>
      <td>${niceNumber(s.min)}</td><td>${niceNumber(s.max)}</td><td>${rejected}</td>`;
    tb.appendChild(tr);
  }
}
function renderPreviews(results,unit){
  const wrap=$("previews");wrap.innerHTML="";
  for(const r of results){
    const s=summarize(r.diameters),card=document.createElement("div");card.className="preview-card";
    card.innerHTML=`<h4>${escapeHtml(r.filename)}</h4><img src="${r.overlayPreviewUrl}" alt="Segmentation preview">
      <div class="meta">n=${s.count} · mean=${niceNumber(s.mean)} ${escapeHtml(unit)}
      · watershed=${r.minPeakDistancePxUsed}px</div>`;
    wrap.appendChild(card);
  }
}
function renderDownloads(){
  const wrap=$("downloads");wrap.innerHTML="";
  for(const [name,blob] of state.outputFiles.entries()){
    const url=URL.createObjectURL(blob);state.objectUrls.push(url);
    const item=document.createElement("div");item.className="download-item";
    item.innerHTML=`<span>${escapeHtml(name)}</span><a href="${url}" download="${escapeHtml(name)}">下載</a>`;
    wrap.appendChild(item);
  }
}
function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);state.objectUrls.push(url);
  const a=document.createElement("a");a.href=url;a.download=filename;a.click();
}
async function downloadAllZip(){
  if(!state.outputFiles.size)return;
  if(typeof JSZip==="undefined"){alert("JSZip 尚未載入，請重新整理後再試。");return;}
  $("downloadZipBtn").disabled=true;$("downloadZipBtn").textContent="ZIP 建立中…";
  try{
    const zip=new JSZip();
    for(const [name,blob] of state.outputFiles.entries())zip.file(name,blob);
    const out=await zip.generateAsync({type:"blob",compression:"DEFLATE",compressionOptions:{level:6}});
    downloadBlob(out,"eel_egg_analysis_results.zip");
  }finally{
    $("downloadZipBtn").disabled=false;$("downloadZipBtn").textContent="下載全部結果 ZIP";
  }
}

async function runAnalysis(){
  resetResults();
  try{
    if(!state.cvReady)throw new Error("OpenCV.js 尚未就緒。");
    const sampleFiles=Array.from($("sampleFiles").files);
    if(!sampleFiles.length)throw new Error("請至少選擇一張卵巢影像。");

    const cfg=readConfig();
    $("analyzeBtn").disabled=true;
    setProgress(3,"建立校正結果…");await nextFrame();

    const calibration=buildCalibration(cfg);state.calibration=calibration;
    const rc=$("calibrationResultCanvas");
    rc.width=calibration.resultCanvas.width;rc.height=calibration.resultCanvas.height;
    rc.getContext("2d").drawImage(calibration.resultCanvas,0,0);
    $("calibrationSection").classList.remove("hidden");

    renderMetrics($("calibrationSummary"),[
      [`pixels / ${cfg.unit}`,niceNumber(cfg.pixelsPerUnit)],
      ["Pixel distance",`${niceNumber(cfg.pixelDistance)} px`],
      [`Known distance (${cfg.unit})`,niceNumber(cfg.realDistance)],
      ["Method","2-point ruler"]
    ]);

    addOutputFile("calibration_measurement.csv",csvBlob(calibration.points));
    addOutputFile("calibration_selected_points.png",await canvasToBlob(calibration.resultCanvas));

    const results=[];
    for(let i=0;i<sampleFiles.length;i++){
      const file=sampleFiles[i];
      setProgress(8+64*i/sampleFiles.length,`分析 ${i+1}/${sampleFiles.length}: ${file.name}`);
      await nextFrame();
      try{
        results.push(await analyzeImage(file,cfg.pixelsPerUnit,cfg));
      }catch(err){
        console.error(file.name,err);
        results.push({filename:file.name,diameters:[],objects:[],minPeakDistancePxUsed:NaN,
          sourcePreviewUrl:"",overlayPreviewUrl:"",error:String(err.message||err)});
      }
    }
    state.results=results;

    const allD=results.flatMap(r=>r.diameters);
    if(!allD.length)throw new Error("所有圖片都沒有通過篩選的物件。請先降低 MIN_AREA 或檢查 segmentation。");

    const bw=cfg.kdeBandwidth&&cfg.kdeBandwidth>0?cfg.kdeBandwidth:silvermanBandwidth(allD);
    setProgress(74,"建立統計與圖表…");await nextFrame();

    const allRows=[],qcRows=[],summaryRows=[];
    for(const r of results){
      const s=summarize(r.diameters);
      summaryRows.push({
        filename:r.filename,count:s.count,[`mean_${cfg.unit}`]:s.mean,[`median_${cfg.unit}`]:s.median,
        [`std_${cfg.unit}`]:s.std,[`min_${cfg.unit}`]:s.min,[`max_${cfg.unit}`]:s.max
      });
      for(const o of r.objects){
        qcRows.push({filename:r.filename,...o,min_peak_distance_px_used:r.minPeakDistancePxUsed});
        if(o.kept)allRows.push({
          filename:r.filename,object_id:o.object_id,diameter_px:o.equivalent_diameter_px,
          [`diameter_${cfg.unit}`]:o[`equivalent_diameter_${cfg.unit}`],
          [`area_${cfg.unit}2`]:o[`area_${cfg.unit}2`],
          [`major_axis_${cfg.unit}`]:o[`major_axis_${cfg.unit}`],
          [`minor_axis_${cfg.unit}`]:o[`minor_axis_${cfg.unit}`],
          circularity:o.circularity,eccentricity:o.eccentricity,touching_border:o.touching_border
        });
      }
    }
    addOutputFile("all_diameters.csv",csvBlob(allRows));
    addOutputFile("summary_per_image.csv",csvBlob(summaryRows));
    addOutputFile("segmentation_qc.csv",csvBlob(qcRows));

    const total=summarize(allD);
    addOutputFile("total_probability_distribution_stats.csv",csvBlob([{
      count:total.count,[`mean_${cfg.unit}`]:total.mean,[`median_${cfg.unit}`]:total.median,
      [`std_${cfg.unit}`]:total.std,[`q1_${cfg.unit}`]:total.q1,[`q3_${cfg.unit}`]:total.q3,
      cv:total.cv,[`min_${cfg.unit}`]:total.min,[`max_${cfg.unit}`]:total.max,
      [`kde_bandwidth_${cfg.unit}`]:bw
    }]));

    const totalCanvas=drawDistributionCanvas(allD,bw,cfg.unit,
      `Cumulative ECD Distribution (${results.length} images, ${allD.length} objects)`);
    const tc=$("totalDistributionCanvas");tc.width=totalCanvas.width;tc.height=totalCanvas.height;
    tc.getContext("2d").drawImage(totalCanvas,0,0);
    addOutputFile("total_probability_distribution.png",await canvasToBlob(totalCanvas));

    const pages=Math.ceil(results.length/12);
    for(let p=0;p<pages;p++){
      const grid=drawIndividualGrid(results,bw,cfg.unit,p,12);
      const name=pages===1?"individual_probability_distributions.png":`individual_probability_distributions_${p+1}.png`;
      addOutputFile(name,await canvasToBlob(grid));
    }

    setProgress(84,"建立每張圖片的三合一報告…");await nextFrame();
    for(let i=0;i<results.length;i++){
      const r=results[i];if(!r.sourcePreviewUrl||!r.overlayPreviewUrl)continue;
      const report=await makeImageReport(r,bw,cfg.unit),stem=r.filename.replace(/\.[^.]+$/,"");
      addOutputFile(`${stem}_analysis.png`,await canvasToBlob(report));
      if(i%2===0){setProgress(84+10*(i+1)/results.length,`建立報告 ${i+1}/${results.length}`);await nextFrame();}
    }

    addOutputFile("analysis_metadata.json",jsonBlob({
      app:"Japanese Eel Egg Diameter Analyzer Static Web",
      measurement:"Equivalent Circular Diameter (ECD)",
      formula:"ECD = 2 * sqrt(area / pi)",
      calibration:{
        method:"two-point grid/ruler calibration",
        pixel_distance_px:cfg.pixelDistance,known_real_distance:cfg.realDistance,
        unit:cfg.unit,pixels_per_unit:cfg.pixelsPerUnit,
        selected_points:state.calibrationPoints
      },
      segmentation:{
        threshold:"Otsu dark-object inverse",min_area_px2:cfg.minArea,min_circularity:cfg.minCircularity,
        exclude_border:cfg.excludeBorder,min_peak_distance_px_fallback:cfg.minPeakDistancePx,
        min_peak_distance_real:cfg.minPeakDistanceReal,gaussian_kernel:cfg.gaussianKernel,
        morphology_kernel:cfg.morphKernel,open_iterations:cfg.openIterations,close_iterations:cfg.closeIterations
      },
      kde:{shared_bandwidth:bw,source:cfg.kdeBandwidth?"user_fixed":"Silverman_from_all_kept_objects"},
      images:results.length,total_kept_objects:allD.length
    }));

    renderSummaryTable(results,cfg.unit);
    renderPreviews(results.filter(r=>r.overlayPreviewUrl),cfg.unit);
    renderMetrics($("totalMetrics"),[
      ["Total objects",total.count],[`Mean (${cfg.unit})`,niceNumber(total.mean)],
      [`Median (${cfg.unit})`,niceNumber(total.median)],[`Std (${cfg.unit})`,niceNumber(total.std)],
      ["CV",niceNumber(total.cv)],[`KDE bandwidth (${cfg.unit})`,bw?niceNumber(bw):"—"]
    ]);
    $("resultSummary").textContent=`已分析 ${results.length} 張圖片，保留 ${allD.length} 個物件。請先檢查 Segmentation QC。`;
    renderDownloads();
    $("resultsSection").classList.remove("hidden");
    $("previewSection").classList.remove("hidden");
    $("downloadZipBtn").disabled=false;
    setProgress(100,"分析完成");
  }catch(err){
    console.error(err);setProgress(0,`錯誤：${err.message||err}`);alert(err.message||String(err));
  }finally{
    updateAnalyzeButton();
  }
}
