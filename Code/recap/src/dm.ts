import { assign, createActor, setup, fromPromise } from "xstate";
import { speechstate } from "speechstate";
import type { Settings } from "speechstate";
import type { DMEvents, DMContext, Message } from "./types";
import { KEY } from "./azure";

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const settings: Settings = {
  azureCredentials: azureCredentials,
  azureRegion: "northeurope",
  asrDefaultCompleteTimeout: 0,
  asrDefaultNoInputTimeout: 5000,
  locale: "en-US",
  ttsDefaultVoice: "en-GB-RyanNeural",
};


const dmMachine = setup({
  types: {
    context: {} as DMContext,
    events: {} as DMEvents,
  },
  actions: {
    sst_prepare: ({ context }) => context.spstRef.send({ type: "PREPARE" }),
    sst_listen: ({ context }) => context.spstRef.send({ type: "LISTEN" }),
  },
  actors: {
    
    //actor to retrieve models

    getmodels: fromPromise<any, null>( () =>
      fetch("http://localhost:11434/api/tags").then((response) => response.json()
      ),
    ), 

    //actor to get a response from the model

    getresponse: fromPromise<any, Message[]>(({input}) =>

    // input is: { input: [ {..}, {..} ] }

    // (input) without curly brackets, messages: input.input to access the array in input
    // ({input}) with curly brackets, take just the array from the input. Messages: input
  
    {
      const body = {
        model: "gemma2",
        stream: false,
        messages: input,
        options: {
      //     //repeat_last_n: 80, //this for more creative values with two models
      //     //repeat_penalty: 2,
        // temperature: 1.5,
      //     //seed: 42,
      //  // stop:[ "Avocados"],
      //   top_k: 5,
      //     // top_p: 0.5
        }
      }
      return fetch("http://localhost:11434/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      }).then(response => response.json());
    }
  ),
}
}).createMachine({
  id: "DM",
  context: ({ spawn }) => ({
    spstRef: spawn(speechstate, { input: settings }),
    informationState: { latestMove: "" },
    lastResult: "",
    messages: [],
    ollamaModels: [],
  }),

  initial: "Prepare",
  states: {
    Prepare: {
      entry: "sst_prepare",
      on: {
        ASRTTS_READY: "Get_Models", 
      },
    },

    //0. Tutorial

    Get_Models: {
      invoke: {
        src: "getmodels",
        input: null,
        onDone: {
          target: "Loop", //"Greeting"
          actions: assign(({event}) => {
            return { ollamaModels: event.output.models.map((x: any) => x.name)}
          })
        }
      }
    },

    Greeting: {
          invoke: {
            src: "getresponse",
            input: [
            
              //Add system message

              { role: "system", content: "Provide brief chat-like messages throughout the conversation. You are a voice-based LLM."}, 
              
              //Greeting to user

              { role: "assistant", content: "Say a quick 'hello', or 'hi'"}
                ],

            onDone: {
              actions: [

                //First action to add the machine's response to the input above to the messages array
                //Messages are added from the bottom i.e. 0: first message, 1: second message, 2: third message
                
                assign(({event, context}) => {
                return {
                  messages: [
                    ...context.messages,
                    { role: "assistant",
                      content: event.output.message.content
                    }, 
                  ]
                }
              }),

              //The machine utters the message at the last index (= last added message)

              ({ context }) =>
                context.spstRef.send({
                type: "SPEAK",
                value: { utterance: context.messages[context.messages.length -1].content },
                }),
            ]
            },
          },
          
          on: {
              SPEAK_COMPLETE: "Loop"
            }
        },

    Loop: {

      //Going straight to the asking stage to allow the user to respond to the machine's utterance
      //in the greeting

      initial: "Initial_greeting",
      states: { 
        Initial_greeting:  {        
        invoke: {
            src: "getresponse",
            input: [
              
              //Add system message

              { role: "system", content: "Provide brief chat-like messages throughout the conversation. You are a voice-based LLM."}, 
              
              //Greeting to user

              { role: "assistant", content: "Say a quick 'hello', or 'hi'"}
                ],

            onDone: {
              
              //Go to speaking state 

              target: "Speaking_Response",            
              actions: assign(({event, context}) => {
                return {
                  //Add chat completion to the bottom of the messages array
                  messages: [
                    ...context.messages,
                    { role: "assistant",
                      content: event.output.message.content
                    }, 
                  ]
                }
              })
            }
          }
        },

        
        Speaking_Response: {
          entry: ({ context }) =>
            context.spstRef.send({
                type: "SPEAK",

                //Machine speaks the last utterance in the messages array out loud

                value: { utterance: context.messages[context.messages.length -1].content },
                }),
            
                //Turn to the asking stage for the user's response

            on: { SPEAK_COMPLETE: "Asking_User" },
        },

        Asking_User: {
          entry: "sst_listen",
          on: {

              //If done listening, go to chat_completion stage to get the machine's response

              LISTEN_COMPLETE: {
              target: "Chat_Completion",
                },

              RECOGNISED: { //(event) => console.log
              actions: assign(({event, context}) => ({

                //If utterance recognised, add it to the bottom of messages
                //({ event }) => console.info("%cU】%s", "font-weight: bold", event.value[0].utterance, event.value[0].confidence)

                messages: [
                  ...context.messages,
                  { role: "user",
                    content: event.value[0].utterance,
                  },
                  
                ]}))},

              
            ASR_NOINPUT: {
              actions: assign(({context}) => ({

                //If utterance recognised, add it to the bottom of messages
                //({ event }) => console.info("%cU】%s", "font-weight: bold", event.value[0].utterance, event.value[0].confidence)

                messages: [
                  ...context.messages,

                  { role: "system",
                    content: "If the user does not resond, repeat the last utterance uttered by the LLM and ask the user if their hardware is functioning properly",
                  },
                  { role: "assistant",
                     content: "Are your microphone and speakers and keyboard working properly?",
                   },
                  
                ]}))}

              }},

        Chat_Completion: {

          //Invoke getresponse actor   
          invoke: {
            src: "getresponse",
            //All previous messages as input
            input: ({ context }) => [ 
              ...context.messages,
              { role: "system", content: "Provide brief chat-like messages throughout the conversation. You are a voice-based LLM. " },
            ],
            onDone: {
              
              //Go to speaking state 

              target: "Speaking_Response",      
              actions: assign(({event, context}) => {
                return {
                  //Add chat completion to the bottom of the messages array
                  messages: [
                    ...context.messages,
                    { role: "assistant",
                      content: event.output.message.content
                    }, 
                  ]
                }
              })
            }
          }
        }
      }
    },
  },
});

const dmActor = createActor(dmMachine, {}).start();

dmActor.subscribe((state) => {
  console.group("State update");
  console.log("State value:", state.value);
  console.log("State context:", state.context);
  console.groupEnd();
});

export function setupButton(element: HTMLButtonElement) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.subscribe((snapshot) => {
    const meta: { view?: string } = Object.values(
      snapshot.context.spstRef.getSnapshot().getMeta()
    )[0] || {
      view: undefined,
    };
    element.innerHTML = `${meta.view}`;
  });
}