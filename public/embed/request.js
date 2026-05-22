/* global pdfjsLib */
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

const params = new URLSearchParams(location.search);
const token = params.get("token");
const app = document.getElementById("app");

const DEFAULT_W = 0.22;
const DEFAULT_H = 0.06;

let session = null;
let placed = [];
let localRecipients = [];
let localDocument = null;
let pendingFiles = []; // to track actual File objects
const recipientColors = {};

function esc(s) {
  const el = document.createElement("div");
  el.textContent = s != null ? s : "";
  return el.innerHTML;
}

function recipientLabel(r) {
  return r.name || r.email;
}

function colorClass(recipientId) {
  const idx = recipientColors[recipientId] != null ? recipientColors[recipientId] : 0;
  return "colors-" + (idx % 4);
}

async function loadSession() {
  const res = await fetch("/embed/api/request/session?token=" + encodeURIComponent(token));
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Invalid session");
  session = data;
  localRecipients = [...(session.recipients || [])];
  localDocument = session.document;

  session.recipients.forEach(function (r, i) {
    recipientColors[r.id] = i;
  });
  placed = (data.fields || []).map(function (f) {
    return {
      id: f.id,
      recipientId: f.recipientId,
      type: f.type,
      pageIndex: f.pageIndex,
      rect: f.rect,
      label: f.label,
    };
  });
}

function renderStep1() {
  app.innerHTML = `
    <div class="step active" id="step1">
      <h1>Prepare document for signing (Step 1/2)</h1>
      <div class="card">
        <h2>Add file(s)</h2>
        <div class="upload-box" id="upload-box">
          <p>Choose from computer</p>
          <button class="btn" type="button" id="browse-btn">Browse</button>
          <p class="hint">Preferred format: PDF</p>
          <input type="file" id="file-input" multiple accept="application/pdf" />
        </div>
        <div class="file-list" id="file-list"></div>
      </div>
      
      <div class="card">
        <h2>Add Recipients</h2>
        <div class="recipients-list" id="recipients-list"></div>
      </div>

      <div class="step-actions">
        <button type="button" class="btn primary" id="next-btn">Save and proceed</button>
      </div>
    </div>
    <div class="step" id="step2"></div>
  `;

  setupStep1Events();
  renderFileList();
  renderRecipientsList();
}

window.updateRecipientName = function (idx, val) {
  localRecipients[idx].name = val;
}
window.updateRecipientEmail = function (idx, val) {
  localRecipients[idx].email = val;
}
window.removeRecipient = function (idx) {
  localRecipients.splice(idx, 1);
  renderRecipientsList();
}

function setupStep1Events() {
  const fileInput = document.getElementById("file-input");
  const browseBtn = document.getElementById("browse-btn");
  const uploadBox = document.getElementById("upload-box");
  const nextBtn = document.getElementById("next-btn");

  browseBtn.onclick = () => fileInput.click();
  uploadBox.onclick = (e) => { if (e.target !== browseBtn && e.target !== fileInput && !e.target.closest('.rm-file')) fileInput.click() };

  fileInput.onchange = async () => {
    if (!fileInput.files.length) return;
    for (let i = 0; i < fileInput.files.length; i++) {
      pendingFiles.push(fileInput.files[i]);
    }
    console.log("Selected files:", pendingFiles.length);

    window.parent.postMessage({
      type: 'IFRAME_FILE_COUNT',
      count: pendingFiles.length
    }, '*');

    // Clear the input so the same files can be selected again if needed
    fileInput.value = "";
    renderFileList();
  };

  window.removePendingFile = function (idx) {
    pendingFiles.splice(idx, 1);
    renderFileList();
  }

  nextBtn.onclick = async () => {
    if (!localDocument && pendingFiles.length === 0) {
      alert("Please upload at least one document.");
      return;
    }
    if (localRecipients.length === 0 || !localRecipients.some(r => r.email)) {
      alert("Please add at least one recipient with an email address.");
      return;
    }

    nextBtn.textContent = "Saving...";
    nextBtn.disabled = true;

    try {
      if (pendingFiles.length > 0) {
        nextBtn.textContent = "Uploading files...";
        const fd = new FormData();
        for (let i = 0; i < pendingFiles.length; i++) {
          fd.append("Files", pendingFiles[i]);
        }

        const uploadRes = await fetch("/embed/api/request/upload?token=" + encodeURIComponent(token), {
          method: "POST",
          body: fd
        });
        const uploadData = await uploadRes.json();
        if (!uploadRes.ok) throw new Error(uploadData.error || "Upload failed");
        localDocument = uploadData.document;
        // clear pending after successful upload
        pendingFiles = [];
        // Notify parent frame (e.g. ProcessMaker) that a file has been uploaded
        if (window.parent !== window) {
          console.log('not windown parent'); ``
          window.parent.postMessage({ type: "esign.document.uploaded", documentId: localDocument.id }, "*");
        }
      }

      nextBtn.textContent = "Saving recipients...";
      // Save recipients
      const res = await fetch("/embed/api/request/recipients", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: token,
          recipients: localRecipients.filter(r => r.email)
        })
      });
      if (!res.ok) throw new Error("Failed to save recipients");

      // Reload session and go to step 2
      await loadSession();
      nextBtn.textContent = "Save and proceed";
      nextBtn.disabled = false;
      renderStep2();
    } catch (e) {
      alert(e.message);
      nextBtn.textContent = "Save and proceed";
      nextBtn.disabled = false;
    }
  };
}

