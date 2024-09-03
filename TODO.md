find problem
-> (small ctx, error)
-> [tools] (e.g. [find refs, move cursor, find impls, goto def, peek def, show file])


# What do I want to do?
Give an LLM the ability to resolve it's own needs (dependencies) in the course of answering a problem

# Example use case
"Refactor this to add another argument"
* Intuitively, this needs to
  * change target fn's logic to account for the argument
  * find all the call sites for this fn & mutate them; adding new arg


# Navigation
In the course of this, the LLM may need to arbitrarily navigate the code base _itself_ (e.g. without user interaction). How can we enable this?
* Expose a set of vscode navigation commands as tools
  * simple things
   * goto file, offset, etc
   * edit range in file (or more complex accumulate buffered changes to be applied/undoe'd at once)
  * more complex: lsp-integrations
    * goto references, impls, definitions
* Allow the LLM to also understand it's context (task, chat history, n rounds completed so far, etc)

Revisiting our example, this may be accomplished via:
`lookup desired fn signature/impl -> find all call sites -> mutate call sites`
We can add more complexity (propagate cost in rounds or tokens, asking llm to minimize & capping cost externally)

# Exposing tooling
In order to do this, we need to build a set of conventions to statically define tools (structured inputs & outputs) and allow
the LLM to run them + accumulate intermediate state, e.g. a monad encapsulating
`ToolA | ToolB | Finished` -> `AOutput | BOutput | FinishedText`