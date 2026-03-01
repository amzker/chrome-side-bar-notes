/**
 * Sidebar Notes+ - Core Application
 */
class NotesApp {
    constructor() {
        this.storage = new NotesStorage();
        this.currentEditingNote = null;
        this.searchQuery = '';
        this.unlockedNotes = new Set();
        this.init();
    }

    async init() {
        this.initTheme();
        this.setupEventListeners();
        this.setupMarkdown();
        this.setupMessageListener();
        if (this.setupAutoTitleButton) this.setupAutoTitleButton();
        this.setupDeleteEmptyButton();
        await this.loadAndDisplayNotes();
    }

    setupMessageListener() {
        try {
            chrome.runtime.onMessage.addListener((msg) => {
                if (msg.type === 'screenshot-result' && msg.dataUrl) {
                    this.insertImageIntoEditor(msg.dataUrl);
                }
                if (msg.type === 'drawing-result' && msg.dataUrl) {
                    this.insertImageIntoEditor(msg.dataUrl);
                }
                if (msg.type === 'color-pick-result' && msg.color) {
                    const colorInput = document.getElementById('editor-draw-color');
                    if (colorInput) colorInput.value = this.rgbToHex(msg.color);
                }
            });
        } catch (e) {
            console.log('Message listener setup deferred');
        }
    }

    rgbToHex(rgb) {
        if (rgb.startsWith('#')) return rgb;
        const m = rgb.match(/\d+/g);
        if (!m || m.length < 3) return '#000000';
        return '#' + m.slice(0, 3).map(x => parseInt(x).toString(16).padStart(2, '0')).join('');
    }



