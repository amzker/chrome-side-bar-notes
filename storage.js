/**
 * Storage utilities for Sidebar Notes+
 */

class NotesStorage {
    constructor() {
        this.STORAGE_KEY = 'personal_notes';
    }

    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    }

    createNote(title = '', content = '') {
        return {
            id: this.generateId(),
            title: title || 'Untitled Note',
            content: content,
            createdAt: new Date().toISOString(),
            modifiedAt: new Date().toISOString(),
            images: {},
            passwordHash: null,
            isPinned: false,
            color: ''
        };
    }

    async getAllNotes() {
        return new Promise((resolve) => {
            chrome.storage.local.get([this.STORAGE_KEY], (result) => {
                const notes = result[this.STORAGE_KEY] || [];
                notes.sort((a, b) => {
                    if (a.isPinned && !b.isPinned) return -1;
                    if (!a.isPinned && b.isPinned) return 1;
                    return new Date(b.modifiedAt) - new Date(a.modifiedAt);
                });
                resolve(notes);
            });
        });
    }

    async saveAllNotes(notes) {
        return new Promise((resolve) => {
            chrome.storage.local.set({ [this.STORAGE_KEY]: notes }, () => {
                resolve();
            });
        });
    }

    async addNote(title = '', content = '') {
        const notes = await this.getAllNotes();
        const newNote = this.createNote(title, content);
        notes.unshift(newNote);
        await this.saveAllNotes(notes);
        return newNote;
    }

    async updateNote(noteId, updates) {
        const notes = await this.getAllNotes();
        const noteIndex = notes.findIndex(note => note.id === noteId);

        if (noteIndex !== -1) {
            const existing = notes[noteIndex];
            // Merge images: never drop existing images, only add/overwrite
            let mergedImages = { ...(existing.images || {}) };
            if (updates.images) {
                mergedImages = { ...mergedImages, ...updates.images };
            }

            notes[noteIndex] = {
                ...existing,
                ...updates,
                images: mergedImages,
                modifiedAt: new Date().toISOString()
            };
            await this.saveAllNotes(notes);
            return notes[noteIndex];
        }
        return null;
    }

    async deleteNote(noteId) {
        const notes = await this.getAllNotes();
        const filteredNotes = notes.filter(note => note.id !== noteId);
        await this.saveAllNotes(filteredNotes);
        return filteredNotes;
    }

    async getNote(noteId) {
        const notes = await this.getAllNotes();
        return notes.find(note => note.id === noteId) || null;
    }

    async searchNotes(query) {
        const notes = await this.getAllNotes();
        const lowercaseQuery = query.toLowerCase();

        return notes.filter(note => {
            // Skip locked/password-protected notes
            if (note.passwordHash) return false;
            return (
                note.title.toLowerCase().includes(lowercaseQuery) ||
                note.content.toLowerCase().includes(lowercaseQuery)
            );
        });
    }

    async addImage(noteId, base64) {
        const notes = await this.getAllNotes();
        const noteIndex = notes.findIndex(note => note.id === noteId);

        if (noteIndex !== -1) {
            const imageId = this.generateId();
            if (!notes[noteIndex].images) {
                notes[noteIndex].images = {};
            }
            notes[noteIndex].images[imageId] = base64;
            notes[noteIndex].modifiedAt = new Date().toISOString();
            await this.saveAllNotes(notes);
            return imageId;
        }
        return null;
    }

    async setNotePassword(noteId, passwordHash) {
        return this.updateNote(noteId, { passwordHash });
    }

    async removeNotePassword(noteId) {
        return this.updateNote(noteId, { passwordHash: null });
    }

    async hashPassword(password) {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async exportToJSON() {
        const notes = await this.getAllNotes();
        const exportData = {
            version: '2.0',
            exportDate: new Date().toISOString(),
            notes: notes
        };
        return JSON.stringify(exportData, null, 2);
    }

    async importFromJSON(jsonString) {
        try {
            const importData = JSON.parse(jsonString);
            let notesToImport = [];

            if (importData.notes && Array.isArray(importData.notes)) {
                notesToImport = importData.notes;
            } else if (Array.isArray(importData)) {
                notesToImport = importData;
            }

            notesToImport = notesToImport.map(note => ({
                id: note.id || this.generateId(),
                title: note.title || 'Imported Note',
                content: note.content || '',
                createdAt: note.createdAt || new Date().toISOString(),
                modifiedAt: note.modifiedAt || new Date().toISOString(),
                images: note.images || {},
                passwordHash: note.passwordHash || null,
                isPinned: !!note.isPinned,
                color: note.color || ''
            }));

            const existingNotes = await this.getAllNotes();
            const allNotes = [...notesToImport, ...existingNotes];
            await this.saveAllNotes(allNotes);

            return notesToImport.length;
        } catch (error) {
            throw new Error('Invalid JSON format: ' + error.message);
        }
    }

    async clearAllNotes() {
        await this.saveAllNotes([]);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = NotesStorage;
} else {
    window.NotesStorage = NotesStorage;
}