let html = "";
let fileCount = 0;


function renderFileList() {
  const list = document.getElementById("file-list");
  if (!list) return;
  if (!localDocument && pendingFiles.length === 0) {
    list.innerHTML = "";
    return;
  }


  if (pendingFiles.length > 0) {
    html = pendingFiles.map((file, i) => `
      <div class="file-item" style="margin-bottom: 0.5rem;">
        <div>
          <strong>${esc(file.name)}</strong>
          <div class="hint" style="margin:0">Pending upload</div>
        </div>
        <div>
          <button class="btn rm-file" type="button" onclick="window.removePendingFile(${i})" style="color: #ef4444; border-color: #ef4444;">Remove</button>
        </div>
      </div>
    `).join("");
  } else if (localDocument) {
    // originalName may be a JSON array string when multiple files were uploaded
    let fileNames = [];
    try {
      const parsed = JSON.parse(localDocument.originalName);
      if (Array.isArray(parsed)) {
        fileNames = parsed;
      } else {
        fileNames = [localDocument.originalName];
      }
    } catch (e) {
      fileNames = [localDocument.originalName];
    }
    fileCount = fileNames.length;
    html = fileNames.map((name, idx) => `
      <div class="file-item" style="margin-bottom: 0.5rem;">
        <div>
          <strong>${esc(name)}</strong>
          <div class="hint" style="margin:0">Uploaded Successfully</div>
        </div>
        <div> 
          <button class="btn rm-file" type="button" onclick="window.removeStoredFile(${idx})" style="color: #ef4444; border-color: #ef4444;">Remove</button>
        </div>
      </div>
    `).join("");
  }

  list.innerHTML = html;
}

window.removeStoredFile = function (idx) {
  if (!localDocument) return;
  // Parse current filenames
  let fileNames = [];
  try {
    const parsed = JSON.parse(localDocument.originalName);
    if (Array.isArray(parsed)) {
      fileNames = parsed;
    } else {
      fileNames = [localDocument.originalName];
    }
  } catch (e) {
    fileNames = [localDocument.originalName];
  }
  // Remove the selected file
  fileNames.splice(idx, 1);
  if (fileNames.length === 0) {
    // No files left, clear the document entirely
    localDocument = null;
  } else {
    // Update the stored document's originalName to the remaining files
    localDocument.originalName = JSON.stringify(fileNames);
  }
  placed = [];
  renderFileList();
};

window.removeStoredDocument = function () {
  // Legacy fallback – clears everything
  localDocument = null;
  placed = [];
  renderFileList();
}

function renderRecipientsList() {
  const list = document.getElementById("recipients-list");
  if (!list) return;
  if (localRecipients.length === 0) {
    list.innerHTML = '<div class="hint">No recipients configured.</div>';
    return;
  }
  list.innerHTML = localRecipients.map((r, i) => `
    <div class="recipient-row">
      <div style="font-weight:bold; width:20px;">${i + 1}</div>
      <input type="text" value="${esc(r.name || '')}" disabled style="background-color: #f4f4f5; cursor: not-allowed;" />
      <input type="email" value="${esc(r.email || '')}" disabled style="background-color: #f4f4f5; cursor: not-allowed;" />
    </div>
  `).join("");
}

let draggingTool = null;
let draggingField = null;
let selectedField = null;
let pointerStartX = 0;
let pointerStartY = 0;
let fieldStartX = 0;
let fieldStartY = 0;
let ghostEl = null;

