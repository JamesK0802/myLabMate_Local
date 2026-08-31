# CasMango — Local CRISPR Analysis

**CasMango** is a standalone browser application for fast, private CRISPR sequence-editing analysis. It supports Nanopore and Illumina paired-end FASTQ data, multi-reference target assignment, configurable cut-site windows, mutation classification, benchmarking, and an integrated Sequence Viewer. All processing runs locally with Web Workers.

> [!IMPORTANT]
> **100% Privacy Guarantee**: 
> FASTQ sequencing files and reference configurations remain entirely on your local computer. No sequencing data is ever uploaded to any server or cloud database.

---

## No Server, No API, No Backend Required

This is a **pure frontend SPA (Single Page Application)**.
- **No backend server** is required to run the analysis.
- **No API keys, credentials, or databases** are used.
- The compiled output is purely static files (`HTML`, `JS`, `CSS`, and images) that can be hosted directly on any static file provider.

---

## Features

- **Local FASTQ Processing**: Parse and analyze sequencing data (FASTQ/FQ formats) using multithreaded client-side Web Workers.
- **Nanopore and Illumina**: Preserve the Nanopore workflow while normalizing paired-end Illumina reads through target-aware consensus preprocessing.
- **Flexible Cut-Site Windows**: Use symmetric windows or configure independent left/right window sizes.
- **Sequence Viewer**: Inspect generated and imported FASTQ reads with reference-aware alignment controls.
- **Reference Configuration**: Bulk-configure reference genes and gRNA targets using a simple downloadable Excel template or via the interactive UI.
- **Interactive Mutation Dashboard**: View out-of-frame, in-frame, unmodified, and substitution distributions, with responsive charts powered by Chart.js.
- **Unified Sequence Alignment & Annotation**: Inspect exact base-level mutations (deletions, insertions, and substitutions) aligned against your reference sequences, with direct cut-site indicator visualization.
- **Offline Result Curation**: Recursively exclude specific files, genes, targets, or mutation groups from your dataset. Editing efficiency statistics and dashboard visualization recalculate instantly.
- **Local Import & Export**: Export rich, multi-sheet Excel reports with embedded visualization diagrams, or re-upload previously exported reports to review results at any time offline.

---

## Quick Start (Local NPM Development)

Ensure you have [Node.js](https://nodejs.org/) (v20+) installed on your machine.

### 1. Install Dependencies
```bash
npm install
```

### 2. Run the Development Server
```bash
npm start
```
Open **[http://localhost:4200](http://localhost:4200)** in your browser. Live reloading is enabled by default.

### 3. Run Unit Tests
Execute the Vitest suite locally:
```bash
npm run test
```

### 4. Build Static Assets
Compile the optimized production bundle:
```bash
npm run build
```
The compiled static web application will be generated in:
**`dist/casmango/browser/`**

---

## Production Static Deployment

The compiled `dist/casmango/browser/` directory contains standard static files. You can upload this folder directly to any static host:

- **GitHub Pages**
- **Cloudflare Pages**
- **Netlify**
- **Vercel**
- **Custom Web Server (Nginx / Apache / Amazon S3)**

For detailed step-by-step instructions on deploying the build output to each platform, refer to the [Deployment Guide](docs/deployment.md).
