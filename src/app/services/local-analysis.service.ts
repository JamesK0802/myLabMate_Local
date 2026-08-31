/**
 * local-analysis.service.ts — Service to manage the Local Mode Web Worker lifecycle.
 *
 * Provides an Observable-based API that mirrors the server-side analysis flow,
 * but runs entirely in the browser via a Web Worker.
 */

import { Injectable } from '@angular/core';
import { Observable, ReplaySubject, Subject } from 'rxjs';
import { IlluminaFilePair, SequencingPlatform } from '../models/illumina.model';
import type { AutoAlignPayload } from './sequence-workspace.service';
import type { IlluminaPreprocessDiagnostics } from '../workers/core/illumina-preprocessor';

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

export interface LocalIlluminaMergeResultEvent {
  type: 'illumina-merge-result';
  payload: {
    stage1Fastq: string;
    stage2Fastq: string;
    stage1AutoAlign: AutoAlignPayload | null;
    stage2AutoAlign: AutoAlignPayload | null;
    stats: any;
    diagnostics: IlluminaPreprocessDiagnostics;
  };
}

export interface LocalExportGroupFastqResultEvent {
  type: 'export-group-fastq-result';
  payload: Blob;
}

export type LocalAnalysisEvent = LocalProgressEvent | LocalResultEvent | LocalErrorEvent | LocalBenchmarkSplitResultEvent | LocalBenchmarkResultEvent | LocalIlluminaMergeResultEvent | LocalExportGroupFastqResultEvent;

@Injectable({ providedIn: 'root' })
export class LocalAnalysisService {
  private worker: Worker | null = null;

  /**
   * Start a local analysis using Web Workers.
   */
  startAnalysis(
    files: File[],
    genesPayload: any[],
    params: { phredThreshold: number; indelThreshold: number; marginThreshold: number; windowSize: number; cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number; sequencingPlatform?: SequencingPlatform },
    illuminaPairs: IlluminaFilePair[] = []
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
      payload: { files, genesPayload, params, illuminaPairs },
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
    genesPayload: any[],
    params: {
      platform: SequencingPlatform; phredThreshold: number; windowSize: number; marginThreshold: number;
      cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number; customWindowLeft?: number; customWindowRight?: number;
    }
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
      payload: { dataset, genesPayload, params }
    });

    return subject.asObservable();
  }

  startIlluminaMergeBench(payload: {
    r1File?: File | null; r2File?: File | null; r1Sequence?: string; r2Sequence?: string;
    genesPayload: any[];
    params: { windowSize: number; phredThreshold: number; marginThreshold: number; cutSiteDistanceWeight?: number; cutSiteExclusionFlank?: number };
  }): Observable<LocalAnalysisEvent> {
    // Manual sequence inputs can finish before the component subscribes to the
    // returned observable. Keep the latest event so that a synchronous worker
    // result is not lost between postMessage() and subscribe().
    const subject = new ReplaySubject<LocalAnalysisEvent>(1);
    this.terminate();
    try {
      this.worker = new Worker(new URL('../workers/local-analysis.worker', import.meta.url), { type: 'module' });
    } catch (err: any) {
      subject.error(new Error('Failed to create Web Worker: ' + (err?.message || 'Unknown error')));
      return subject.asObservable();
    }
    this.worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg.type === 'progress') subject.next({ type: 'progress', percent: msg.percent, stage: msg.stage });
      if (msg.type === 'illumina-merge-result') {
        subject.next({ type: 'illumina-merge-result', payload: msg.payload });
        subject.complete();
        this.terminate();
      }
      if (msg.type === 'error') {
        subject.next({ type: 'error', message: msg.message });
        subject.complete();
        this.terminate();
      }
    };
    this.worker.onerror = (err) => {
      subject.next({ type: 'error', message: err.message || 'Worker error' });
      subject.complete();
      this.terminate();
    };
    this.worker.postMessage({ type: 'illumina-merge-bench', payload });
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
