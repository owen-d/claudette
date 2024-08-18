import { Action } from "./action";

export type Command = {
  name: string,
  action: Action<void>,
};