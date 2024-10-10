import * as vscode from 'vscode';
import * as path from 'path';
import { liftEditor, pure, Action } from '../action';

interface GoDefinition {
  snippet: string;
  children?: GoDefinition[];
}

export const findDefinitions: Action<string> = liftEditor(async (editor) => {
  const currentFilePath = editor.document.uri.fsPath;
  const currentFolder = path.dirname(currentFilePath);

  const goFiles = await findGoFiles(currentFolder);
  const openedGoFiles = await findOpenedGoFiles();
  const allGoFiles = [
    ...new Set(
      goFiles.concat(openedGoFiles).map(uri => uri.fsPath),
    )
  ].map(fsPath => vscode.Uri.file(fsPath));

  const definitions = await extractGoDefinitions(allGoFiles);

  return formatDefinitions(definitions);
});

export const showDefinitions: Action<void> = findDefinitions.bind(
  text => liftEditor(
    async () => {
      const doc = await vscode.workspace.openTextDocument({
        content: text,
        language: 'go'
      });
      await vscode.window.showTextDocument(doc);
    }),
);

export const lang = {
  name: 'go',
  extension: 'go',
  commands: [{
    name: 'findGoDefinitions',
    action: showDefinitions,
  }],
  actions: {
    dirCtx: findDefinitions,
  },
};

async function findGoFiles(folderPath: string, maxDepth: number = 0): Promise<vscode.Uri[]> {
  const findFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folderPath, '**/*.go'),
    null,
    maxDepth === 0 ? undefined : maxDepth
  );
  return findFiles;
}

// finds go files opened in editor, regardless of location
async function findOpenedGoFiles(): Promise<vscode.Uri[]> {
  const openedFiles = vscode.workspace.textDocuments
    .filter(doc => doc.languageId === 'go')
    .map(doc => doc.uri);
  return openedFiles;
}

async function extractGoDefinitions(fileUris: vscode.Uri[]): Promise<GoDefinition[]> {
  const definitions: GoDefinition[] = [];

  for (const uri of fileUris) {
    const document = await vscode.workspace.openTextDocument(uri);
    const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeDocumentSymbolProvider',
      uri
    );

    if (symbols) {
      for (const symbol of symbols) {
        definitions.push(await extractDefinitionFromSymbol(symbol, document));
      }
    }
  }

  return definitions;
}

async function extractDefinitionFromSymbol(
  symbol: vscode.SymbolInformation,
  document: vscode.TextDocument
): Promise<GoDefinition> {
  const range = symbol.location.range;
  const commentStartLine = includeLeadingComments(document, range.start.line);
  const extendedRange = new vscode.Range(
    new vscode.Position(commentStartLine, 0),
    range.end
  );

  const snippet = extractSnippet(symbol, document, extendedRange);

  let children: GoDefinition[] | undefined;
  const relevantSymbolKinds = new Set([
    vscode.SymbolKind.Class,
    vscode.SymbolKind.Interface,
    vscode.SymbolKind.Struct,
    vscode.SymbolKind.Function,
    vscode.SymbolKind.Array,
    vscode.SymbolKind.Boolean,
    vscode.SymbolKind.Field,
    vscode.SymbolKind.Number,
    vscode.SymbolKind.String,
    vscode.SymbolKind.Constant,
  ]);

  if (relevantSymbolKinds.has(symbol.kind)) {
    const childSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      'vscode.executeDocumentSymbolProvider',
      document.uri,
      range
    );
    if (childSymbols) {
      children = await Promise.all(
        childSymbols
          .filter(s => s.location.range.start.line > range.start.line && s.location.range.end.line < range.end.line)
          .map(s => extractDefinitionFromSymbol(s, document))
      );
    }
  }

  return {
    snippet,
    children: children && children.length > 0 ? children : undefined
  };
}

