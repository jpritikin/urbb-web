#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const bibPath = path.join(process.env.HOME, 'urbb-2025/content/docs/extra/bib.adoc');
const outputPath = path.join(__dirname, '../static/data/bibliography.json');

// Read the asciidoc file
const content = fs.readFileSync(bibPath, 'utf8');

// Parse bibliography entries
const entries = [];
const lines = content.split('\n');

let currentEntry = null;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];

  // Match bibliography entry format: * [[[id]]] citation
  const match = line.match(/^\* \[\[\[([^\]]+)\]\]\] (.+)$/);

  if (match) {
    // Save previous entry if exists
    if (currentEntry) {
      entries.push(currentEntry);
    }

    // Start new entry
    currentEntry = {
      id: match[1],
      citation: match[2].trim()
    };
  } else if (currentEntry && line.trim() && !line.startsWith('[bibliography]') && !line.startsWith('==')) {
    // Continuation of previous entry
    currentEntry.citation += ' ' + line.trim();
  }
}

// Add last entry
if (currentEntry) {
  entries.push(currentEntry);
}

// Ensure output directory exists
const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Write JSON output
fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2));

console.log(`Extracted ${entries.length} bibliography entries to ${outputPath}`);
