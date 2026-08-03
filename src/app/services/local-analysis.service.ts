/**
 * local-analysis.service.ts — Service to manage the Local Mode Web Worker lifecycle.
 *
 * Provides an Observable-based API that mirrors the server-side analysis flow,
 * but runs entirely in the browser via a Web Worker.
 */

import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

export interface LocalProgressEvent {
  type: 'progress';
  percent: number;
  stage: string;
  fileProgress?: Record<string, number>;
}

export interface LocalResultEvent {
  type: 'result';
  payload: any; // AnalysisPayload
}

export interface LocalErrorEvent {
  type: 'error';
  message: string;
}

export interface LocalBenchmarkSplitResultEvent {
  type: 'benchmark-split-result';
  payload: any;
}

export interface LocalBenchmarkResultEvent {
  type: 'benchmark-result';
  payload: any;
}

export interface LocalExportGroupFastqResultEvent {
  type: 'export-group-fastq-result';
  payload: Blob;
}

export type LocalAnalysisEvent = LocalProgressEvent | LocalResultEvent | LocalErrorEvent | LocalBenchmarkSplitResultEvent | LocalBenchmarkResultEvent | LocalExportGroupFastqResultEvent;

@Injectable({ providedIn: 'root' })
export class LocalAnalysisService {
  private worker: Worker | null = null;

  /**
   * Start a local analysis using Web Workers.
   */
  startAnalysis(
    files: File[],
    genesPayload: any[],
    params: { phredThreshold: number; indelThreshold: number; marginThreshold: number; windowSize: number; cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number }
  ): Observable<LocalAnalysisEvent> {
    const subject = new Subject<LocalAnalysisEvent>();
    this.terminate();

    try {
      this.worker = new Worker(
        new URL('../workers/local-analysis.worker', import.meta.url),
        { type: 'module' }
      );
    } catch (err: any) {
      subject.error(new Error('Failed to create Web Worker: ' + (err?.message || 'Unknown error')));
      return subject.asObservable();
    }

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          subject.next({
            type: 'progress',
            percent: msg.percent,
            stage: msg.stage,
            fileProgress: msg.fileProgress || {},
          });
          break;
        case 'result':
          subject.next({ type: 'result', payload: msg.payload });
          subject.complete();
          this.terminate();
          break;
        case 'error':
          subject.next({ type: 'error', message: msg.message });
          subject.complete();
          this.terminate();
          break;
      }
    };

    this.worker.onerror = (err) => {
      subject.next({ type: 'error', message: err.message || 'Worker error' });
      subject.complete();
      this.terminate();
    };

    this.worker.postMessage({
      type: 'analyze',
      payload: { files, genesPayload, params },
    });

    return subject.asObservable();
  }

  /**
   * Start local benchmark split preview.
   */
  startBenchmarkSplit(dataset: any[]): Observable<LocalAnalysisEvent> {
    const subject = new Subject<LocalAnalysisEvent>();
    this.terminate();

    try {
      this.worker = new Worker(
        new URL('../workers/local-analysis.worker', import.meta.url),
        { type: 'module' }
      );
    } catch (err: any) {
      subject.error(new Error('Failed to create Web Worker: ' + (err?.message || 'Unknown error')));
      return subject.asObservable();
    }

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'benchmark-split-result':
          subject.next({ type: 'benchmark-split-result', payload: msg.payload });
          subject.complete();
          this.terminate();
          break;
        case 'error':
          subject.next({ type: 'error', message: msg.message });
          subject.complete();
          this.terminate();
          break;
      }
    };

    this.worker.onerror = (err) => {
      subject.next({ type: 'error', message: err.message || 'Worker error' });
      subject.complete();
      this.terminate();
    };

    this.worker.postMessage({
      type: 'benchmark-split',
      payload: { dataset }
    });

    return subject.asObservable();
  }

  /**
   * Start local export of group fastq.
   */
  exportGroupFastq(
    file: File,
    target: any,
    readInner: string,
    params: any
  ): Observable<LocalAnalysisEvent> {
    const subject = new Subject<LocalAnalysisEvent>();
    this.terminate();

    try {
      this.worker = new Worker(
        new URL('../workers/local-analysis.worker', import.meta.url),
        { type: 'module' }
      );
    } catch (err: any) {
      subject.error(new Error('Failed to create Web Worker: ' + (err?.message || 'Unknown error')));
      return subject.asObservable();
    }

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          subject.next({
            type: 'progress',
            percent: msg.percent,
            stage: msg.stage
          });
          break;
        case 'export-group-fastq-result':
          subject.next({ type: 'export-group-fastq-result', payload: msg.payload });
          subject.complete();
          this.terminate();
          break;
        case 'error':
          subject.next({ type: 'error', message: msg.message });
          subject.complete();
          this.terminate();
          break;
      }
    };

    this.worker.onerror = (err) => {
      subject.next({ type: 'error', message: err.message || 'Worker error' });
      subject.complete();
      this.terminate();
    };

    this.worker.postMessage({
      type: 'export-group-fastq',
      payload: { file, target, readInner, params }
    });

    return subject.asObservable();
  }

  /**
   * Start local benchmark run.
   */
  startBenchmarkRun(
    dataset: any[],
    params: { phredThreshold: number; windowSize: number; marginThreshold: number },
    subset: 'train' | 'test'
  ): Observable<LocalAnalysisEvent> {
    const subject = new Subject<LocalAnalysisEvent>();
    this.terminate();

    try {
      this.worker = new Worker(
        new URL('../workers/local-analysis.worker', import.meta.url),
        { type: 'module' }
      );
    } catch (err: any) {
      subject.error(new Error('Failed to create Web Worker: ' + (err?.message || 'Unknown error')));
      return subject.asObservable();
    }

    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      switch (msg.type) {
        case 'progress':
          subject.next({
            type: 'progress',
            percent: msg.percent,
            stage: msg.stage
          });
          break;
        case 'benchmark-result':
          subject.next({ type: 'benchmark-result', payload: msg.payload });
          subject.complete();
          this.terminate();
          break;
        case 'error':
          subject.next({ type: 'error', message: msg.message });
          subject.complete();
          this.terminate();
          break;
      }
    };

    this.worker.onerror = (err) => {
      subject.next({ type: 'error', message: err.message || 'Worker error' });
      subject.complete();
      this.terminate();
    };

    this.worker.postMessage({
      type: 'benchmark-run',
      payload: { dataset, params, subset }
    });

    return subject.asObservable();
  }

  /**
   * Cancel the current local analysis/benchmark.
   */
  cancelAnalysis(): void {
    if (this.worker) {
      this.worker.postMessage({ type: 'cancel' });
      setTimeout(() => this.terminate(), 500);
    }
  }

  /**
   * Terminate the worker and clean up.
   */
  private terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}

