/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const params = new URLSearchParams(location.search);
const token = params.get("token");
const app = document.getElementById("app");

let signerName = "";
let signerEmail = "";
let activeSignatureField = null;
let signatureMode = "type";
let selectedTypedIndex = 0;
let uploadedSignatureDataUrl = "";
let drawingCanvas = null;
let drawingCtx = null;
let isDrawing = false;

const typedStyles = [
  { font: "'Great Vibes', cursive", slant: "0deg" },
  { font: "'Caveat', cursive", slant: "-2deg" },
  { font: "'Dancing Script', cursive", slant: "-2deg" },
  { font: "'Pacifico', cursive", slant: "0deg" },
  { font: "'Mrs Saint Delafield', cursive", slant: "-1deg" },
  { font: "'Alex Brush', cursive", slant: "-2deg" }
];

function esc(s) {
  const el = document.createElement("div");
  el.textContent = s != null ? s : "";
  return el.innerHTML;
}

function signatureLabel(value) {
  const parsed = parseSignatureValue(value);
  if (parsed?.text) return parsed.text;
  return value || "";
}

function parseSignatureValue(value) {
  if (!value || value[0] !== "{") return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed && parsed.kind === "signature") return parsed;
  } catch {
    return null;
  }
  return null;
}

function addOverlay(wrap, f, editable) {
  const overlay = document.createElement("div");
  overlay.className = editable ? "field-overlay" : "field-overlay field-overlay-done";
  overlay.style.left = f.rect.x * 100 + "%";
  overlay.style.top = f.rect.y * 100 + "%";
  overlay.style.width = f.rect.width * 100 + "%";
  overlay.style.height = f.rect.height * 100 + "%";
  let label = f.label || f.type;
  if (f.type === "signature" && signerName) {
    label = signerName + " signature"; 
  }

  if (editable && f.type === "signature") {
    overlay.innerHTML =
      "<label>" +
      esc(label) +
      (f.required ? " *" : "") +
      "</label>" +
      '<input type="hidden" data-field-id="' +
      esc(f.id) +
      '" />' +
      '<button type="button" class="signature-trigger" data-signature-field="' +
      esc(f.id) +
      '">Insert signature</button>' +
      '<div class="signature-preview" data-signature-preview="' +
      esc(f.id) +
      '"></div>';
    const trigger = overlay.querySelector("[data-signature-field]");
    const preview = overlay.querySelector("[data-signature-preview]");
    if (trigger) {
      trigger.onclick = function () {
        const savedSignature = localStorage.getItem("saved_signature_" + signerEmail);
        const input = overlay.querySelector('[data-field-id="' + CSS.escape(f.id) + '"]');
        if (savedSignature && (!input || !input.value)) {
          setSignatureFieldValue(f.id, savedSignature);
        } else {
          openSignatureModal(f.id);
        }
      };
    }
    if (preview) {
      preview.onclick = function () {
        const input = overlay.querySelector('[data-field-id="' + CSS.escape(f.id) + '"]');
        if (input && input.value) {
          openSignatureModal(f.id);
        }
      };
    }
  } else if (editable) {
    overlay.innerHTML =
      "<label>" +
      esc(label) +
      (f.required ? " *" : "") +
      "</label>" +
      '<input type="text" data-field-id="' +
      esc(f.id) +
      '" />';
  } else {
    // For completed fields, render signature image if available, otherwise text
    const parsed = parseSignatureValue(f.value);
    if (parsed?.dataUrl) {
      // Show the actual signature image — no border/box, just the image
      overlay.style.border = "none";
      overlay.style.background = "transparent";
      overlay.style.padding = "0";
      overlay.innerHTML =
        '<img src="' + esc(parsed.dataUrl) + '" alt="' + esc(parsed.text || "Signature") + '" ' +
        'style="width:100%; height:100%; object-fit:contain; display:block;" />';
    } else {
      // Plain text value (e.g. date, name fields) — show cleanly without a visible box
      overlay.style.border = "none";
      overlay.style.background = "transparent";
      overlay.innerHTML =
        '<span class="signed-value" style="font-size:0.85em; color:#111;">' +
        esc(signatureLabel(f.value)) +
        "</span>";
    }
  }
  wrap.appendChild(overlay);
}