function extractSnippet(symbol: vscode.SymbolInformation, document: vscode.TextDocument, range: vscode.Range): string {
  const startLine = includeLeadingComments(document, range.start.line);
  const extendedRange = new vscode.Range(
    new vscode.Position(startLine, 0),
    range.end
  );

  const lines = document.getText(extendedRange).split('\n');
  const codeLines = lines.filter(line => !line.trim().startsWith('//'));

  switch (symbol.kind) {
    case vscode.SymbolKind.Class:
    case vscode.SymbolKind.Interface:
    case vscode.SymbolKind.Struct:
      return extractStructOrInterfaceDefinition(lines);
    case vscode.SymbolKind.Function:
    case vscode.SymbolKind.Method:
      return extractFunctionSignature(lines);
    default:
      return extractOtherDefinition(lines);
  }
}

function includeLeadingComments(document: vscode.TextDocument, startLine: number): number {
  let currentLine = startLine - 1;
  while (currentLine >= 0) {
    const lineText = document.lineAt(currentLine).text.trim();
    if (lineText.startsWith('//') || lineText.startsWith('/*')) {
      currentLine--;
    } else {
      break;
    }
  }
  return currentLine + 1;
}

function extractStructOrInterfaceDefinition(lines: string[]): string {
  let bracketCount = 0;
  let endIndex = lines.length;

  for (let i = 0; i < lines.length; i++) {
    bracketCount += (lines[i].match(/{/g) || []).length;
    bracketCount -= (lines[i].match(/}/g) || []).length;
    if (bracketCount === 0 && lines[i].includes('}')) {
      endIndex = i + 1;
      break;
    }
  }

  return lines.slice(0, endIndex).join('\n') + '\n';
}


function extractOtherDefinition(lines: string[]): string {
  return lines.join('\n') + '\n';
}

function formatDefinitions(definitions: GoDefinition[]): string {
  return definitions.map(def => formatDefinition(def, 0)).join('\n');
}

function formatDefinition(def: GoDefinition, indentLevel: number = 0): string {
  const indent = '  '.repeat(indentLevel);
  let result = def.snippet.split('\n').map(line => indent + line).join('\n');

  if (def.children && def.children.length > 0) {
    result += def.children.map(child => formatDefinition(child, indentLevel + 1)).join('\n');
  }

  return result;
}


function extractFunctionSignature(lines: string[]): string {
  // Separate comments and code
  const commentEndIndex = lines.findIndex(line => !line.trim().startsWith('//') && line.trim() !== '');
  const comments = lines.slice(0, commentEndIndex);
  const code = lines.slice(commentEndIndex);

  // Find the last top-level {} brackets
  let bracketCount = 0;
  let bodyStartLineIndex = -1;
  let bodyStartCharIndex = -1;
  let inString = false;
  let inRawString = false;
  let stringChar = '';

  for (let i = 0; i < code.length; i++) {
    const line = code[i];
    for (let j = 0; j < line.length; j++) {
      if (!inString && !inRawString) {
        if (line[j] === '"' || line[j] === "'") {
          inString = true;
          stringChar = line[j];
        } else if (line[j] === '`') {
          inRawString = true;
        } else if (line[j] === '{') {
          if (bracketCount === 0) {
            bodyStartLineIndex = i;
            bodyStartCharIndex = j;
          }
          bracketCount++;
        } else if (line[j] === '}') {
          bracketCount--;
        }
      } else if (inString && line[j] === stringChar && (j === 0 || line[j - 1] !== '\\')) {
        inString = false;
      } else if (inRawString && line[j] === '`') {
        inRawString = false;
      }
    }
  }

  // Extract the signature (everything before the function body)
  let signature = code;
  if (bodyStartLineIndex !== -1) {
    signature = code.slice(0, bodyStartLineIndex);
    const lastLine = code[bodyStartLineIndex].slice(0, bodyStartCharIndex).trimEnd();
    if (lastLine) {
      signature.push(lastLine + ' {}');
    } else {
      signature[signature.length - 1] = signature[signature.length - 1].trimEnd() + ' {}';
    }
  }

  // Combine comments and signature, preserving indentation
  return [...comments, ...signature].join('\n') + '\n';
}