import { SequenceDocument, SequenceFeature } from '../models/sequence.model';

export function exportToFasta(doc: SequenceDocument): string {
  let fasta = `>${doc.name || 'Sequence'} ${doc.description || ''}\n`;
  const seq = doc.sequence;
  for (let i = 0; i < seq.length; i += 80) {
    fasta += seq.substring(i, i + 80) + '\n';
  }
  return fasta;
}

export function exportToGenBank(doc: SequenceDocument): string {
  // A simplified GenBank exporter
  const today = new Date();
  const dateStr = `${today.getDate().toString().padStart(2, '0')}-${today.toLocaleString('en-US', {month: 'short'}).toUpperCase()}-${today.getFullYear()}`;
  
  let gb = `LOCUS       ${(doc.name || 'Seq').padEnd(16, ' ')} ${doc.sequence.length} bp    DNA     ${doc.topology}   ${dateStr}\n`;
  gb += `DEFINITION  ${doc.description || doc.name}\n`;
  gb += `ACCESSION   ${doc.id || ''}\n`;
  gb += `VERSION     ${doc.id || ''}\n`;
  gb += `KEYWORDS    .\n`;
  gb += `SOURCE      .\n`;
  gb += `  ORGANISM  .\n`;
  gb += `FEATURES             Location/Qualifiers\n`;
  
  // Source feature
  gb += `     source          1..${doc.sequence.length}\n`;
  
  // Export features
  for (const f of doc.features) {
    let locStr = '';
    if (f.strand === -1) {
      locStr = `complement(${f.start + 1}..${f.end})`;
    } else {
      locStr = `${f.start + 1}..${f.end}`;
    }
    gb += `     ${f.type.padEnd(15, ' ')} ${locStr}\n`;
    gb += `                     /label="${f.name}"\n`;
    if (f.color) {
      gb += `                     /ApEinfo_fwdcolor="${f.color}"\n`;
      gb += `                     /ApEinfo_revcolor="${f.color}"\n`;
    }
  }
  
  gb += `ORIGIN\n`;
  const seq = doc.sequence.toLowerCase();
  for (let i = 0; i < seq.length; i += 60) {
    const chunk = seq.substring(i, i + 60);
    const pos = (i + 1).toString().padStart(9, ' ');
    const parts = [];
    for (let j = 0; j < chunk.length; j += 10) {
      parts.push(chunk.substring(j, j + 10));
    }
    gb += `${pos} ${parts.join(' ')}\n`;
  }
  gb += `//\n`;
  
  return gb;
}