    setupEventListeners() {
        document.getElementById('new-note-btn').addEventListener('click', () => this.createNewNote());
        document.getElementById('search-btn').addEventListener('click', () => this.toggleSearch());
        document.getElementById('menu-btn').addEventListener('click', () => this.toggleMenu());
        document.getElementById('search-input').addEventListener('input', (e) => this.handleSearch(e.target.value));
        document.getElementById('clear-search').addEventListener('click', () => this.clearSearch());
        document.getElementById('export-json-btn').addEventListener('click', () => this.exportNotes());
        document.getElementById('import-json-btn').addEventListener('click', () => this.importNotes());
        document.getElementById('settings-btn').addEventListener('click', () => this.showSettings());
        document.getElementById('clear-all-btn').addEventListener('click', () => this.clearAllNotes());
        document.getElementById('import-file').addEventListener('change', (e) => this.handleFileImport(e));
        document.getElementById('settings-close').addEventListener('click', () => this.hideSettings());
        document.getElementById('settings-save').addEventListener('click', () => this.saveSettings());
        document.getElementById('password-close').addEventListener('click', () => this.hidePasswordModal());
        document.getElementById('password-cancel').addEventListener('click', () => this.hidePasswordModal());
        document.getElementById('password-submit').addEventListener('click', () => this.handlePasswordSubmit());

        document.querySelectorAll('.color-preset').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.getElementById('theme-color').value = e.target.dataset.color;
                this.previewTheme(e.target.dataset.color);
            });
        });
        document.getElementById('theme-color').addEventListener('input', (e) => this.previewTheme(e.target.value));

        document.addEventListener('click', (e) => {
            if (!e.target.closest('.menu-dropdown') && !e.target.closest('#menu-btn')) this.hideMenu();
            if (this.currentEditingNote && e.target.closest('.notes-container') && !e.target.closest('.note-block.editing')) {
                this.closeEditor();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.currentEditingNote) this.closeEditor();
        });
    }

    setupMarkdown() {
        marked.setOptions({
            highlight: function (code, lang) {
                if (lang && hljs.getLanguage(lang)) {
                    try { return hljs.highlight(code, { language: lang }).value; } catch (e) { }
                }
                return hljs.highlightAuto(code).value;
            },
            breaks: true, gfm: true
        });
    }

    async performSearch(query) {
        if (!query) { this.loadAndDisplayNotes(); return; }
        const q = query.toLowerCase();
        const notes = await this.storage.getAllNotes();
        const filtered = [];
        for (const n of notes) {
            let matches = false;
            let titleMatch = n.title.toLowerCase().includes(q);

            if (titleMatch) {
                matches = true;
            } else if (n.passwordHash && !this.unlockedNotes.has(n.id)) {
                // Skips locked notes for content search
            } else {
                const text = this.stripHtml(this.convertMarkdownToHtml(n.content, {}));
                if (text.toLowerCase().includes(q)) matches = true;
            }
            if (matches) filtered.push(n);
        }

        const container = document.getElementById('notes-container');
        if (filtered.length === 0) {
            container.innerHTML = '<div style="padding:16px;text-align:center;color:#b3b3b3;">No matches found</div>';
            return;
        }

        container.innerHTML = filtered.map(note => {
            const html = this.createNoteHTML(note);
            const div = document.createElement('div'); div.innerHTML = html;
            const block = div.firstElementChild;

            // Highlight title if matched
            if (note.title.toLowerCase().includes(q)) {
                const titleEl = block.querySelector('.note-title');
                if (titleEl) {
                    const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
                    // We must be careful not to overwrite the lock/pin icons, so we only replace text nodes carefully
                    // Or simply re-render it
                    const textContent = this.escapeHtml(note.title);
                    const highlightedTitle = textContent.replace(regex, '<mark>$1</mark>');
                    const pinIcon = note.isPinned ? '<svg class="pinned-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>' : '';
                    const lockIcon = note.passwordHash ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' : '';
                    titleEl.innerHTML = pinIcon + lockIcon + highlightedTitle;
                }
            }

            // Highlight content if matched
            if (!note.passwordHash || this.unlockedNotes.has(note.id)) {
                const preview = block.querySelector('.note-preview');
                const regex = new RegExp(`(${this.escapeRegExp(query)})`, 'gi');
                this.highlightTextNodes(preview, regex);

                // Expand block to show content match auto
                if (preview.innerHTML.includes('<mark>')) {
                    const contentDiv = block.querySelector('.note-content');
                    if (contentDiv) contentDiv.classList.add('expanded');
                }
            }
            return div.innerHTML;
        }).join('');
        this.attachNoteEventListeners();
    }
    async loadAndDisplayNotes() {
        const notes = await this.storage.getAllNotes();
        this.displayNotes(notes);
    }

    displayNotes(notes) {
        const container = document.getElementById('notes-container');
        const emptyState = document.getElementById('empty-state');
        if (notes.length === 0) { container.innerHTML = ''; emptyState.style.display = 'block'; return; }
        emptyState.style.display = 'none';

        const pinnedNotes = notes.filter(n => n.isPinned);
        const unpinnedNotes = notes.filter(n => !n.isPinned);

        let html = '';
        if (pinnedNotes.length > 0) {
            html += `<div class="note-section-title">📌 Pinned Notes</div>
                     <div class="note-section-container">
                        ${pinnedNotes.map(note => this.createNoteHTML(note)).join('')}
                     </div>`;
            if (unpinnedNotes.length > 0) {
                html += `<div class="note-section-title" style="margin-top: 16px;">Other Notes</div>`;
            }
        }

        if (unpinnedNotes.length > 0) {
            html += `<div class="note-section-container">
                        ${unpinnedNotes.map(note => this.createNoteHTML(note)).join('')}
                     </div>`;
        }

        container.innerHTML = html;
        this.attachNoteEventListeners();
    }

    createNoteHTML(note) {
        const date = this.formatDate(note.modifiedAt);
        const isLocked = !!note.passwordHash;
        const lockIcon = isLocked ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' : '';
        const pinIcon = note.isPinned ? '<svg class="pinned-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>' : '';
        const preview = isLocked && !this.unlockedNotes.has(note.id)
            ? '<p style="color:#656d76;font-style:italic;">This note is locked</p>'
            : this.createPreview(note);

        const copyBtn = isLocked ? '' : `<button class="note-action-btn" data-action="copy" data-note-id="${note.id}" title="Copy Content"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>`;
        const borderStyle = note.color ? `border-left: 4px solid ${note.color};` : '';

        return `<div class="note-block${isLocked ? ' locked' : ''}" data-note-id="${note.id}" style="${borderStyle}">
            <div class="note-header" data-action="toggle" data-note-id="${note.id}">
                <div class="note-title">
                    <input type="checkbox" class="note-select-cb" data-note-id="${note.id}">
                    ${pinIcon}${lockIcon}${this.escapeHtml(note.title)}
                </div>
                <div class="note-actions">
                    <button class="note-action-btn" data-action="edit" data-note-id="${note.id}" title="Edit">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    ${copyBtn}
                    <button class="note-action-btn" data-action="pin" data-note-id="${note.id}" title="${note.isPinned ? 'Unpin' : 'Pin'}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="${note.isPinned ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16h14v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"></path></svg>
                    </button>
                </div>
                <span class="note-meta">${date}</span>
            </div>
            <div class="note-content" id="content-${note.id}">
                <div class="note-preview markdown-content">${preview}</div>
            </div>
        </div>`;
    }

    createPreview(note) {
        if (!note.content.trim()) return '<p style="color:#656d76;font-style:italic;">Empty note</p>';
        const html = this.convertMarkdownToHtml(note.content, note.images);
        const tmp = document.createElement('div'); tmp.innerHTML = html;
        const text = tmp.textContent || '';
        if (text.length > 200) return this.convertMarkdownToHtml(note.content.substring(0, 200) + '...', note.images);
        return html;
    }

    attachNoteEventListeners() {
        const container = document.getElementById('notes-container');
        container.removeEventListener('click', this.handleNoteClick);
        this.handleNoteClick = this.handleNoteClick.bind(this);
        container.addEventListener('click', this.handleNoteClick);

        // Checkbox logic
        const updateDeleteBtnState = () => {
            const anyChecked = document.querySelectorAll('.note-select-cb:checked').length > 0;
            const delBtn = document.getElementById('delete-selected-btn');
            if (delBtn) {
                if (anyChecked) delBtn.classList.remove('hidden');
                else delBtn.classList.add('hidden');
            }
        };

        container.querySelectorAll('.note-select-cb').forEach(cb => {
            cb.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevents note toggle
            });
            cb.addEventListener('change', updateDeleteBtnState);
        });

        const delBtn = document.getElementById('delete-selected-btn');
        if (delBtn && !delBtn.hasAttribute('data-listener')) {
            delBtn.setAttribute('data-listener', 'true');
            delBtn.addEventListener('click', async () => {
                const checked = document.querySelectorAll('.note-select-cb:checked');
                if (checked.length === 0) return;
                // Check for locked notes
                let lockedCount = 0;
                const deletableIds = [];
                for (const cb of checked) {
                    const id = cb.dataset.noteId;
                    if (!id) continue;
                    const note = await this.storage.getNote(id);
                    if (note && note.passwordHash && !this.unlockedNotes.has(id)) {
                        lockedCount++;
                    } else {
                        deletableIds.push(id);
                    }
                }
                let msg = `Delete ${deletableIds.length} selected note(s)?`;
                if (lockedCount > 0) {
                    msg += `\n\n${lockedCount} locked note(s) will be skipped (unlock them first).`;
                }
                if (deletableIds.length === 0) {
                    alert(`All ${lockedCount} selected note(s) are locked. Unlock them first to delete.`);
                    return;
                }
                if (confirm(msg)) {
                    for (const id of deletableIds) {
                        await this.storage.deleteNote(id);
                    }
                    this.loadAndDisplayNotes();
                    document.getElementById('delete-selected-btn').classList.add('hidden');
                }
            });
        }
    }

    handleNoteClick(event) {
        // Skip checkbox clicks
        if (event.target.classList.contains('note-select-cb')) return;
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        const noteId = target.dataset.noteId;
        if (action !== 'toggle' && action !== 'pin') event.stopPropagation();
        switch (action) {
            case 'toggle': this.toggleNote(noteId); break;
            case 'edit': this.editNote(noteId); break;
            case 'delete': this.deleteNoteUI(noteId); break;
            case 'pin': this.togglePin(noteId); break;
            case 'copy': this.copyNoteContent(noteId); break;
            case 'close-editor': this.closeEditor(); break;
        }
    }

    async createNewNote() {
        const n = await this.storage.addNote('Untitled Note', '');
        await this.loadAndDisplayNotes();
        setTimeout(() => this.editNote(n.id), 100);
    }

    toggleNote(noteId) {
        const content = document.getElementById(`content-${noteId}`);
        const expanded = content.classList.contains('expanded');
        document.querySelectorAll('.note-content.expanded').forEach(el => el.classList.remove('expanded'));
        if (!expanded) content.classList.add('expanded');
    }

    async editNote(noteId) {
        const note = await this.storage.getNote(noteId);
        if (!note) return;

        // Check if locked
        if (note.passwordHash && !this.unlockedNotes.has(noteId)) {
            this.showPasswordModal('unlock', noteId);
            return;
        }

        if (this.currentEditingNote) await this.autoSaveNote();

        this.currentEditingNote = noteId;
        const noteBlock = document.querySelector(`[data-note-id="${noteId}"]`);
        const content = document.getElementById(`content-${noteId}`);
        noteBlock.classList.add('editing', 'fullscreen');
        content.classList.add('expanded');

        const noteHeader = noteBlock.querySelector('.note-header');
        noteHeader.innerHTML = `
            <button class="btn btn-back" data-action="close-editor" title="Back">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
            </button>
            <input type="text" class="note-title-editor-header" value="${this.escapeHtml(note.title)}" placeholder="Untitled Note" />
            <div class="note-actions" style="opacity:1; display:flex; align-items:center; gap:12px;">
                <span class="save-status" id="save-status-${noteId}">Saved</span>
                <button class="note-action-btn delete" data-action="delete" data-note-id="${noteId}" title="Delete Note">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"></polyline><path d="m19,6v14a2,2 0 0,1 -2,2H7a2,2 0 0,1 -2,-2V6m3,0V4a2,2 0 0,1 2,-2h4a2,2 0 0,1 2,2v2"></path></svg>
                </button>
            </div>`;

        content.innerHTML = `
            <div class="editor-toolbar">
                <button class="toolbar-btn" data-action="formatBlock" data-value="H1" title="Heading 1">H1</button>
                <button class="toolbar-btn" data-action="formatBlock" data-value="H2" title="Heading 2">H2</button>
                <div class="toolbar-divider"></div>
                <button class="toolbar-btn" data-action="bold" title="Bold (Ctrl+B)">B</button>
                <button class="toolbar-btn" data-action="italic" title="Italic (Ctrl+I)">I</button>
                <button class="toolbar-btn" data-action="underline" title="Underline (Ctrl+U)">U</button>
                <button class="toolbar-btn" data-action="strikeThrough" title="Strikethrough">S</button>
                <div class="toolbar-divider"></div>
                <button class="toolbar-btn" data-action="insertUnorderedList" title="Bullet List">•</button>
                <button class="toolbar-btn" data-action="insertOrderedList" title="Number List">1.</button>
                <div class="toolbar-divider"></div>
                <button class="toolbar-btn" data-action="insert-image" title="Insert Image">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                </button>
                <button class="toolbar-btn" data-action="createLink" title="Link (Ctrl+K)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                </button>
                <div class="toolbar-divider"></div>
                <button class="toolbar-btn" data-action="lock" title="Lock Note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg></button>
                <div class="color-picker-wrapper" title="Note Color">
                    <button class="toolbar-btn" data-action="color-menu">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="12" cy="12" r="8"></circle></svg>
                    </button>
                    <div id="color-dropdown-${noteId}" class="color-dropdown hidden">
                        <div class="color-option" data-color=""  style="background:var(--theme-light)"></div>
                        <div class="color-option" data-color="#1e293b" style="background:#1e293b"></div>
                        <div class="color-option" data-color="#3b0726" style="background:#3b0726"></div>
                        <div class="color-option" data-color="#062e1e" style="background:#062e1e"></div>
                        <div class="color-option" data-color="#071b3b" style="background:#071b3b"></div>
                        <div class="color-option" data-color="#3b1b07" style="background:#3b1b07"></div>
                    </div>
                </div>
                <span class="toolbar-sep"></span>
                <button class="toolbar-btn" data-action="clear-format" title="Clear Format">Tx</button>
            </div>
            <div class="wysiwyg-editor" contenteditable="true" placeholder="Start writing...">${this.convertMarkdownToHtml(note.content, note.images)}</div>
            <div class="editor-footer">
                <span class="word-count" id="wc-${noteId}">0 words | 0 chars</span>
            </div>`;

        const editor = content.querySelector('.wysiwyg-editor');
        const titleEditor = noteHeader.querySelector('.note-title-editor-header');
        const toolbar = content.querySelector('.editor-toolbar');

        this.setupToolbar(toolbar, editor);
        if (this.setupLinkInteraction) this.setupLinkInteraction(editor);
        this.setupWysiwygEditor(editor);
        this.setupImageClickHandlers(editor);
        // Set lock button state
        if (typeof this.updateLockButton === 'function') {
            this.updateLockButton(!!note.passwordHash);
        }
        editor.focus();

        let saveTimeout;
        const saveStatus = document.getElementById(`save-status-${noteId}`);
        const autoSave = () => {
            clearTimeout(saveTimeout);
            if (saveStatus) saveStatus.textContent = 'Saving...';
            saveTimeout = setTimeout(async () => {
                await this.autoSaveNote();
                if (saveStatus) saveStatus.textContent = 'Saved';
                saveTimeout = null;
            }, 1000);
        };

        const updateWordCount = () => {
            const wc = document.getElementById(`wc-${noteId}`);
            if (wc) {
                const text = editor.innerText || '';
                const chars = text.length;
                const words = text.trim() ? text.trim().split(/\s+/).length : 0;
                wc.textContent = `${words} word${words !== 1 ? 's' : ''} | ${chars} char${chars !== 1 ? 's' : ''}`;
            }
        };

        // Initialize word count
        updateWordCount();

        editor.addEventListener('input', () => {
            autoSave();
            updateWordCount();
            this.processLiveCodeBlocks(editor);
            this.autoExpandEditorTextarea(editor);
        });
        titleEditor.addEventListener('input', autoSave);
        editor.addEventListener('keydown', (e) => this.handleEditorKeydown(e));
        editor.addEventListener('paste', (e) => this.handleWysiwygPaste(e));
    }

    processLiveCodeBlocks(editor) {
        // Find text nodes containing ``` patterns and render them as code blocks
        const html = editor.innerHTML;
        // Match ```lang\ncode\n``` pattern in the HTML (with <br> or newlines)
        const codeBlockRegex = /```(\w*)(?:<br>|\n)((?:(?!```)[\s\S])*?)(?:<br>|\n)```/g;
        if (codeBlockRegex.test(html)) {
            // Save cursor position
            const sel = window.getSelection();
            let savedOffset = null;
            if (sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                savedOffset = this.getCaretCharOffset(editor);
            }
            // Replace with rendered code blocks
            const newHtml = html.replace(/```(\w*)(?:<br>|\n)((?:(?!```)[\s\S])*?)(?:<br>|\n)```/g, (match, lang, code) => {
                // Clean up BR tags in code
                const cleanCode = code.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '');
                let highlighted = this.escapeHtml(cleanCode);
                if (lang && hljs.getLanguage(lang)) {
                    try { highlighted = hljs.highlight(cleanCode, { language: lang }).value; } catch (e) { }
                }
                return `<pre class="live-code-block"><code class="language-${lang || 'text'}">${highlighted}</code></pre><br>`;
            });
            if (newHtml !== html) {
                editor.innerHTML = newHtml;
                // Restore cursor to end
                if (savedOffset !== null) {
                    this.setCaretCharOffset(editor, savedOffset);
                }
            }
        }
    }

    getCaretCharOffset(element) {
        const sel = window.getSelection();
        if (!sel.rangeCount) return 0;
        const range = sel.getRangeAt(0).cloneRange();
        range.selectNodeContents(element);
        range.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
        return range.toString().length;
    }

    setCaretCharOffset(element, offset) {
        const sel = window.getSelection();
        const range = document.createRange();
        // Place cursor at end
        range.selectNodeContents(element);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    convertMarkdownToHtml(markdown, images = {}) {
        if (!markdown) return '';
        let html = markdown;

        // Replace image placeholders
        html = html.replace(/!\[(.*?)_VUE_IMGS_!!([^!]+)!\]/g, (match, alt, imageId) => {
            const src = images[imageId];
            if (src) return `<img src="${src}" alt="${alt}" data-image-id="${imageId}" class="note-image">`;
            return match;
        });

        // Use marked for markdown (handles ``` code blocks, formatting, etc.)
        try {
            html = marked.parse(html);
        } catch (e) {
            // Fallback simple formatting
            html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/`([^`]+)`/g, '<code>$1</code>')
                .replace(/\n/g, '<br>');
        }

        // Smart link rendering - convert plain URLs to link chips
        html = html.replace(/<a href="(https?:\/\/[^"]+)"[^>]*>(.*?)<\/a>/g, (match, url, text) => {
            try {
                const domain = new URL(url).hostname;
                return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-chip"><img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" class="link-favicon" alt="">${domain}</a>`;
            } catch (e) { return match; }
        });

        return html;
    }

    convertHtmlToMarkdown(html) {
        if (!html) return '';
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Convert images to placeholders
        temp.querySelectorAll('img').forEach(img => {
            const imageId = img.dataset.imageId;
            if (imageId) {
                const alt = img.alt || 'image';
                img.outerHTML = `![${alt}_VUE_IMGS_!!${imageId}!]`;
            }
        });

        // Convert link chips back to URLs
        temp.querySelectorAll('a.link-chip').forEach(a => {
            a.outerHTML = a.href;
        });

        // Handle code blocks (pre > code)
        temp.querySelectorAll('pre').forEach(pre => {
            const code = pre.querySelector('code');
            if (code) {
                const lang = (code.className.match(/language-(\w+)/) || ['', ''])[1];
                const content = code.textContent;
                pre.outerHTML = '\n```' + lang + '\n' + content + '\n```\n';
            }
        });

        // Inline code
        temp.querySelectorAll('code').forEach(code => {
            code.outerHTML = '`' + (code.textContent || '') + '`';
        });

        let md = temp.innerHTML
            .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
            .replace(/<b>(.*?)<\/b>/g, '**$1**')
            .replace(/<em>(.*?)<\/em>/g, '*$1*')
            .replace(/<i>(.*?)<\/i>/g, '*$1*')
            .replace(/<del>(.*?)<\/del>/g, '~~$1~~')
            .replace(/<h1>(.*?)<\/h1>/g, '# $1')
            .replace(/<h2>(.*?)<\/h2>/g, '## $1')
            .replace(/<h3>(.*?)<\/h3>/g, '### $1')
            .replace(/<ul>(.*?)<\/ul>/gs, (m, c) => {
                const items = c.match(/<li>(.*?)<\/li>/g);
                return items ? items.map(i => '- ' + i.replace(/<\/?li>/g, '')).join('\n') : m;
            })
            .replace(/<ol>(.*?)<\/ol>/gs, (m, c) => {
                const items = c.match(/<li>(.*?)<\/li>/g);
                return items ? items.map((i, n) => (n + 1) + '. ' + i.replace(/<\/?li>/g, '')).join('\n') : m;
            })
            .replace(/<br\s*\/?>/g, '\n')
            .replace(/<div>/g, '').replace(/<\/div>/g, '\n')
            .replace(/<p>/g, '').replace(/<\/p>/g, '\n')
            .replace(/<blockquote>(.*?)<\/blockquote>/gs, (m, c) => c.split('\n').map(l => '> ' + l).join('\n'));

        const f = document.createElement('div');
        f.innerHTML = md;
        md = f.textContent || f.innerText || md;
        return md.replace(/\n{3,}/g, '\n\n').trim();
    }

    setupWysiwygEditor(editor) {
        const updatePlaceholder = () => {
            editor.classList.toggle('empty', editor.textContent.trim() === '');
        };
        editor.addEventListener('input', updatePlaceholder);
        editor.addEventListener('focus', updatePlaceholder);
        editor.addEventListener('blur', updatePlaceholder);
        updatePlaceholder();
    }

    handleEditorKeydown(e) {
        if (e.ctrlKey || e.metaKey) {
            switch (e.key) {
                case 's': e.preventDefault(); this.autoSaveNote(); return;
                case 'b': e.preventDefault(); document.execCommand('bold'); return;
                case 'i': e.preventDefault(); document.execCommand('italic'); return;
                case 'u': e.preventDefault(); document.execCommand('underline'); return;
            }
        }

        // Live markdown formatting on space
        if (e.key === ' ') {
            const sel = window.getSelection();
            if (sel.rangeCount > 0) {
                const node = sel.anchorNode;
                if (node && node.nodeType === Node.TEXT_NODE) {
                    const textUntilCursor = node.textContent.substring(0, sel.anchorOffset);
                    if (/^(#{1,3}|-|\*|1\.)$/.test(textUntilCursor)) {
                        e.preventDefault();
                        // Delete the markdown trigger characters
                        for (let i = 0; i < textUntilCursor.length; i++) {
                            document.execCommand('delete', false, null);
                        }
                        // Apply formatting
                        if (textUntilCursor.startsWith('#')) {
                            const levels = { '#': 'H1', '##': 'H2', '###': 'H3' };
                            document.execCommand('formatBlock', false, levels[textUntilCursor]);
                        } else if (textUntilCursor === '-' || textUntilCursor === '*') {
                            document.execCommand('insertUnorderedList');
                        } else if (textUntilCursor === '1.') {
                            document.execCommand('insertOrderedList');
                        }
                        return;
                    }
                }
            }
        }

        if (e.key === 'Enter') {
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const li = (sel.getRangeAt(0).commonAncestorContainer.nodeType === Node.TEXT_NODE
                ? sel.getRangeAt(0).commonAncestorContainer.parentElement
                : sel.getRangeAt(0).commonAncestorContainer).closest?.('li');
            if (li) {
                e.preventDefault();
                if (li.textContent.trim() === '') {
                    const list = li.parentElement;
                    const div = document.createElement('div');
                    div.innerHTML = '<br>';
                    list.parentNode.insertBefore(div, list.nextSibling);
                    li.remove();
                    if (!list.children.length) list.remove();
                    const r = document.createRange(); r.setStart(div, 0); r.collapse(true);
                    sel.removeAllRanges(); sel.addRange(r);
                } else {
                    const newLi = document.createElement('li'); newLi.innerHTML = '<br>';
                    li.parentNode.insertBefore(newLi, li.nextSibling);
                    const r = document.createRange(); r.setStart(newLi, 0); r.collapse(true);
                    sel.removeAllRanges(); sel.addRange(r);
                }
            }
        }
        if (e.key === 'Tab') {
            e.preventDefault();
            const sel = window.getSelection();
            if (!sel.rangeCount) return;
            const c = sel.getRangeAt(0).commonAncestorContainer;
            const li = (c.nodeType === Node.TEXT_NODE ? c.parentElement : c).closest?.('li');
            if (li) { document.execCommand(e.shiftKey ? 'outdent' : 'indent'); }
            else if (!e.shiftKey) { document.execCommand('insertText', false, '    '); }
        }
    }

    normalizeInlineStyles(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const el = walker.currentNode;
            el.removeAttribute('style'); el.removeAttribute('class'); el.removeAttribute('color');
        }
    }

    async handleWysiwygPaste(event) {
        const dt = event.clipboardData;
        if (!dt) return;

        for (let item of dt.items) {
            if (item.type?.startsWith('image/')) {
                event.preventDefault();
                try {
                    const file = item.getAsFile();
                    const base64 = await this.fileToBase64(file);
                    const imageId = await this.storage.addImage(this.currentEditingNote, base64);
                    if (imageId) this.insertImageElement(base64, imageId);
                } catch (e) { console.error('Paste image error:', e); }
                return;
            }
        }

        // Check for URL paste - create smart link chip
        const text = dt.getData('text/plain');
        if (text && /^https?:\/\/\S+$/.test(text.trim())) {
            event.preventDefault();
            try {
                const url = text.trim();
                const domain = new URL(url).hostname;
                const linkHtml = `<a href="${url}" target="_blank" rel="noopener noreferrer" class="link-chip"><img src="https://www.google.com/s2/favicons?domain=${domain}&sz=16" class="link-favicon" alt="">${domain}</a>&nbsp;`;
                document.execCommand('insertHTML', false, linkHtml);
            } catch (e) {
                document.execCommand('insertText', false, text);
            }
            return;
        }

        const html = dt.getData('text/html');
        if (html) {
            event.preventDefault();
            document.execCommand('insertHTML', false, this.sanitizeHtml(html));
        } else if (text) {
            event.preventDefault();
            document.execCommand('insertHTML', false, this.escapeHtml(text).replace(/\n/g, '<br>'));
        }
    }

    sanitizeHtml(inputHtml) {
        const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'BR', 'P', 'DIV', 'UL', 'OL', 'LI', 'CODE', 'PRE', 'IMG', 'H1', 'H2', 'H3', 'BLOCKQUOTE']);
        const doc = new DOMParser().parseFromString(inputHtml, 'text/html');
        const walker = document.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const el = walker.currentNode;
            if (!allowed.has(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent)); continue; }
            el.removeAttribute('style'); el.removeAttribute('class');
            if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
        }
        return doc.body.innerHTML;
    }

    insertImageElement(base64, imageId) {
        const img = document.createElement('img');
        img.src = base64; img.dataset.imageId = imageId; img.className = 'note-image';
        img.style.cssText = 'max-width:100%;height:auto;display:block;margin:8px 0;border-radius:4px;cursor:pointer;';
        const sel = window.getSelection();
        if (sel.rangeCount > 0) {
            const range = sel.getRangeAt(0);
            range.deleteContents(); range.insertNode(img);
            const space = document.createTextNode(' ');
            range.setStartAfter(img); range.insertNode(space);
            range.setStartAfter(space); range.collapse(true);
            sel.removeAllRanges(); sel.addRange(range);
        }
    }

    insertImageIntoEditor(dataUrl) {
        if (!this.currentEditingNote) return;
        const editor = document.querySelector(`[data-note-id="${this.currentEditingNote}"] .wysiwyg-editor`);
        if (!editor) return;
        this.storage.addImage(this.currentEditingNote, dataUrl).then(imageId => {
            if (imageId) {
                const img = document.createElement('img');
                img.src = dataUrl; img.dataset.imageId = imageId; img.className = 'note-image';
                img.style.cssText = 'max-width:100%;height:auto;display:block;margin:8px 0;border-radius:4px;cursor:pointer;';
                editor.appendChild(img);
                editor.appendChild(document.createElement('br'));
                this.autoSaveNote();
            }
        });
    }

    async autoSaveNote() {
        if (!this.currentEditingNote) return;
        const noteBlock = document.querySelector(`[data-note-id="${this.currentEditingNote}"]`);
        if (!noteBlock) return;
        const titleEditor = noteBlock.querySelector('.note-title-editor-header');
        const contentEditor = noteBlock.querySelector('.wysiwyg-editor');
        if (!titleEditor || !contentEditor) return;

        const title = titleEditor.value.trim() || 'Untitled Note';
        const content = this.convertHtmlToMarkdown(contentEditor.innerHTML);

        // Collect all images from editor DOM to ensure none are lost
        const editorImages = {};
        contentEditor.querySelectorAll('img[data-image-id]').forEach(img => {
            editorImages[img.dataset.imageId] = img.src;
        });

        await this.storage.updateNote(this.currentEditingNote, { title, content, images: editorImages });
    }

    async saveEdit() {
        if (!this.currentEditingNote) return;
        await this.autoSaveNote();
        const noteBlock = document.querySelector(`[data-note-id="${this.currentEditingNote}"]`);
        this.currentEditingNote = null;
        if (noteBlock) noteBlock.classList.remove('editing', 'fullscreen');
        await this.loadAndDisplayNotes();
    }

    async closeEditor() {
        if (!this.currentEditingNote) return;
        await this.autoSaveNote();
        const noteBlock = document.querySelector(`[data-note-id="${this.currentEditingNote}"]`);
        if (noteBlock) noteBlock.classList.remove('editing', 'fullscreen');
        this.currentEditingNote = null;
        await this.loadAndDisplayNotes();
    }

    async deleteNote(noteId) {
        await this.storage.deleteNote(noteId);
        await this.loadAndDisplayNotes();
    }

    async deleteNoteUI(noteId) {
        const note = await this.storage.getNote(noteId);
        if (!note) return;
        // If locked and not unlocked in this session, require password
        if (note.passwordHash && !this.unlockedNotes.has(noteId)) {
            const pw = prompt('Enter the note password to delete this note:');
            if (!pw) return;
            const hash = await this.storage.hashPassword(pw);
            if (hash !== note.passwordHash) {
                alert('Incorrect password. Deletion cancelled.');
                return;
            }
        }
        if (confirm('Are you sure you want to delete this note?')) {
            await this.storage.deleteNote(noteId);
            this.currentEditingNote = null;
            this.loadAndDisplayNotes();
        }
    }

    async togglePin(noteId) {
        const note = await this.storage.getNote(noteId);
        if (note) {
            await this.storage.updateNote(noteId, { isPinned: !note.isPinned });
            this.loadAndDisplayNotes();
        }
    }

    async copyNoteContent(noteId) {
        const note = await this.storage.getNote(noteId);
        if (note && !note.passwordHash) {
            navigator.clipboard.writeText(note.content).then(() => {
                const btn = document.querySelector(`[data-action="copy"][data-note-id="${noteId}"]`);
                if (btn) {
                    const originalHTML = btn.innerHTML;
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2ea043" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                    setTimeout(() => btn.innerHTML = originalHTML, 2000);
                }
            }).catch(e => console.error("Copy failed", e));
        }
    }

    autoExpandEditorTextarea(editor) {
        // Placeholder for actual implementation if needed.
        // The provided code for this method was identical to toggleSearch, which is incorrect.
        // A proper implementation would adjust the editor's height based on content.
    }

    toggleSearch() {
        const sc = document.getElementById('search-container');
        if (sc.classList.contains('hidden')) { sc.classList.remove('hidden'); document.getElementById('search-input').focus(); }
        else this.clearSearch();
    }

    async handleSearch(query) {
        this.searchQuery = query.toLowerCase();
        if (!query.trim()) { await this.loadAndDisplayNotes(); return; }
        const filtered = await this.storage.searchNotes(query);
        this.displayNotes(filtered);
        // Highlight matches
        if (query.trim()) {
            this.highlightSearchResults(query);
            // Auto open all matching non-locked notes
            document.querySelectorAll('.note-content').forEach(el => el.classList.add('expanded'));
        }
    }

    highlightSearchResults(query) {
        const previews = document.querySelectorAll('.note-preview');
        const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        previews.forEach(p => {
            const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
            const textNodes = [];
            while (walker.nextNode()) textNodes.push(walker.currentNode);
            textNodes.forEach(node => {
                regex.lastIndex = 0;
                if (regex.test(node.textContent)) {
                    regex.lastIndex = 0;
                    const span = document.createElement('span');
                    span.innerHTML = node.textContent.replace(regex, '<mark>$1</mark>');
                    node.parentNode.replaceChild(span, node);
                }
            });
        });
    }

    clearSearch() {
        document.getElementById('search-container').classList.add('hidden');
        document.getElementById('search-input').value = '';
        this.searchQuery = '';
        this.loadAndDisplayNotes();
    }

    toggleMenu() { document.getElementById('menu-dropdown').classList.toggle('hidden'); }
    hideMenu() { document.getElementById('menu-dropdown').classList.add('hidden'); }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const diff = Math.floor((new Date() - date) / (1000 * 60 * 60 * 24));
        if (diff === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        if (diff === 1) return 'Yesterday';
        if (diff < 7) return `${diff} days ago`;
        return date.toLocaleDateString();
    }

    stripHtml(html) { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; }

    escapeRegExp(string) { return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

    escapeHtml(text) { const d = document.createElement('div'); d.textContent = text; return d.innerHTML; }

    setupDeleteEmptyButton() {
        const btn = document.getElementById('delete-empty-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            this.hideMenu();
            const notes = await this.storage.getAllNotes();
            const emptyNotes = notes.filter(n => {
                const hasContent = n.content && n.content.trim().length > 0;
                const hasImages = n.images && (Array.isArray(n.images) ? n.images.length > 0 : Object.keys(n.images).length > 0);
                return !hasContent && !hasImages;
            });
            if (emptyNotes.length === 0) {
                alert('No empty notes found.');
                return;
            }
            if (!confirm(`Delete ${emptyNotes.length} empty note(s)?`)) return;
            for (const n of emptyNotes) {
                await this.storage.deleteNote(n.id);
            }
            await this.loadAndDisplayNotes();
        });
    }

    // Settings
    showSettings() {
        document.getElementById('theme-color').value = localStorage.getItem('theme-color') || '#091932';
        document.getElementById('settings-modal').classList.remove('hidden');
        this.hideMenu();
    }
    hideSettings() {
        document.getElementById('settings-modal').classList.add('hidden');
        this.applyTheme(localStorage.getItem('theme-color') || '#091932');
    }
    previewTheme(color) { this.applyTheme(color); }
    saveSettings() {
        const color = document.getElementById('theme-color').value;
        localStorage.setItem('theme-color', color);
        this.applyTheme(color);
        this.hideSettings();
    }
    applyTheme(color) {
        const light = this.lightenColor(color, 20);
        const lighter = this.lightenColor(color, 40);
        document.documentElement.style.setProperty('--theme-color', color);
        document.documentElement.style.setProperty('--theme-light', light);
        document.documentElement.style.setProperty('--theme-lighter', lighter);
    }
    lightenColor(color, pct) {
        const hex = color.replace('#', '');
        const r = parseInt(hex.substr(0, 2), 16), g = parseInt(hex.substr(2, 2), 16), b = parseInt(hex.substr(4, 2), 16);
        const nr = Math.min(255, Math.floor(r + (255 - r) * pct / 100));
        const ng = Math.min(255, Math.floor(g + (255 - g) * pct / 100));
        const nb = Math.min(255, Math.floor(b + (255 - b) * pct / 100));
        return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
    }
    initTheme() { this.applyTheme(localStorage.getItem('theme-color') || '#091932'); }
}

let notesApp;
document.addEventListener('DOMContentLoaded', () => { notesApp = new NotesApp(); });
