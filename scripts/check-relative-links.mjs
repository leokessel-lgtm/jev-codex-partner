import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const rootDir = path.resolve(process.cwd());

function walkDir(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (file === 'node_modules' || file.startsWith('.')) continue;
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      walkDir(filePath, fileList);
    } else if (filePath.endsWith('.md')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

const markdownFiles = walkDir(rootDir);
const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
let hasErrors = false;

for (const file of markdownFiles) {
  const content = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const rawUrl = match[2].trim();

    // Ignore web URLs, mail links, and same-document anchors
    if (/^(https?|ftp|mailto):/i.test(rawUrl) || rawUrl.startsWith('#')) {
      continue;
    }

    // Strip query and fragment suffixes
    let cleanUrl = rawUrl.split('#')[0].split('?')[0];
    if (!cleanUrl) continue;

    // Decode URL-encoded paths
    cleanUrl = decodeURIComponent(cleanUrl);

    // Resolve path relative to the current markdown file
    const targetPath = path.resolve(path.dirname(file), cleanUrl);

    // Reject links that escape the repository root
    if (!targetPath.startsWith(rootDir)) {
      console.error(`Error: Link escapes repository root in ${path.relative(rootDir, file)} -> ${rawUrl}`);
      hasErrors = true;
      continue;
    }

    // Report missing local targets
    if (!fs.existsSync(targetPath)) {
      console.error(`Error: Missing local target in ${path.relative(rootDir, file)} -> ${rawUrl} (resolved to ${targetPath})`);
      hasErrors = true;
    }
  }
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log('All relative links are valid.');
}
