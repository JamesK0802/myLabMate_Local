import { Injectable } from '@angular/core';
import { BehaviorSubject, combineLatest, map } from 'rxjs';
import { ProjectItem, SequenceDocument, SequenceFeature } from '../models/sequence.model';
import { parseFasta, parseGenBank, parseFastqFile } from '../utils/parsers.utils';
import { shiftFeatures } from '../utils/biology.utils';
import { exportToFasta, exportToGenBank } from '../utils/export.utils';

const DB_NAME = 'SequenceWorkspaceDB';
const STORE_NAME = 'ProjectItems';
const DB_VERSION = 1;

export interface AutoAlignPayload {
  windowSeq: string;
  refSeq?: string;
  grnaSeq?: string;
  winSize?: number;
}

@Injectable({
  providedIn: 'root'
})
export class SequenceWorkspaceService {
  private db: IDBDatabase | null = null;
  private itemsSubject = new BehaviorSubject<ProjectItem[]>([]);
  public items$ = this.itemsSubject.asObservable();
  
  private selectedItemIdSubject = new BehaviorSubject<string | null>(null);
  public selectedItemId$ = this.selectedItemIdSubject.asObservable();

  public selectedItem$ = combineLatest([this.items$, this.selectedItemId$]).pipe(
    map(([items, id]) => id ? items.find(i => i.id === id) || null : null)
  );

  private selectedRegionSubject = new BehaviorSubject<{start: number, end: number, length: number} | null>(null);
  public selectedRegion$ = this.selectedRegionSubject.asObservable();

  private pendingAutoAlignSubject = new BehaviorSubject<AutoAlignPayload | null>(null);
  public pendingAutoAlign$ = this.pendingAutoAlignSubject.asObservable();

  setPendingAutoAlign(payload: AutoAlignPayload) {
    this.pendingAutoAlignSubject.next(payload);
  }

  getPendingAutoAlign(): AutoAlignPayload | null {
    return this.pendingAutoAlignSubject.value;
  }

  clearPendingAutoAlign() {
    this.pendingAutoAlignSubject.next(null);
  }

  private history: Record<string, { past: SequenceDocument[], future: SequenceDocument[] }> = {};
  private readonly MAX_HISTORY = 20;

  constructor() {
    this.initDB().then(() => this.loadAllItems());
  }

