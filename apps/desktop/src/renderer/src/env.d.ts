/// <reference types="vite/client" />
import type { PromptBr0Api } from "../../shared/ipc.js";

declare global {
  interface Window {
    promptbr0: PromptBr0Api;
  }
}

export {};
