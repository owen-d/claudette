import * as vscode from 'vscode';
import * as path from 'path';
import { liftEditor, pure, Action } from '../action';

export async function findFiles(folderPath: string, extension: string, maxDepth: number = 0): Promise<vscode.Uri[]> {
  const findFiles = await vscode.workspace.findFiles(
    new vscode.RelativePattern(folderPath, `**/*.${extension}`),
    null,
    maxDepth === 0 ? undefined : maxDepth
  );
  return findFiles;
}