/**
 * Sidebar Notes+ - Features Extension
 * Toolbar, Image Editor, Export/Import, Password, Download
 */

// Extend NotesApp with toolbar and feature methods
Object.assign(NotesApp.prototype, {

    setupToolbar(toolbar, editor) {
        toolbar.addEventListener('mousedown', (e) => {
            if (e.target.closest('.toolbar-btn')) e.preventDefault();
        });
        toolbar.addEventListener('click', async (e) => {
            const btn = e.target.closest('.toolbar-btn');
            const colorOpt = e.target.closest('.color-option');

            if (colorOpt && this.currentEditingNote) {
                const color = colorOpt.dataset.color;
                await this.storage.updateNote(this.currentEditingNote, { color });
                const noteBlock = document.querySelector(`[data-note-id="${this.currentEditingNote}"]`);
                if (noteBlock) noteBlock.style.borderLeft = color ? `4px solid ${color}` : '';
                document.getElementById(`color-dropdown-${this.currentEditingNote}`)?.classList.add('hidden');
                return;
            }

            if (!btn) return;
            const action = btn.dataset.action;
            switch (action) {
                case 'bold': editor.focus(); document.execCommand('bold'); break;
                case 'italic': editor.focus(); document.execCommand('italic'); break;
                case 'underline': editor.focus(); document.execCommand('underline'); break;
                case 'strikeThrough': editor.focus(); document.execCommand('strikeThrough'); break;
                case 'ul':
                case 'insertUnorderedList': editor.focus(); document.execCommand('insertUnorderedList'); break;
                case 'ol':
                case 'insertOrderedList': editor.focus(); document.execCommand('insertOrderedList'); break;
                case 'formatBlock':
                    editor.focus();
                    document.execCommand('formatBlock', false, btn.dataset.value);
                    break;
                case 'createLink': {
                    const url = prompt('Enter link URL:', 'https://');
                    if (url) { editor.focus(); document.execCommand('createLink', false, url); }
                    break;
                }
                case 'insert-image': {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = 'image/*';
                    input.onchange = async (ev) => {
                        const file = ev.target.files[0];
                        if (!file) return;
                        try {
                            const base64 = await this.fileToBase64(file);
                            const imageId = await this.storage.addImage(this.currentEditingNote, base64);
                            if (imageId) {
                                editor.focus();
                                this.insertImageElement(base64, imageId);
                            }
                        } catch (err) {
                            console.error('Failed to insert file image:', err);
                        }
                    };
                    input.click();
                    break;
                }
                case 'clear-format':
                    editor.focus(); document.execCommand('removeFormat');
                    this.normalizeInlineStyles(editor);
                    break;
                case 'lock': this.handleLockAction(); break;
                case 'color-menu':
                    const drp = document.getElementById(`color-dropdown-${this.currentEditingNote}`);
                    if (drp) drp.classList.toggle('hidden');
                    break;
            }
        });

        // Close dropdowns on outside click
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.color-picker-wrapper')) {
                document.querySelectorAll('.color-dropdown').forEach(d => d.classList.add('hidden'));
            }
        });
    },



    // Lock/Unlock
    async handleLockAction() {
        if (!this.currentEditingNote) return;
        const note = await this.storage.getNote(this.currentEditingNote);
        if (!note) return;

        if (note.passwordHash) {
            // Already locked - offer to unlock
            if (confirm('Remove password protection from this note?')) {
                await this.storage.removeNotePassword(this.currentEditingNote);
                this.unlockedNotes.delete(this.currentEditingNote);
                this.updateLockButton(false);
            }
        } else {
            this.showPasswordModal('set', this.currentEditingNote);
        }
    },

    updateLockButton(isLocked) {
        const lockBtn = document.querySelector('[data-action="lock"]');
        if (!lockBtn) return;
        if (isLocked) {
            lockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
            lockBtn.title = 'Unlock Note';
        } else {
            lockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>';
            lockBtn.title = 'Lock Note';
        }
    },

    showPasswordModal(mode, noteId) {
        this._passwordMode = mode;
        this._passwordNoteId = noteId;
        const modal = document.getElementById('password-modal');
        const title = document.getElementById('password-modal-title');
        const confirmGroup = document.getElementById('password-confirm-group');
        const errorEl = document.getElementById('password-error');

        document.getElementById('password-input').value = '';
        document.getElementById('password-confirm').value = '';
        errorEl.classList.add('hidden');

        if (mode === 'set') {
            title.textContent = 'Set Password';
            confirmGroup.style.display = 'block';
        } else {
            title.textContent = 'Enter Password';
            confirmGroup.style.display = 'none';
        }
        modal.classList.remove('hidden');
        setTimeout(() => document.getElementById('password-input').focus(), 100);
    },

    hidePasswordModal() {
        document.getElementById('password-modal').classList.add('hidden');
        this._passwordMode = null;
        this._passwordNoteId = null;
    },

    async handlePasswordSubmit() {
        const pw = document.getElementById('password-input').value;
        const errorEl = document.getElementById('password-error');
        errorEl.classList.add('hidden');

        if (!pw) { errorEl.textContent = 'Password required'; errorEl.classList.remove('hidden'); return; }

        if (this._passwordMode === 'set') {
            const confirm = document.getElementById('password-confirm').value;
            if (pw !== confirm) { errorEl.textContent = 'Passwords do not match'; errorEl.classList.remove('hidden'); return; }
            const hash = await this.storage.hashPassword(pw);
            await this.storage.setNotePassword(this._passwordNoteId, hash);
            this.updateLockButton(true);
            this.hidePasswordModal();
        } else if (this._passwordMode === 'unlock') {
            const note = await this.storage.getNote(this._passwordNoteId);
            const hash = await this.storage.hashPassword(pw);
            if (hash === note.passwordHash) {
                this.unlockedNotes.add(this._passwordNoteId);
                this.hidePasswordModal();

                // Refresh the entire note block to update preview and remove 'locked' styling
                const noteBlock = document.querySelector(`[data-note-id="${this._passwordNoteId}"]`);
                if (noteBlock) {
                    const tempNote = this.createNoteHTML(note);
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = tempNote;
                    noteBlock.replaceWith(tempDiv.firstElementChild);
                    this.attachNoteEventListeners();
                }

                // Automatically open it
                this.editNote(this._passwordNoteId);
            } else {
                errorEl.textContent = 'Incorrect password';
                errorEl.classList.remove('hidden');
            }
        }
    },

    // Image click handlers
    setupImageClickHandlers(editor) {
        editor.addEventListener('click', (e) => {
            const img = e.target.closest('img.note-image');
            // Remove any existing action bars
            document.querySelectorAll('.image-action-bar').forEach(el => el.remove());
            if (!img) return;

            const bar = document.createElement('div');
            bar.className = 'image-action-bar';
            bar.innerHTML = `
                <button class="img-action-btn" data-img-action="edit" title="Edit">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Edit
                </button>
                <button class="img-action-btn" data-img-action="download" title="Download">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7,10 12,15 17,10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                    Download
                </button>
                <button class="img-action-btn" data-img-action="delete" title="Delete" style="color:#ff6b6b">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path></svg>
                    Delete
                </button>`;

            bar.style.cssText = `position:absolute;z-index:100;`;
            img.parentNode.style.position = 'relative';
            img.parentNode.insertBefore(bar, img.nextSibling);

            // Position bar below the image
            const rect = img.getBoundingClientRect();
            const parentRect = img.parentNode.getBoundingClientRect();
            bar.style.top = (rect.bottom - parentRect.top + 4) + 'px';
            bar.style.left = (rect.left - parentRect.left) + 'px';

            bar.addEventListener('click', (ev) => {
                const action = ev.target.closest('[data-img-action]')?.dataset.imgAction;
                if (action === 'download') {
                    const a = document.createElement('a');
                    a.href = img.src;
                    a.download = `image_${img.dataset.imageId || 'download'}.png`;
                    document.body.appendChild(a); a.click(); document.body.removeChild(a);
                    bar.remove();
                }
                if (action === 'delete') {
                    if (confirm('Delete this image?')) {
                        const br = img.nextElementSibling;
                        if (br && br.tagName === 'BR') br.remove();
                        img.remove();
                        bar.remove();
                        this.autoSaveNote();
                    }
                }
                if (action === 'edit') {
                    bar.remove();
                    this.openImageEditor(img);
                }
            });
        });
    },

    // This block is for the auto-title feature, replacing a previous 'deleteEmptyBtn' or similar utility.
    setupAutoTitleButton() {
        const autoTitleBtn = document.getElementById('auto-title-btn');
        if (autoTitleBtn) {
            autoTitleBtn.addEventListener('click', async () => {
                this.hideMenu(); // Assuming 'app' refers to 'this' in the context of NotesApp.prototype
                const notes = await this.storage.getAllNotes();
                let renamedCount = 0;

                for (const n of notes) {
                    // If the title is generic or blank, attempt auto-title
                    if (!n.title.trim() || n.title.trim() === 'Untitled Note') {
                        // Extract first readable text
                        const tmp = document.createElement('div');
                        tmp.innerHTML = this.convertMarkdownToHtml(n.content, {});
                        const text = (tmp.textContent || '').trim();

                        if (text.length > 0) {
                            const firstLine = text.split('\n')[0].trim();
                            // Truncate to a reasonable length
                            const newTitle = firstLine.length > 40 ? firstLine.substring(0, 40) + '...' : firstLine;
                            await this.storage.updateNote(n.id, { title: newTitle });
                            renamedCount++;
                        }
                    }
                }

                if (renamedCount > 0) {
                    await this.loadAndDisplayNotes();
                } else {
                    alert('No generic notes found to rename.');
                }
            });
        }
    },

    // Hook up link interaction popup (Copy / Open)
    setupLinkInteraction(editor) {
        editor.addEventListener('click', (e) => {
            const link = e.target.closest('a');
            if (!link || !link.href) return;

            // Direct open if Ctrl/Cmd is held
            if (e.ctrlKey || e.metaKey) {
                window.open(link.href, '_blank');
                return;
            }

            // Prevent default navigation for normal click to show popup
            e.preventDefault();

            // Remove any existing action bars
            document.querySelectorAll('.link-action-bar').forEach(el => el.remove());

            const bar = document.createElement('div');
            bar.className = 'link-action-bar';
            bar.innerHTML = `
                <button class="link-action-btn" data-link-action="open" title="Open Link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                    Open
                </button>
                <button class="link-action-btn" data-link-action="copy" title="Copy Link">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    Copy
                </button>`;

            bar.style.cssText = `position:absolute;z-index:100;`;
            link.parentNode.style.position = 'relative';
            link.parentNode.insertBefore(bar, link.nextSibling);

            // Position bar below the link
            const rect = link.getBoundingClientRect();
            const parentRect = link.parentNode.getBoundingClientRect();
            bar.style.top = (rect.bottom - parentRect.top + 4) + 'px';
            bar.style.left = (rect.left - parentRect.left) + 'px';

            bar.addEventListener('click', (ev) => {
                const action = ev.target.closest('[data-link-action]')?.dataset.linkAction;
                if (action === 'open') {
                    window.open(link.href, '_blank');
                } else if (action === 'copy') {
                    navigator.clipboard.writeText(link.href).then(() => {
                        // Optional: show a temporary "Copied!" message
                    }).catch(err => {
                        console.error('Failed to copy link: ', err);
                    });
                }
                bar.remove();
            });

            // Close dropdowns on outside click
            const closeLinkBar = (e) => {
                if (!e.target.closest('.link-action-bar') && !e.target.closest('a')) {
                    bar.remove();
                    document.removeEventListener('click', closeLinkBar);
                }
            };
            document.addEventListener('click', closeLinkBar);
        });
    },

    // Image Editor
    openImageEditor(imgElement) {
        const modal = document.getElementById('image-editor-modal');
        const canvas = document.getElementById('image-editor-canvas');
        const ctx = canvas.getContext('2d');

        this._editingImage = imgElement;
        this._originalImageSrc = imgElement.src;
        this._editorMode = 'none'; // 'crop' or 'draw'
        this._drawPaths = [];
        this._cropRect = null;

        const img = new Image();
        img.onload = () => {
            const maxW = Math.min(img.width, 600);
            const scale = maxW / img.width;
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            this._editorScale = scale;
            this._editorImage = img;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        img.src = imgElement.src;
        modal.classList.remove('hidden');

        // Setup editor toolbar
        this._setupEditorEvents(canvas, ctx);

        // Editor buttons
        document.getElementById('image-editor-close').onclick = () => this.closeImageEditor();
        document.getElementById('image-editor-cancel').onclick = () => this.closeImageEditor();
        document.getElementById('image-editor-save').onclick = () => this.saveImageEdit();

        document.querySelectorAll('[data-editor-action]').forEach(btn => {
            btn.onclick = () => {
                const action = btn.dataset.editorAction;
                if (action === 'crop') { this._editorMode = 'crop'; canvas.style.cursor = 'crosshair'; }
                if (action === 'draw') { this._editorMode = 'draw'; canvas.style.cursor = 'crosshair'; }
                if (action === 'reset') {
                    this._drawPaths = []; this._cropRect = null;
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(this._editorImage, 0, 0, canvas.width, canvas.height);
                }
            };
        });
    },

    _setupEditorEvents(canvas, ctx) {
        let drawing = false, startX, startY, currentPath = [];

        const onMouseDown = (e) => {
            const rect = canvas.getBoundingClientRect();
            startX = e.clientX - rect.left; startY = e.clientY - rect.top;
            drawing = true;
            if (this._editorMode === 'draw') currentPath = [{ x: startX, y: startY }];
        };
        const onMouseMove = (e) => {
            if (!drawing) return;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;

            if (this._editorMode === 'crop') {
                this._redrawEditor(ctx, canvas);
                ctx.strokeStyle = '#0969da'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
                ctx.strokeRect(startX, startY, x - startX, y - startY);
                ctx.setLineDash([]);
            }
            if (this._editorMode === 'draw') {
                currentPath.push({ x, y });
                this._redrawEditor(ctx, canvas);
                const color = document.getElementById('editor-draw-color')?.value || '#ff0000';
                const size = parseInt(document.getElementById('editor-draw-size')?.value || 3);
                ctx.strokeStyle = color; ctx.lineWidth = size; ctx.lineCap = 'round';
                ctx.beginPath(); ctx.moveTo(currentPath[0].x, currentPath[0].y);
                currentPath.forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
            }
        };
        const onMouseUp = (e) => {
            if (!drawing) return; drawing = false;
            const rect = canvas.getBoundingClientRect();
            const x = e.clientX - rect.left, y = e.clientY - rect.top;

            if (this._editorMode === 'crop') {
                this._cropRect = { x: Math.min(startX, x), y: Math.min(startY, y), w: Math.abs(x - startX), h: Math.abs(y - startY) };
                this._redrawEditor(ctx, canvas);
                // Show crop outline
                ctx.strokeStyle = '#0969da'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
                ctx.strokeRect(this._cropRect.x, this._cropRect.y, this._cropRect.w, this._cropRect.h);
                ctx.setLineDash([]);
            }
            if (this._editorMode === 'draw' && currentPath.length > 1) {
                const color = document.getElementById('editor-draw-color')?.value || '#ff0000';
                const size = parseInt(document.getElementById('editor-draw-size')?.value || 3);
                this._drawPaths.push({ points: [...currentPath], color, width: size });
                currentPath = [];
            }
        };

        canvas.onmousedown = onMouseDown;
        canvas.onmousemove = onMouseMove;
        canvas.onmouseup = onMouseUp;
    },

    _redrawEditor(ctx, canvas) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (this._editorImage) ctx.drawImage(this._editorImage, 0, 0, canvas.width, canvas.height);
        for (const p of this._drawPaths) {
            ctx.strokeStyle = p.color; ctx.lineWidth = p.width; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(p.points[0].x, p.points[0].y);
            p.points.forEach(pt => ctx.lineTo(pt.x, pt.y)); ctx.stroke();
        }
    },

    async saveImageEdit() {
        const canvas = document.getElementById('image-editor-canvas');
        let resultCanvas = canvas;

        // If crop is set, extract cropped area
        if (this._cropRect && this._cropRect.w > 5 && this._cropRect.h > 5) {
            const cropCanvas = document.createElement('canvas');
            cropCanvas.width = this._cropRect.w;
            cropCanvas.height = this._cropRect.h;
            const cropCtx = cropCanvas.getContext('2d');
            cropCtx.drawImage(canvas, this._cropRect.x, this._cropRect.y, this._cropRect.w, this._cropRect.h, 0, 0, this._cropRect.w, this._cropRect.h);
            resultCanvas = cropCanvas;
        }

        const dataUrl = resultCanvas.toDataURL('image/png');

        // Save original if not already saved
        if (this._editingImage && this._editingImage.dataset.imageId) {
            const id = this._editingImage.dataset.imageId;
            const note = await this.storage.getNote(this.currentEditingNote);
            if (note && note.images[id] && !note.images[id + '_original']) {
                await this.storage.updateNote(this.currentEditingNote, {
                    images: { [id + '_original']: this._originalImageSrc }
                });
            }
            // Update the image
            this._editingImage.src = dataUrl;
            await this.storage.updateNote(this.currentEditingNote, { images: { [id]: dataUrl } });
        }
        this.closeImageEditor();
        this.autoSaveNote();
    },

    closeImageEditor() {
        document.getElementById('image-editor-modal').classList.add('hidden');
        this._editingImage = null; this._editorMode = 'none';
        this._drawPaths = []; this._cropRect = null;
    },

    // Obfuscation for export
    _obfuscate(text, key) {
        if (!text || !key) return text;
        let out = '';
        for (let i = 0; i < text.length; i++) {
            out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
        }
        return btoa(unescape(encodeURIComponent(out)));
    },
    _deobfuscate(b64, key) {
        if (!b64 || !key) return b64;
        try {
            const text = decodeURIComponent(escape(atob(b64)));
            let out = '';
            for (let i = 0; i < text.length; i++) {
                out += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
            }
            return out;
        } catch (e) { return b64; }
    },

    // Export
    async exportNotes() {
        try {
            const notes = await this.storage.getAllNotes();
            const dateStr = new Date().toISOString().split('T')[0];
            const zip = new JSZip();
            const allImages = new Map();

            for (const note of notes) {
                if (note.images) {
                    for (const [id, b64] of Object.entries(note.images)) {
                        if (!allImages.has(id)) allImages.set(id, b64);
                    }
                }
            }

            const exportData = {
                version: '2.0', exportDate: new Date().toISOString(),
                totalNotes: notes.length, totalImages: allImages.size,
                notes: notes.map(n => {
                    const isLocked = !!n.passwordHash;
                    const content = isLocked ? this._obfuscate(n.content, n.passwordHash) : n.content;
                    return {
                        id: n.id, title: n.title,
                        content: content,
                        createdAt: n.createdAt, modifiedAt: n.modifiedAt,
                        images: n.images ? Object.keys(n.images) : [],
                        passwordHash: n.passwordHash || null,
                        isEncrypted: isLocked,
                        isPinned: !!n.isPinned,
                        color: n.color || ''
                    };
                })
            };

            zip.file('notes.json', JSON.stringify(exportData, null, 2));

            const imagesFolder = zip.folder('images');
            for (const [id, b64] of allImages) {
                const data = b64.split(',')[1];
                const ext = this.getImageExtension(b64);
                if (data) imagesFolder.file(`${id}.${ext}`, data, { base64: true });
            }

            const blob = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `sidebar-notes-${dateStr}.anotes`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            this.hideMenu();
        } catch (e) { console.error('Export error:', e); }
    },

    getImageExtension(b64) {
        if (b64.startsWith('data:image/png')) return 'png';
        if (b64.startsWith('data:image/jpeg') || b64.startsWith('data:image/jpg')) return 'jpg';
        if (b64.startsWith('data:image/gif')) return 'gif';
        if (b64.startsWith('data:image/webp')) return 'webp';
        return 'png';
    },

    importNotes() { document.getElementById('import-file').click(); this.hideMenu(); },

    async handleFileImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        try {
            if (file.name.endsWith('.anotes')) await this.importAnotesFile(file);
            else if (file.name.endsWith('.json')) {
                const content = await this.readFile(file);
                await this.storage.importFromJSON(content);
            }
            await this.loadAndDisplayNotes();
        } catch (e) { console.error('Import error:', e); }
        event.target.value = '';
    },

    async importAnotesFile(file) {
        const zip = new JSZip();
        const z = await zip.loadAsync(file);
        const nf = z.file('notes.json');
        if (!nf) throw new Error('Invalid .anotes file');
        const data = JSON.parse(await nf.async('string'));

        const imageFiles = {};
        for (const [fn, fo] of Object.entries(z.files)) {
            if (fn.startsWith('images/') && !fo.dir) {
                const id = fn.split('/')[1].split('.')[0];
                const b64 = await fo.async('base64');
                const ext = fn.split('.').pop();
                const mime = this.getMimeType(ext);
                imageFiles[id] = `data:${mime};base64,${b64}`;
            }
        }

        const notesToImport = data.notes.map(n => {
            const content = n.isEncrypted && n.passwordHash ? this._deobfuscate(n.content, n.passwordHash) : n.content;
            return {
                id: n.id, title: n.title, content: content,
                createdAt: n.createdAt, modifiedAt: n.modifiedAt,
                passwordHash: n.passwordHash || null,
                isPinned: !!n.isPinned,
                color: n.color || '',
                images: n.images ? n.images.reduce((acc, id) => {
                    if (imageFiles[id]) acc[id] = imageFiles[id];
                    return acc;
                }, {}) : {}
            };
        });

        const existing = await this.storage.getAllNotes();
        await this.storage.saveAllNotes([...notesToImport, ...existing]);
    },

    getMimeType(ext) {
        const map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
        return map[ext.toLowerCase()] || 'image/png';
    },

    readFile(file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = (e) => resolve(e.target.result);
            r.onerror = reject;
            r.readAsText(file);
        });
    },

    async clearAllNotes() {
        const notes = await this.storage.getAllNotes();
        if (notes.length === 0) return;
        if (!confirm('Delete all notes? This cannot be undone.')) return;
        await this.storage.clearAllNotes();
        await this.loadAndDisplayNotes();
        this.hideMenu();
    }
});