function ensureSignatureModal() {
  if (document.getElementById("signature-modal")) return;

  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="modal-backdrop" id="signature-modal" hidden>' +
      '<div class="signature-dialog" role="dialog" aria-modal="true" aria-labelledby="signature-title">' +
        '<div class="dialog-head">' +
          '<h2 id="signature-title">Signature</h2>' +
          '<button type="button" class="icon-btn" id="signature-close" aria-label="Close">x</button>' +
        "</div>" +
        '<div class="signature-tabs" role="tablist">' +
          '<button type="button" class="active" data-signature-mode="type">Type</button>' +
          '<button type="button" data-signature-mode="draw">Draw</button>' +
          '<button type="button" data-signature-mode="upload">Upload</button>' +
        "</div>" +
        '<div class="signature-panel" data-panel="type">' +
          '<label class="name-row"><span>Your name</span><input type="text" id="signature-name" /></label>' +
          '<div class="typed-grid" id="typed-grid"></div>' +
        "</div>" +
        '<div class="signature-panel" data-panel="draw" hidden>' +
          '<div class="draw-box"><canvas id="draw-signature" width="720" height="220"></canvas></div>' +
          '<button type="button" class="secondary clear-draw" id="clear-draw">Clear</button>' +
        "</div>" +
        '<div class="signature-panel" data-panel="upload" hidden>' +
          '<label class="upload-box">' +
            '<input type="file" id="signature-upload" accept="image/png,image/jpeg,image/webp" />' +
            '<span>Choose a signature image</span>' +
          "</label>" +
          '<div class="upload-preview" id="upload-preview"></div>' +
        "</div>" +
        '<p class="legal-note">I understand that this is a legal representation of my signature.</p>' +
        '<div class="dialog-foot">' +
          '<label class="apply-row"><input type="checkbox" id="apply-everywhere" /> Apply everywhere</label>' +
          '<div class="dialog-actions">' +
            '<button type="button" class="secondary" id="signature-cancel">Cancel</button>' +
            '<button type="button" class="primary" id="signature-save">Save & use</button>' +
          "</div>" +
        "</div>" +
      "</div>" +
    "</div>",
  );

  document.getElementById("signature-close").onclick = closeSignatureModal;
  document.getElementById("signature-cancel").onclick = closeSignatureModal;
  document.getElementById("signature-save").onclick = saveSignatureFromModal;
  document.getElementById("clear-draw").onclick = clearDrawingCanvas;
  document.getElementById("signature-name").oninput = renderTypedChoices;
  document.querySelectorAll("[data-signature-mode]").forEach(function (btn) {
    btn.onclick = function () {
      setSignatureMode(btn.dataset.signatureMode);
    };
  });
  document.getElementById("signature-upload").onchange = handleSignatureUpload;

  drawingCanvas = document.getElementById("draw-signature");
  drawingCtx = drawingCanvas.getContext("2d");
  setupDrawingCanvas();
  renderTypedChoices();
}

function openSignatureModal(fieldId) {
  ensureSignatureModal();
  activeSignatureField = fieldId;
  document.getElementById("signature-name").value = signerName;
  document.getElementById("apply-everywhere").checked = false;
  setSignatureMode("type");
  renderTypedChoices();
  clearDrawingCanvas();
  document.getElementById("signature-modal").hidden = false;
}

function closeSignatureModal() {
  const modal = document.getElementById("signature-modal");
  if (modal) modal.hidden = true;
  activeSignatureField = null;
}

function setSignatureMode(mode) {
  signatureMode = mode;
  document.querySelectorAll("[data-signature-mode]").forEach(function (btn) {
    btn.classList.toggle("active", btn.dataset.signatureMode === mode);
  });
  document.querySelectorAll("[data-panel]").forEach(function (panel) {
    panel.hidden = panel.dataset.panel !== mode;
  });
}

function renderTypedChoices() {
  const grid = document.getElementById("typed-grid");
  if (!grid) return;
  const name = document.getElementById("signature-name").value.trim() || signerName || "Your Signature";
  grid.innerHTML = typedStyles
    .map(function (style, i) {
      return (
        '<button type="button" class="typed-choice' +
        (i === selectedTypedIndex ? " selected" : "") +
        '" data-typed-index="' +
        i +
        '">' +
        '<span style="font-family:' + style.font + '; transform: rotate(' + style.slant + '); display: inline-block;">' +
        esc(name) +
        "</span>" +
        "</button>"
      );
    })
    .join("");
  grid.querySelectorAll("[data-typed-index]").forEach(function (btn) {
    btn.onclick = function () {
      selectedTypedIndex = Number(btn.dataset.typedIndex);
      renderTypedChoices();
    };
  });
}