  private initDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('IndexedDB error:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
    });
  }

  private async loadAllItems() {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const items = request.result as ProjectItem[];
        this.itemsSubject.next(items);
        if (items.length > 0 && !this.selectedItemIdSubject.value) {
          this.selectItem(items[0].id);
        } else if (items.length === 0) {
          this.loadExample();
        }
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  private loadExample() {
    const example: SequenceDocument = {
      type: 'sequence',
      id: 'example-1',
      name: 'pUC19 Example',
      description: 'Standard cloning vector',
      sequence: 'TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCATAGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTC',
      topology: 'circular',
      features: [
        { id: 'f1', name: 'lacZa', type: 'CDS', start: 145, end: 469, strand: 1, color: '#3498db' },
        { id: 'f2', name: 'AmpR', type: 'CDS', start: 1625, end: 2486, strand: -1, color: '#e74c3c' },
        { id: 'f3', name: 'ori', type: 'rep_origin', start: 805, end: 1494, strand: 1, color: '#2ecc71' }
      ],
      primers: [],
      sourceFormat: 'manual',
      createdTimestamp: Date.now(),
      updatedTimestamp: Date.now()
    };
    this.saveItem(example);
  }

  async saveItem(item: ProjectItem) {
    if (!this.db) await this.initDB();
    const clonedItem = JSON.parse(JSON.stringify(item));
    clonedItem.updatedTimestamp = Date.now();
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(clonedItem);

      request.onsuccess = () => {
        const currentItems = this.itemsSubject.value.filter(i => i.id !== clonedItem.id);
        this.itemsSubject.next([...currentItems, clonedItem]);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteItem(id: string) {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => {
        this.itemsSubject.next(this.itemsSubject.value.filter(i => i.id !== id));
        if (this.selectedItemIdSubject.value === id) {
          this.selectedItemIdSubject.next(null);
        }
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  selectItem(id: string | null) {
    this.selectedItemIdSubject.next(id);
  }

  getSelectedItem(): ProjectItem | null {
    const id = this.selectedItemIdSubject.value;
    if (!id) return null;
    return this.itemsSubject.value.find(i => i.id === id) || null;
  }

  selectRegion(start: number, end: number) {
    let length = end - start;
    if (length < 0) {
      // Circular cross origin? Ignore for now and handle linear
      const doc = this.getSelectedItem();
      if (doc && doc.type === 'sequence') {
        length = (end + doc.sequence.length) - start;
      } else {
        length = 0;
      }
    }
    this.selectedRegionSubject.next({ start, end, length });
  }

  clearRegion() {
    this.selectedRegionSubject.next(null);
  }

  private pushHistoryState(doc: SequenceDocument) {
    if (!this.history[doc.id]) {
      this.history[doc.id] = { past: [], future: [] };
    }
    const h = this.history[doc.id];
    // Deep copy document to save state
    h.past.push(JSON.parse(JSON.stringify(doc)));
    if (h.past.length > this.MAX_HISTORY) h.past.shift();
    h.future = [];
  }

  async undo(id: string) {
    const h = this.history[id];
    if (!h || h.past.length === 0) return;
    
    const currentDoc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!currentDoc) return;

    h.future.push(JSON.parse(JSON.stringify(currentDoc)));
    const prevDoc = h.past.pop()!;
    await this.saveItem(prevDoc);
  }

  async redo(id: string) {
    const h = this.history[id];
    if (!h || h.future.length === 0) return;
    
    const currentDoc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!currentDoc) return;

    h.past.push(JSON.parse(JSON.stringify(currentDoc)));
    const nextDoc = h.future.pop()!;
    await this.saveItem(nextDoc);
  }

  canUndo(id: string): boolean {
    return !!this.history[id] && this.history[id].past.length > 0;
  }

  canRedo(id: string): boolean {
    return !!this.history[id] && this.history[id].future.length > 0;
  }

  async insertBases(id: string, startPos: number, insertedSeq: string) {
    const doc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!doc) return;

    this.pushHistoryState(doc);

    const cleanInsert = insertedSeq.replace(/[^A-Za-z]/g, '').toUpperCase();
    if (!cleanInsert) return;

    doc.sequence = doc.sequence.substring(0, startPos) + cleanInsert + doc.sequence.substring(startPos);
    doc.features = shiftFeatures(doc.features, startPos, 0, cleanInsert.length, doc.sequence.length, doc.topology);
    
    await this.saveItem(doc);
  }

  async deleteBases(id: string, startPos: number, length: number) {
    const doc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!doc) return;

    this.pushHistoryState(doc);

    doc.sequence = doc.sequence.substring(0, startPos) + doc.sequence.substring(startPos + length);
    doc.features = shiftFeatures(doc.features, startPos, length, 0, doc.sequence.length, doc.topology);

    await this.saveItem(doc);
  }

  async updateFeature(id: string, newFeature: SequenceFeature) {
    const doc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!doc) return;

    this.pushHistoryState(doc);

    const idx = doc.features.findIndex(f => f.id === newFeature.id);
    if (idx !== -1) {
      doc.features[idx] = newFeature;
    } else {
      doc.features.push(newFeature);
    }
    
    await this.saveItem(doc);
  }

  async deleteFeature(id: string, featureId: string) {
    const doc = this.itemsSubject.value.find(i => i.id === id) as SequenceDocument;
    if (!doc) return;

    this.pushHistoryState(doc);
    doc.features = doc.features.filter(f => f.id !== featureId);
    await this.saveItem(doc);
  }

  async importFile(file: File) {
    const isFastq = file.name.endsWith('.fastq') || file.name.endsWith('.fq') || file.name.endsWith('.fastq.gz') || file.name.endsWith('.fq.gz');
    
    if (isFastq) {
      try {
        const doc = await parseFastqFile(file);
        await this.saveItem(doc);
        this.selectItem(doc.id);
      } catch (e) {
        console.error('Failed to parse FASTQ', e);
      }
      return;
    }

    const text = await file.text();
    const isFasta = file.name.endsWith('.fasta') || file.name.endsWith('.fa') || text.startsWith('>');
    const isGenBank = file.name.endsWith('.gb') || file.name.endsWith('.gbk') || text.startsWith('LOCUS');

    if (isGenBank) {
      const doc = parseGenBank(text);
      if (doc) {
        doc.id = Math.random().toString(36).substring(2, 9);
        doc.type = 'sequence';
        doc.sourceFormat = 'genbank';
        doc.createdTimestamp = Date.now();
        doc.primers = doc.primers || [];
        await this.saveItem(doc as SequenceDocument);
        this.selectItem(doc.id!);
      }
    } else if (isFasta) {
      const docs = parseFasta(text);
      for (const d of docs) {
        d.id = Math.random().toString(36).substring(2, 9);
        d.type = 'sequence';
        d.sourceFormat = 'fasta';
        d.topology = 'linear';
        d.features = [];
        d.primers = [];
        d.createdTimestamp = Date.now();
        await this.saveItem(d as SequenceDocument);
        this.selectItem(d.id!);
      }
    } else {
      // Treat as plain sequence
      const cleanSeq = text.replace(/[^A-Za-z]/g, '').toUpperCase();
      if (cleanSeq.length > 0) {
        const doc: SequenceDocument = {
          id: Math.random().toString(36).substring(2, 9),
          type: 'sequence',
          name: file.name,
          description: 'Imported from text',
          sequence: cleanSeq,
          topology: 'linear',
          features: [],
          primers: [],
          sourceFormat: 'text',
          createdTimestamp: Date.now(),
          updatedTimestamp: Date.now()
        };
        await this.saveItem(doc);
        this.selectItem(doc.id);
      }
    }
  }

  async clearWorkspace() {
    if (!this.db) return;
    return new Promise<void>((resolve, reject) => {
      const transaction = this.db!.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => {
        this.itemsSubject.next([]);
        this.selectedItemIdSubject.next(null);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  // --- File System Access API Methods ---

  public async openLocalDirectory() {
    if (!('showDirectoryPicker' in window)) {
      alert('Your browser does not support the File System Access API. Please use a Chromium-based browser like Chrome or Edge.');
      return;
    }

    try {
      const dirHandle = await (window as any).showDirectoryPicker();
      // Clear the current workspace items? 
      // For now, let's clear the workspace to act as a "project folder" load
      const items: ProjectItem[] = [];
      
      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file') {
          const fileHandle = entry;
          const name = fileHandle.name.toLowerCase();
          
          if (name.endsWith('.fasta') || name.endsWith('.fa') || name.endsWith('.gb') || name.endsWith('.gbk') || name.endsWith('.fastq') || name.endsWith('.fq')) {
            const file = await fileHandle.getFile();
            
            try {
              if (name.endsWith('.fastq') || name.endsWith('.fq')) {
                const doc = await parseFastqFile(file);
                doc.fileHandle = fileHandle;
                items.push(doc);
              } else {
                const text = await file.text();
                if (name.endsWith('.fasta') || name.endsWith('.fa')) {
                  const docs = parseFasta(text);
                  for (const d of docs) {
                    d.id = Math.random().toString(36).substring(2, 9);
                    d.type = 'sequence';
                    d.sourceFormat = 'fasta';
                    d.topology = 'linear';
                    d.features = [];
                    d.primers = [];
                    d.createdTimestamp = Date.now();
                    d.updatedTimestamp = Date.now();
                    d.fileHandle = fileHandle;
                    if (!d.name || d.name === 'Untitled Sequence') d.name = fileHandle.name;
                    items.push(d as SequenceDocument);
                  }
                } else if (name.endsWith('.gb') || name.endsWith('.gbk')) {
                  const doc = parseGenBank(text);
                  if (doc) {
                    doc.id = Math.random().toString(36).substring(2, 9);
                    doc.type = 'sequence';
                    doc.sourceFormat = 'genbank';
                    doc.createdTimestamp = Date.now();
                    doc.updatedTimestamp = Date.now();
                    doc.primers = doc.primers || [];
                    doc.fileHandle = fileHandle;
                    if (!doc.name || doc.name === 'Untitled') doc.name = fileHandle.name;
                    items.push(doc as SequenceDocument);
                  }
                }
              }
            } catch (err) {
              console.error(`Failed to parse file: ${fileHandle.name}`, err);
            }
          }
        }
      }

      // Overwrite DB and memory
      if (this.db) {
        // Clear IndexedDB completely
        await new Promise<void>((resolve, reject) => {
          const tx = this.db!.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).clear();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
        
        // Save new items to DB
        for (const item of items) {
          await this.saveItem(item); // Note: saveItem stores in IndexedDB (fileHandle cannot be structurally cloned to IndexedDB easily in some browsers without issues, so we might lose the handle on refresh if we aren't careful, but we will try. Actually, FileSystemFileHandle CAN be stored in IndexedDB!)
        }
      }

      this.itemsSubject.next(items);
      if (items.length > 0) {
        this.selectItem(items[0].id);
      }
      
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Error opening directory:', err);
        alert('Failed to open directory.');
      }
    }
  }

  public async saveToDisk(item: ProjectItem) {
    if (item.type !== 'sequence') {
      alert('Only sequences can be exported to disk right now.');
      return;
    }

    try {
      let handle = item.fileHandle;
      if (!handle) {
        // Fallback to Save As
        handle = await (window as any).showSaveFilePicker({
          suggestedName: item.name,
          types: [{
            description: 'Sequence Files',
            accept: {
              'text/plain': ['.gb', '.gbk', '.fasta', '.fa']
            }
          }]
        });
      }

      // Check permission
      const options = { mode: 'readwrite' };
      if ((await handle.queryPermission(options)) !== 'granted') {
        if ((await handle.requestPermission(options)) !== 'granted') {
          throw new Error('Permission not granted');
        }
      }

      const writable = await handle.createWritable();
      
      let content = '';
      if (handle.name.toLowerCase().endsWith('.fasta') || handle.name.toLowerCase().endsWith('.fa')) {
        content = exportToFasta(item as SequenceDocument);
      } else {
        content = exportToGenBank(item as SequenceDocument);
      }
      
      await writable.write(content);
      await writable.close();
      
      // Update item with handle in case it was a new Save As
      item.fileHandle = handle;
      await this.saveItem(item);
      
      alert('Saved to disk successfully!');
      
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Failed to save file:', err);
        alert('Failed to save to disk.');
      }
    }
  }
}
