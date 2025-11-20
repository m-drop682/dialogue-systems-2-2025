import type { SpeechStateExternalEvent } from "speechstate";
import type { AnyActorRef } from "xstate";

export interface DMContext {
  spstRef: AnyActorRef
  lastResult: string
  ollamaModels?: string[]
  messages: Message[]
  informationState: { latestMove: string }
}

export type Message = {
  role: "assistant" | "system" | "user"
  content: string
}
        
export type DMEvents =
  | SpeechStateExternalEvent
  | { type: "CLICK" }
  | { type: "SAYS"; value: string }
  | { type: "NEXT_MOVE"; value: string }
  | { type: "DONE" }