function setupDrawingCanvas() {
  drawingCtx.lineWidth = 4;
  drawingCtx.lineCap = "round";
  drawingCtx.lineJoin = "round";
  drawingCtx.strokeStyle = "#111827";

  function pos(ev) {
    const rect = drawingCanvas.getBoundingClientRect();
    const point = ev.touches ? ev.touches[0] : ev;
    return {
      x: ((point.clientX - rect.left) / rect.width) * drawingCanvas.width,
      y: ((point.clientY - rect.top) / rect.height) * drawingCanvas.height,
    };
  }

  function start(ev) {
    ev.preventDefault();
    isDrawing = true;
    const p = pos(ev);
    drawingCtx.beginPath();
    drawingCtx.moveTo(p.x, p.y);
  }

  function move(ev) {
    if (!isDrawing) return;
    ev.preventDefault();
    const p = pos(ev);
    drawingCtx.lineTo(p.x, p.y);
    drawingCtx.stroke();
  }

  function end() {
    isDrawing = false;
  }

  drawingCanvas.addEventListener("mousedown", start);
  drawingCanvas.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  drawingCanvas.addEventListener("touchstart", start, { passive: false });
  drawingCanvas.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
}

function clearDrawingCanvas() {
  if (!drawingCtx) return;
  drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
}

function handleSignatureUpload(ev) {
  const file = ev.target.files && ev.target.files[0];
  if (!file) return;
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
    alert("Please upload a PNG, JPG, or WebP image.");
    ev.target.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = function () {
    normalizeSignatureImage(String(reader.result || ""), function (dataUrl) {
      uploadedSignatureDataUrl = dataUrl;
      document.getElementById("upload-preview").innerHTML =
        '<img src="' + esc(uploadedSignatureDataUrl) + '" alt="Uploaded signature preview" />';
    });
  };
  reader.readAsDataURL(file);
}

function normalizeSignatureImage(dataUrl, done) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 220;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min((canvas.width - 32) / img.width, (canvas.height - 24) / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    done(canvas.toDataURL("image/png"));
  };
  img.onerror = function () {
    alert("Could not read that signature image.");
  };
  img.src = dataUrl;
}

function typedSignatureDataUrl(name, style) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 220;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111827";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "92px " + style.font;
  ctx.fillText(name, canvas.width / 2, canvas.height / 2, canvas.width - 48);
  return canvas.toDataURL("image/png");
}

function isCanvasBlank(canvas) {
  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 0) return false;
  }
  return true;
}

function saveSignatureFromModal() {
  if (!activeSignatureField) return;
  const name = document.getElementById("signature-name").value.trim() || signerName || "Signature";
  let dataUrl = "";

  if (signatureMode === "type") {
    dataUrl = typedSignatureDataUrl(name, typedStyles[selectedTypedIndex]);
  } else if (signatureMode === "draw") {
    if (isCanvasBlank(drawingCanvas)) {
      alert("Please draw your signature first.");
      return;
    }
    dataUrl = drawingCanvas.toDataURL("image/png");
  } else {
    if (!uploadedSignatureDataUrl) {
      alert("Please upload a signature image first.");
      return;
    }
    dataUrl = uploadedSignatureDataUrl;
  }

  const value = JSON.stringify({
    kind: "signature",
    mode: signatureMode,
    text: name,
    dataUrl: dataUrl,
  });

  const isApplyEverywhere = document.getElementById("apply-everywhere").checked;
  try {
    localStorage.setItem("saved_signature_" + signerEmail, value);
    localStorage.setItem("apply_everywhere_" + signerEmail, isApplyEverywhere ? "true" : "false");
  } catch (e) {
    console.error("Could not save signature to localStorage", e);
  }

  const ids = isApplyEverywhere
    ? Array.from(document.querySelectorAll(".signature-trigger")).map(function (btn) {
        return btn.dataset.signatureField;
      })
    : [activeSignatureField];

  ids.forEach(function (id) {
    setSignatureFieldValue(id, value);
  });
  closeSignatureModal();
}

