import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { liftEditor, pure } from '../action';

interface TypeScriptDefinition {
  kind: string;
  name: string;
  signature: string;
  comment?: string;
  methods?: TypeScriptDefinition[];
}

export const findDefinitions = liftEditor(async (editor) => {
  const currentFilePath = editor.document.uri.fsPath;
  const currentFolder = path.dirname(currentFilePath);

  const tsFiles = await findTypeScriptFiles(currentFolder);
  const definitions = await extractTypeScriptDefinitions(tsFiles);

  // Display the definitions in a new editor
  return formatDefinitions(definitions);
});



export const showDefinitions = findDefinitions.bind(
  text => liftEditor(
    async () => {
      const doc = await vscode.workspace.openTextDocument({
        content: text,
        language: 'typescript'
      });
      await vscode.window.showTextDocument(doc);
    }),
);

export const lang = {
  name: 'typescript',
  extension: 'ts',
  commands: [{
    name: 'findTSDefinitions',
    action: showDefinitions,
  }],
  actions: {
    dirCtx: findDefinitions,
  },
};

async function findTypeScriptFiles(folderPath: string): Promise<string[]> {
  const files = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folderPath, '**/*.ts')
  );
  return files.map(file => file.fsPath);
}

async function extractTypeScriptDefinitions(filePaths: string[]): Promise<TypeScriptDefinition[]> {
  const definitions: TypeScriptDefinition[] = [];

  for (const filePath of filePaths) {
    const fileContent = await fs.promises.readFile(filePath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      filePath,
      fileContent,
      ts.ScriptTarget.Latest,
      true
    );

    ts.forEachChild(sourceFile, node => {
      let def = extractDefinition(node, sourceFile);
      if (def) {
        definitions.push(def);
      }
    });
  }

  return definitions;
}

function extractDefinition(node: ts.Node, sourceFile: ts.SourceFile): TypeScriptDefinition | null {
  let kind: string = '';
  let name: string = '';
  let signature: string = '';
  let comment: string | undefined;
  let methods: TypeScriptDefinition[] | undefined;

  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) {
    kind = ts.isFunctionDeclaration(node) ? 'function' : 'method';
    name = node.name?.getText(sourceFile) ?? 'anonymous';
    signature = formatSignature(node, sourceFile);
  } else if (ts.isClassDeclaration(node)) {
    kind = 'class';
    name = node.name?.getText(sourceFile) ?? 'anonymous';
    const typeParams = getTypeParameters(node);
    const heritage = node.heritageClauses?.map(c => c.getText(sourceFile)).join(' ') ?? '';
    signature = `class ${name}${typeParams} ${heritage} {`;
    methods = node.members
      .filter(ts.isMethodDeclaration)
      .map(method => extractDefinition(method, sourceFile))
      .filter((def): def is TypeScriptDefinition => def !== null);
  } else if (ts.isInterfaceDeclaration(node)) {
    kind = 'interface';
    name = node.name.getText(sourceFile);
    const typeParams = getTypeParameters(node);
    const heritage = node.heritageClauses?.map(c => c.getText(sourceFile)).join(' ') ?? '';
    signature = `interface ${name}${typeParams} ${heritage} {`;
    methods = node.members
      .filter(ts.isMethodSignature)
      .map(method => ({
        kind: 'method',
        name: method.name.getText(sourceFile),
        signature: formatSignature(method, sourceFile),
        comment: getNodeComment(method, sourceFile)
      }));
  } else if (ts.isTypeAliasDeclaration(node)) {
    kind = 'type';
    name = node.name.getText(sourceFile);
    signature = node.getText(sourceFile) + ';';
  } else {
    return null;
  }

  comment = getNodeComment(node, sourceFile);

  return { kind, name, signature, comment, methods };
}

function formatSignature(node: ts.SignatureDeclaration, sourceFile: ts.SourceFile): string {
  const typeParams = getTypeParameters(node);
  const params = node.parameters.map(p => p.getText(sourceFile)).join(', ');
  const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
  if (ts.isConstructorDeclaration(node)) {
    return `constructor(${params})${returnType};`;
  }
  const name = node.name ? node.name.getText(sourceFile) : '';
  return `${name}${typeParams}(${params})${returnType};`;
}

function getTypeParameters(node: ts.DeclarationWithTypeParameters): string {
  if (ts.isClassLike(node) || ts.isInterfaceDeclaration(node) || ts.isFunctionLike(node)) {
    if (node.typeParameters && node.typeParameters.length > 0) {
      return `<${node.typeParameters.map(tp => tp.getText()).join(', ')}>`;
    }
  }
  return '';
}

function getNodeComment(node: ts.Node, sourceFile: ts.SourceFile): string | undefined {
  const commentRanges = ts.getLeadingCommentRanges(sourceFile.text, node.pos);
  if (commentRanges && commentRanges.length) {
    return commentRanges.map(range =>
      sourceFile.text.substring(range.pos, range.end)
    ).join('\n');
  }
  return undefined;
}

function formatDefinitions(definitions: TypeScriptDefinition[]): string {
  return definitions.map(def => formatDefinition(def, 0)).join('\n\n');
}

function formatDefinition(def: TypeScriptDefinition, indentLevel: number = 0): string {
  const indent = '  '.repeat(indentLevel);
  let result = '';

  if (def.comment) {
    result += def.comment.split('\n').map(line => indent + line).join('\n') + '\n';
  }

  result += indent + def.signature;

  if (def.methods && def.methods.length > 0) {
    result += '\n' + def.methods.map(method => formatDefinition(method, indentLevel + 1)).join('\n') + '\n';
    result += indent + '}';
  }

  return result;
}