function renderStep2() {
  const step1 = document.getElementById("step1");
  const step2 = document.getElementById("step2");
  if (step1) step1.classList.remove("active");
  step2.classList.add("active");

  const opts = session.recipients
    .map(function (r) {
      return '<option value="' + esc(r.id) + '">' + esc(recipientLabel(r)) + "</option>";
    })
    .join("");

  const title = session.envelope.title || session.document?.originalName || "Document";

  step2.innerHTML = `
    <div class="step2-layout">
      <div class="step2-header">
        <button class="btn" id="back-to-step1">
          <span class="back-text-long">&lt; Configure fields (Step 2/2)</span>
          <span class="back-text-short">&lt; Back</span>
        </button>
        <div class="doc-title">${esc(title)}</div>
        <div class="header-actions">
          <button type="button" class="btn primary" id="finish">Send</button>
        </div>
      </div>
      <div class="step2-body">
        <div class="sidebar-backdrop" id="sidebar-backdrop"></div>
        <button type="button" class="mobile-toggle-btn" id="toggle-left-sidebar">
          <span>📋</span> Fields
        </button>
        <button type="button" class="mobile-toggle-btn" id="toggle-right-sidebar">
          <span>⚙️</span> Settings
        </button>
        <div class="step2-sidebar-left" id="sidebar-left">
          <div class="signer-select-wrap">
            <label>Assigned to</label>
            <select id="recipient">${opts}</select>
          </div>
          <div class="tools-grid">
            <div class="tool-btn" data-type="signature">
              <span style="font-size: 1.2rem;">✍️</span> Signature
            </div>
            <div class="tool-btn" data-type="initials">
              <span style="font-size: 1.2rem;">🔤</span> Initials
            </div>
            <div class="tool-btn" data-type="text">
              <span style="font-size: 1.2rem;">T</span> Textbox
            </div>
            <div class="tool-btn" data-type="date">
              <span style="font-size: 1.2rem;">📅</span> Date signed
            </div>
          </div>
        </div>
        <div class="step2-center" id="pages-container">
          <div id="pages"></div>
        </div>
        <div class="step2-sidebar-right" id="properties-panel">
          <div class="empty-props">Select a field to view properties</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("finish").onclick = finishRequest;
  document.getElementById("back-to-step1").onclick = () => {
    step2.classList.remove("active");
    step1.classList.add("active");
    const nextBtn = document.getElementById("next-btn");
    if (nextBtn) {
      nextBtn.textContent = "Save and proceed";
      nextBtn.disabled = false;
    }
    renderFileList();
    renderRecipientsList();
  };

  // Drawer toggle handlers
  const leftSidebar = document.getElementById("sidebar-left");
  const rightSidebar = document.getElementById("properties-panel");
  const backdrop = document.getElementById("sidebar-backdrop");
  const toggleLeft = document.getElementById("toggle-left-sidebar");
  const toggleRight = document.getElementById("toggle-right-sidebar");

  function closeAllDrawers() {
    if (leftSidebar) leftSidebar.classList.remove("open");
    if (rightSidebar) rightSidebar.classList.remove("open");
    if (backdrop) backdrop.classList.remove("open");
  }

  if (toggleLeft) {
    toggleLeft.onclick = function (e) {
      e.stopPropagation();
      if (rightSidebar) rightSidebar.classList.remove("open");
      if (leftSidebar) leftSidebar.classList.toggle("open");
      if (backdrop) backdrop.classList.toggle("open", leftSidebar.classList.contains("open"));
    };
  }

  if (toggleRight) {
    toggleRight.onclick = function (e) {
      e.stopPropagation();
      if (leftSidebar) leftSidebar.classList.remove("open");
      if (rightSidebar) rightSidebar.classList.toggle("open");
      if (backdrop) backdrop.classList.toggle("open", rightSidebar.classList.contains("open"));
    };
  }

  if (backdrop) {
    backdrop.onclick = closeAllDrawers;
  }

  // Bind tools
  document.querySelectorAll(".tool-btn").forEach(btn => {
    btn.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      draggingTool = btn.getAttribute("data-type");
      ghostEl = document.createElement('div');
      ghostEl.className = 'ghost-field';
      ghostEl.innerHTML = btn.innerHTML;
      document.body.appendChild(ghostEl);
      updateGhostPosition(e.clientX, e.clientY);

      // Close drawers on mobile/tablet so the canvas is fully visible and accessible for dropping!
      const leftSidebar = document.getElementById("sidebar-left");
      const rightSidebar = document.getElementById("properties-panel");
      const backdrop = document.getElementById("sidebar-backdrop");
      if (window.innerWidth < 1024) {
        if (leftSidebar) leftSidebar.classList.remove("open");
        if (rightSidebar) rightSidebar.classList.remove("open");
        if (backdrop) backdrop.classList.remove("open");
      }
    };
  });

  // Global pointer events
  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);

  renderPdf();
}

function updateGhostPosition(x, y) {
  if (!ghostEl) return;
  // Center ghost on cursor
  ghostEl.style.left = (x - 40) + 'px';
  ghostEl.style.top = (y - 15) + 'px';
}

function onPointerMove(e) {
  if (draggingTool) {
    updateGhostPosition(e.clientX, e.clientY);
  } else if (draggingField) {
    // Allow the ghost to move freely across the screen during cross-page drag
    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;
    draggingField.box.style.transform = 'translate3d(' + dx + 'px, ' + dy + 'px, 0) scale(0.98)';
  }
}

function onPointerUp(e) {
  if (draggingTool) {
    const pages = document.querySelectorAll('.page-wrap');
    let targetPage = null;
    let targetRect = null;
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetPage = page;
        targetRect = rect;
        break;
      }
    }

    if (targetPage) {
      const pIdx = parseInt(targetPage.dataset.page);
      let x = (e.clientX - targetRect.left) / targetRect.width;
      let y = (e.clientY - targetRect.top) / targetRect.height;

      const recipientId = document.getElementById("recipient").value;
      const r = session.recipients.find(x => x.id === recipientId);

      const newField = {
        id: "new_" + Date.now(),
        recipientId: recipientId,
        type: draggingTool,
        pageIndex: pIdx,
        rect: {
          x: Math.max(0, Math.min(1 - DEFAULT_W, x - DEFAULT_W / 2)),
          y: Math.max(0, Math.min(1 - DEFAULT_H, y - DEFAULT_H / 2)),
          width: DEFAULT_W,
          height: DEFAULT_H,
        },
        label: recipientLabel(r) + " " + draggingTool,
      };
      placed.push(newField);
      renderAllPages();
      selectField(newField);
    }

    if (ghostEl) ghostEl.remove();
    ghostEl = null;
    draggingTool = null;
  }

  if (draggingField) {
    const f = draggingField.f;
    draggingField.box.classList.remove("dragging");

    // Detect which page the pointer was dropped on (supports cross-page drags)
    const pages = document.querySelectorAll('.page-wrap');
    let targetPage = null;
    let targetRect = null;
    for (const page of pages) {
      const rect = page.getBoundingClientRect();
      if (e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top && e.clientY <= rect.bottom) {
        targetPage = page;
        targetRect = rect;
        break;
      }
    }

    if (targetPage) {
      const newPageIndex = parseInt(targetPage.dataset.page);
      // Update position relative to the target page (handles same-page and cross-page)
      f.pageIndex = newPageIndex;
      f.rect.x = Math.max(0, Math.min(1 - f.rect.width, (e.clientX - targetRect.left) / targetRect.width - f.rect.width / 2));
      f.rect.y = Math.max(0, Math.min(1 - f.rect.height, (e.clientY - targetRect.top) / targetRect.height - f.rect.height / 2));
      draggingField = null;
      renderAllPages();
      selectField(f);
      renderPropertiesPanel();
      return;
    }

    // Dropped outside all pages — restore original position
    draggingField.box.style.left = (f.rect.x * 100) + '%';
    draggingField.box.style.top = (f.rect.y * 100) + '%';
    draggingField.box.style.transform = '';

    draggingField = null;
    renderPropertiesPanel();

    // Auto-open settings panel on mobile/tablet when drag is finished
    const rightSidebar = document.getElementById("properties-panel");
    const backdrop = document.getElementById("sidebar-backdrop");
    if (rightSidebar && window.innerWidth < 1024) {
      rightSidebar.classList.add("open");
      if (backdrop) backdrop.classList.add("open");
    }
  }
}

function selectField(f, openPanelOnMobile = true) {
  selectedField = f;

  // Update active selected class in-place for 60fps performance without DOM destruction
  document.querySelectorAll(".field-box").forEach(el => {
    el.classList.remove("selected");
  });
  if (f) {
    const selectedEl = document.querySelector('.field-box[data-id="' + f.id + '"]');
    if (selectedEl) {
      selectedEl.classList.add("selected");
    }
  }

  renderPropertiesPanel();

  // Auto-open settings panel on mobile/tablet if a field is selected
  const rightSidebar = document.getElementById("properties-panel");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (rightSidebar && window.innerWidth < 1024) {
    if (f && openPanelOnMobile) {
      rightSidebar.classList.add("open");
      if (backdrop) backdrop.classList.add("open");
    } else if (!f) {
      rightSidebar.classList.remove("open");
      if (backdrop) backdrop.classList.remove("open");
    }
  }
}

function renderPropertiesPanel() {
  const panel = document.getElementById("properties-panel");
  if (!panel) return;

  if (!selectedField) {
    panel.innerHTML = '<div class="empty-props">Select a field to view properties</div>';
    return;
  }

  const opts = session.recipients
    .map(function (r) {
      const sel = r.id === selectedField.recipientId ? "selected" : "";
      return '<option value="' + esc(r.id) + '" ' + sel + '>' + esc(recipientLabel(r)) + "</option>";
    })
    .join("");

  panel.innerHTML = `
    <h3>Field settings</h3>
    <div class="prop-group">
      <label>Assigned to</label>
      <select id="prop-recipient">${opts}</select>
    </div>
    <div class="prop-group" style="display: flex; gap: 0.5rem;">
      <div style="flex:1;">
        <label>X Position (%)</label>
        <input type="number" id="prop-x" value="${(selectedField.rect.x * 100).toFixed(1)}" />
      </div>
      <div style="flex:1;">
        <label>Y Position (%)</label>
        <input type="number" id="prop-y" value="${(selectedField.rect.y * 100).toFixed(1)}" />
      </div>
    </div>
    <button type="button" class="field-delete-btn" id="prop-delete">Delete Field</button>
  `;

  document.getElementById("prop-recipient").onchange = (e) => {
    selectedField.recipientId = e.target.value;
    renderAllPages();
  };
  document.getElementById("prop-x").onchange = (e) => {
    selectedField.rect.x = Math.max(0, Math.min(1 - DEFAULT_W, parseFloat(e.target.value) / 100));
    renderAllPages();
  };
  document.getElementById("prop-y").onchange = (e) => {
    selectedField.rect.y = Math.max(0, Math.min(1 - DEFAULT_H, parseFloat(e.target.value) / 100));
    renderAllPages();
  };
  document.getElementById("prop-delete").onclick = () => {
    const idx = placed.indexOf(selectedField);
    if (idx >= 0) placed.splice(idx, 1);
    selectedField = null;
    renderPropertiesPanel();
    renderAllPages();
  };
}

async function renderPdf() {
  const url = "/embed/api/document?token=" + encodeURIComponent(token);
  const pdf = await pdfjsLib.getDocument(url).promise;
  const container = document.getElementById("pages");
  container.innerHTML = "";

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const scale = 1.35;
    const viewport = page.getViewport({ scale: scale });
    const wrap = document.createElement("div");
    wrap.className = "page-wrap";
    wrap.dataset.page = String(p - 1);
    wrap.style.width = viewport.width + "px";
    wrap.style.height = viewport.height + "px";
    wrap.style.marginBottom = "2rem";

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    wrap.appendChild(canvas);
    container.appendChild(wrap);

    await page.render({ canvasContext: canvas.getContext("2d"), viewport: viewport }).promise;

    // Deselect if clicking on empty page
    wrap.addEventListener("pointerdown", function (ev) {
      if (!ev.target.closest(".field-box")) {
        selectField(null);
      }
    });

    renderFieldOverlays(wrap, p - 1);
  }
}

function renderFieldOverlays(wrap, pageIndex) {
  wrap.querySelectorAll(".field-box").forEach(function (el) {
    el.remove();
  });

  placed
    .filter(function (f) {
      return f.pageIndex === pageIndex;
    })
    .forEach(function (f) {
      const r = session.recipients.find(function (x) {
        return x.id === f.recipientId;
      });
      const box = document.createElement("div");

      let cls = "field-box " + colorClass(f.recipientId);
      if (selectedField === f) cls += " selected";

      box.className = cls;
      box.dataset.id = f.id;
      box.style.left = f.rect.x * 100 + "%";
      box.style.top = f.rect.y * 100 + "%";
      box.style.width = f.rect.width * 100 + "%";
      box.style.height = f.rect.height * 100 + "%";

      const recipientName = r ? recipientLabel(r) : 'Unassigned';
      const typeIcons = {
        signature: '✍️',
        initials: '🔤',
        text: '📝',
        date: '📅'
      };
      const icon = typeIcons[f.type] || '⚙️';
      const formattedType = f.type === 'text' ? 'Textbox' : (f.type.charAt(0).toUpperCase() + f.type.slice(1));

      box.innerHTML =
        '<div class="field-recipient-tag">' + esc(recipientName) + '</div>' +
        '<div class="field-content">' +
        '<span class="field-icon">' + icon + '</span>' +
        '<span class="field-label-text">' + esc(formattedType) + '</span>' +
        '</div>' +
        '<div class="resize-handle"></div>';

      box.onpointerdown = function (ev) {
        if (ev.button !== 0) return;
        ev.stopPropagation();

        // Select visually without triggering settings drawer slide-in on mobile/tablet immediately
        selectField(f, false);
        box.classList.add("dragging");
        box.style.transform = 'scale(0.98)';

        // Start dragging with cached parent dimensions for maximum smoothness (60fps)
        draggingField = { f: f, box: box, wrap: wrap, wrapRect: wrap.getBoundingClientRect() };
        pointerStartX = ev.clientX;
        pointerStartY = ev.clientY;
        fieldStartX = f.rect.x;
        fieldStartY = f.rect.y;
      };

      wrap.appendChild(box);
    });
}

function renderAllPages() {
  document.querySelectorAll(".page-wrap").forEach(function (wrap) {
    renderFieldOverlays(wrap, Number(wrap.dataset.page));
  });
}

async function saveFields() {
  const res = await fetch("/embed/api/request/fields", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: token,
      fields: placed.map(function (f) {
        return {
          recipientId: f.recipientId,
          type: f.type,
          pageIndex: f.pageIndex,
          rect: f.rect,
          required: true,
          label: f.label,
        };
      }),
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed");
  placed = data.fields.map(function (f) {
    return {
      id: f.id,
      recipientId: f.recipientId,
      type: f.type,
      pageIndex: f.pageIndex,
      rect: f.rect,
      label: f.label,
    };
  });
}

async function finishRequest() {
  try {
    const finishBtn = document.getElementById("finish");
    finishBtn.disabled = true;
    finishBtn.textContent = "Sent";

    await saveFields();
    const res = await fetch("/embed/api/request/finish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    });

    const data = await res.json();

    if (!res.ok) {
      const isIframe = window.self !== window.top;
      finishBtn.disabled = false;
      finishBtn.textContent = "Send";
      if (isIframe) {
        console.log('no sign');
        const res = window.parent.postMessage({
          type: 'IFRAME_HAS_SIGN',
          message: data.error.message || "Could not send" // Passes the actual error coming from your backend server
        }, '*');
        console.log('res', res);
        return;
      } else {
        throw new Error(data.error || "Could not send");
      }
    }

    //const links = (data.signingSessions || [])
    //  .map(function (s) {
    //    return (
    //      "<li><strong>" +
    //      esc(s.recipientName || s.recipientEmail) +
    //      '</strong>: <a href="' +
    //      esc(s.embedUrl) +
    //      '" target="_blank" rel="noopener">Open signing link</a></li>'
    //    );
    //  })
    //  .join("");

    const step2Body = document.querySelector(".step2-body");
    step2Body.innerHTML = `
      <div style="padding: 3rem; margin: 0 auto; width: 100%; max-width: 600px; font-family: sans-serif;">
        <div class="done" style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 3rem 2rem; border-radius: 8px; text-align: center;">
          
          <p style="margin: 0; color: #166534; font-size: 1.25rem; font-weight: bold;">
            Success! Signatures have been placed successfully.
          </p>

        </div>
      </div>
    `;

    if (window.parent !== window) {
      console.log('not window');
      window.parent.postMessage(
        { type: "esign.request.completed", envelopeId: data.envelopeId },
        "*"
      );
    } else {
      console.log('window');
    }
  } catch (e) {
    alert(e.message);
    const finishBtn = document.getElementById("finish");
    if (finishBtn) {
      finishBtn.disabled = false;
      finishBtn.textContent = "Send";
    }
  }
}


async function main() {
  if (!token) {
    app.innerHTML = '<div class="error">Missing token.</div>';
    return;
  }
  try {
    await loadSession();
    renderStep1();
  } catch (e) {
    app.innerHTML = '<div class="error">' + esc(e.message) + "</div>";
  }
}

main();