function setSignatureFieldValue(id, value) {
  const input = document.querySelector('[data-field-id="' + CSS.escape(id) + '"]');
  const preview = document.querySelector('[data-signature-preview="' + CSS.escape(id) + '"]');
  const trigger = document.querySelector('[data-signature-field="' + CSS.escape(id) + '"]');
  if (input) input.value = value;
  if (preview) {
    const parsed = parseSignatureValue(value);
    preview.innerHTML = parsed?.dataUrl
      ? '<img src="' + esc(parsed.dataUrl) + '" alt="Signature preview" />'
      : esc(signatureLabel(value));
    if (parsed) {
      if (trigger) trigger.style.display = "none";
      preview.style.cursor = "pointer";
      preview.title = "Click to change signature";
    } else {
      if (trigger) trigger.style.display = "block";
      preview.style.cursor = "default";
      preview.removeAttribute("title");
    }
  }
}

async function load() {
  if (!token) {
    app.innerHTML = '<div class="error">Missing token in URL.</div>';
    return;
  }
  const res = await fetch("/embed/api/session?token=" + encodeURIComponent(token));
  const data = await res.json().catch(function () {
    return {};
  });
  if (!res.ok) {
    app.innerHTML =
      '<div class="error">' + esc(data.error || "Invalid or expired session") + "</div>";
    return;
  }

  signerName = data.recipient?.name || data.recipient?.email || "";
  signerEmail = data.recipient?.email || "";

  app.innerHTML =
    "<header><h1>" +
    esc(data.envelope?.title || data.document?.originalName || "Sign document") +
    "</h1>" +
    '<p class="muted">Signing as ' +
    esc(signerName) +
    "</p></header>" +
    '<div id="pages"></div>' +
    '<button type="button" class="primary complete-btn" id="complete">Complete signing</button>';

  const editableFields = data.fields || [];
  const completedFields = data.completedFields || [];

  const url = "/embed/api/document?token=" + encodeURIComponent(token);
  const pdf = await pdfjsLib.getDocument(url).promise;
  const container = document.getElementById("pages");

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const scale = 1.35;
    const viewport = page.getViewport({ scale: scale });
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.style.width = viewport.width + "px";
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);
    container.appendChild(wrap);
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;

    completedFields
      .filter(function (f) {
        return f.pageIndex === p - 1;
      })
      .forEach(function (f) {
        addOverlay(wrap, f, false);
      });

    editableFields
      .filter(function (f) {
        return f.pageIndex === p - 1;
      })
      .forEach(function (f) {
        addOverlay(wrap, f, true);
      });
  }

  // Auto sign if apply_everywhere was checked previously
  try {
    const savedSignature = localStorage.getItem("saved_signature_" + signerEmail);
    const applyEverywhere = localStorage.getItem("apply_everywhere_" + signerEmail) === "true";
    if (savedSignature && applyEverywhere) {
      const sigFields = editableFields.filter(function (f) {
        return f.type === "signature";
      });
      sigFields.forEach(function (f) {
        setSignatureFieldValue(f.id, savedSignature);
      });
    }
  } catch (e) {
    console.error("Could not auto-apply saved signature", e);
  }

  document.getElementById("complete").onclick = async function () {
    const btn = document.getElementById("complete");
    btn.disabled = true;
    const values = {};
    document.querySelectorAll("[data-field-id]").forEach(function (el) {
      values[el.dataset.fieldId] = el.value;
    });
    const r = await fetch("/embed/api/sign/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token, fieldValues: values }),
    });
    const out = await r.json().catch(function () {
      return {};
    });
    if (!r.ok) {
      btn.disabled = false;
      alert(out.error || "Could not complete signing");
      return;
    }
    var doneHtml = '<div class="done"><p>Signing complete.</p>';
    //if (out.status === "COMPLETED" && out.embedDownloadUrl) {
    //  doneHtml +=
    //    '<p><a href="' +
    //    esc(out.embedDownloadUrl) +
    //    '" download>Download signed PDF</a></p>';
    //}
    doneHtml += '<p class="muted">You can close this window.</p></div>';
    app.innerHTML = doneHtml;
    if (window.parent !== window) {
      window.parent.postMessage(
        { type: "esign.signing.completed", envelopeId: data.envelope?.id },
        "*",
      );
    }
  };
}

load();
