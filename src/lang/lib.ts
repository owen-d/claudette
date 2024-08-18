import * as ts from './typescript';
import { Command } from '../types';
import { Action } from '../action';

type Language = {
  extension: string,
  name: string,
  commands: Command[],
  actions: {
    dirCtx: Action<string>,
  },
};

export const languages: Language[] = [ts.lang];
export const actions: Record<string, Language['actions']> = languages.reduce((acc, lang) => {
  return { ...acc, [lang.name]: lang.actions };
}, {} as Record<string, Language['actions']>);